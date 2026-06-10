#!/usr/bin/env node
// AUTOMATION DRIVER: drive the Gemini CLI over the pending prompt batches,
// one by one, resuming automatically and refusing to burn tokens on failure.
//
//   npm run run -- <course-slug> [--model M|auto] [--delay-ms N] [--no-apply]
//                                [--limit N] [--max-calls N] [--timeout-ms N]
//
// For each batch without a USABLE NNN.result.json (missing, empty `[]`, or
// unparseable files all count as pending), it pipes the prompt to
// `gemini -o json`, writes the reply to NNN.result.json, applies it (unless
// --no-apply), waits --delay-ms, and moves on. Resume is automatic: progress
// IS the set of usable result files, so re-running continues after the last
// finished batch.
//
// Token-burn protection (each one stops the run cleanly; re-run to resume):
//   * default model is gemini-2.5-flash-lite — NO "thinking" tokens (the
//     auto-routed model spends ~8× the real output on thinking). `--model auto`
//     restores CLI routing if you really want it.
//   * quota / rate-limit on stderr  -> stop immediately
//   * --max-calls (default 120)     -> hard cap on CLI invocations per run,
//                                      retries included
//   * 3 batches failing in a row    -> stop (systemic problem, e.g. a prompt
//                                      change broke the JSON contract — fix it
//                                      instead of paying for more failures)
//   * per-call timeout kills the whole process group (gemini leaves orphaned
//     tool subprocesses behind otherwise)
//
// Requires the Gemini CLI authenticated (recommended: OAuth / Login with
// Google — selectedType "oauth-personal" in ~/.gemini/settings.json).

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { toolDir, repoRoot } from '../src/paths.mjs';
import { extractJsonArray, applyResults } from '../src/applyResults.mjs';

function die(m) { console.error(`\n[gemini-run] ERROR: ${m}\n`); process.exit(1); }

// Cheap + no hidden "thinking" spend. Override with --model, or --model auto
// to let the CLI route (NOT recommended: auto burned ~42k thinking tokens/batch).
const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

function parse(argv) {
  const o = { slug: null, delayMs: 6000, model: DEFAULT_MODEL, apply: true, limit: Infinity, maxCalls: 120, timeoutMs: 120000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--no-apply') o.apply = false;
    else if (a === '--delay-ms') o.delayMs = Number(argv[++i]);
    else if (a.startsWith('--delay-ms=')) o.delayMs = Number(a.slice(11));
    else if (a === '--model') o.model = argv[++i];
    else if (a.startsWith('--model=')) o.model = a.slice(8);
    else if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a.startsWith('--limit=')) o.limit = Number(a.slice(8));
    else if (a === '--max-calls') o.maxCalls = Number(argv[++i]);
    else if (a.startsWith('--max-calls=')) o.maxCalls = Number(a.slice(12));
    else if (a === '--timeout-ms') o.timeoutMs = Number(argv[++i]);
    else if (a.startsWith('--timeout-ms=')) o.timeoutMs = Number(a.slice(13));
    else if (a.startsWith('-')) die(`unknown option: ${a}`);
    else if (o.slug === null) o.slug = a;
    else die(`unexpected argument: ${a}`);
  }
  if (o.model === 'auto') o.model = null;
  if (!Number.isFinite(o.maxCalls) || o.maxCalls < 1) o.maxCalls = 120;
  return o;
}

const RATE_RE = /429|quota|exhaust|rate.?limit|RESOURCE_EXHAUSTED|too many requests|daily limit|TerminalQuota/i;

// Defense-in-depth: never echo the API key, even if a subprocess surfaced it.
function redact(s) {
  const k = process.env.GEMINI_API_KEY;
  return k && k.length > 8 ? String(s).split(k).join('***REDACTED***') : String(s);
}

async function runGemini(promptText, { model, timeoutMs, cwd }) {
  // CRITICAL: capture stdout to a FILE, not a pipe. Large gemini output (>~8 KB)
  // gets truncated when piped (the proven manual call used `> file` and worked).
  // No --skip-trust / -y: default (non-agentic) mode answers directly and fast;
  // a trusted cwd avoids the trust prompt, and without auto-approve gemini won't
  // run tools (nothing to touch). Mirrors the working manual invocation exactly.
  const outFile = path.join(os.tmpdir(), `gp-out-${process.pid}-${Date.now()}.json`);
  const fh = await fs.open(outFile, 'w');
  const args = ['-o', 'json', ...(model ? ['-m', model] : []), '-p', promptText];
  return new Promise((resolve) => {
    // detached: child becomes a process-group leader so we can kill the WHOLE
    // group on timeout — gemini spawns tool subprocesses (GrepTool) that
    // otherwise survive a plain child kill, hold the stderr pipe open, and hang
    // the run forever (the "stuck for an hour" bug).
    const child = spawn('gemini', args, { stdio: ['ignore', fh.fd, 'pipe'], env: process.env, cwd, detached: true });
    let err = '', killed = false, done = false;

    const killGroup = () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      try { child.kill('SIGKILL'); } catch {}
    };
    const finish = async (code) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      clearTimeout(hard);
      await fh.close().catch(() => {});
      let out = '';
      try { out = await fs.readFile(outFile, 'utf8'); } catch {}
      await fs.rm(outFile, { force: true }).catch(() => {});
      // Detect a real rate/quota error on STDERR only — never on stdout, which
      // contains the polished course text (numbers like "0.429", words like
      // "rate"/"quota") and would trigger false positives.
      resolve({ code, out, err, timedOut: killed, rate: RATE_RE.test(err) });
    };
    const t = setTimeout(() => { killed = true; killGroup(); }, timeoutMs);
    // Hard backstop: if 'close'/'exit' never fire even after the group kill
    // (orphaned pipe holders), force-resolve a few seconds later.
    const hard = setTimeout(() => finish(-1), timeoutMs + 8000);

    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { err += String(e); finish(-1); });
    child.on('exit', (code) => finish(code));
    child.on('close', (code) => finish(code));
  });
}

// Pull the model text out of the `-o json` envelope; fall back to raw stdout.
function unwrap(stdout) {
  const s = stdout.trim();
  try { const env = JSON.parse(s); if (env && typeof env.response === 'string') return env.response; } catch {}
  return s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

// A batch is DONE only if its result file exists AND parses to a non-empty
// array. Empty `[]` placeholders or mangled pastes count as pending, so resume
// genuinely picks up after the last *finished* batch.
async function hasUsableResult(outDir, base) {
  const p = path.join(outDir, `${base}.result.json`);
  if (!(await exists(p))) return false;
  const raw = await fs.readFile(p, 'utf8').catch(() => '');
  const arr = extractJsonArray(raw);
  return Boolean(arr && arr.length);
}

async function listPending(outDir, bases) {
  const pending = [];
  for (const b of bases) if (!(await hasUsableResult(outDir, b))) pending.push(b);
  return pending;
}

async function main() {
  const o = parse(process.argv.slice(2));
  if (o.help || !o.slug) {
    console.error(`Usage: npm run run -- <course-slug> [--model M|auto] [--delay-ms N] [--no-apply] [--limit N] [--max-calls N]
  --model      Gemini model (default ${DEFAULT_MODEL}; "auto" = CLI routing, EXPENSIVE)
  --limit      max batches this run (default: all pending)
  --max-calls  hard cap on CLI invocations this run, retries included (default 120)`);
    process.exit(o.slug ? 0 : 1);
  }
  const outDir = path.join(toolDir, 'out', o.slug);
  const entries = await fs.readdir(outDir).catch(() => die(`no export dir ${outDir} — run "npm run export" first`));
  const bases = entries.filter((e) => e.endsWith('.map.json')).map((e) => e.slice(0, -'.map.json'.length)).sort();

  const pending = await listPending(outDir, bases);

  console.error(`[gemini-run] ${o.slug}: ${bases.length} batches, ${bases.length - pending.length} done, ${pending.length} pending` +
    `  (delay ${o.delayMs}ms, model ${o.model || 'auto'}, apply ${o.apply}, max-calls ${o.maxCalls})`);
  if (pending.length === 0) { console.error('[gemini-run] nothing to do — all batches have results.'); return; }

  const MAX_TRIES = 3;
  const MAX_FAILED_BATCHES_IN_A_ROW = 3;
  let generated = 0, applied = 0, calls = 0, failStreak = 0, stop = false, stopReason = '';
  for (let i = 0; i < pending.length && i < o.limit; i++) {
    const b = pending[i];
    process.stderr.write(`[gemini-run] • ${b} (${i + 1}/${Math.min(pending.length, o.limit)}) … `);
    const prompt = await fs.readFile(path.join(outDir, `${b}.prompt.md`), 'utf8');

    // Gemini replies are non-deterministic; a malformed (unparseable) JSON reply
    // usually parses fine on a re-call, so retry up to MAX_TRIES before giving up.
    let arr = null, lastOut = '', lastErr = '';
    for (let attempt = 1; attempt <= MAX_TRIES && !arr; attempt++) {
      if (calls >= o.maxCalls) { stop = true; stopReason = `--max-calls ${o.maxCalls} reached`; break; }
      if (attempt > 1) { process.stderr.write(`retry ${attempt}/${MAX_TRIES} … `); await sleep(o.delayMs); }
      calls++;
      const r = await runGemini(prompt, { model: o.model, timeoutMs: o.timeoutMs, cwd: repoRoot });
      lastOut = r.out; lastErr = r.err;
      if (r.rate) { stop = true; stopReason = 'quota / rate limit'; break; }
      if (r.timedOut) { stop = true; stopReason = 'per-call timeout'; break; }
      if (r.code !== 0) { process.stderr.write(`gemini exit ${r.code} (${redact(r.err.trim().slice(0, 80))}) … `); continue; }
      const parsed = extractJsonArray(unwrap(r.out));
      if (parsed && parsed.length) arr = parsed;
      else process.stderr.write('unparseable … ');
    }
    if (stop) {
      process.stderr.write(`STOP (${stopReason}).\n`);
      break;
    }
    if (!arr) {
      // Dump the raw reply for offline diagnosis (no extra API cost).
      if (process.env.GP_DEBUG) {
        await fs.writeFile(path.join(outDir, `${b}.rawfail.out`), redact(lastOut));
        await fs.writeFile(path.join(outDir, `${b}.rawfail.err`), redact(lastErr));
      }
      failStreak++;
      process.stderr.write(`giving up — stays pending (${failStreak}/${MAX_FAILED_BATCHES_IN_A_ROW} failed in a row).\n`);
      if (failStreak >= MAX_FAILED_BATCHES_IN_A_ROW) {
        stop = true;
        stopReason = `${MAX_FAILED_BATCHES_IN_A_ROW} consecutive batches unparseable — looks systemic, not random`;
        break;
      }
      continue;
    }
    failStreak = 0;

    await fs.writeFile(path.join(outDir, `${b}.result.json`), JSON.stringify(arr, null, 2));
    generated++;

    if (o.apply) {
      const { lessonReports } = await applyResults(o.slug, { outDir, file: b, dryRun: false });
      const c = lessonReports.reduce((a, lr) => ({ ap: a.ap + lr.counts.applied, rj: a.rj + lr.counts.rejected, ms: a.ms + (lr.counts.missing||0), st: a.st + (lr.counts.stale||0) }), { ap: 0, rj: 0, ms: 0, st: 0 });
      applied += c.ap;
      process.stderr.write(`ok — applied ${c.ap}, rejected ${c.rj}, missing ${c.ms}${c.st ? `, stale ${c.st}` : ''}\n`);
    } else {
      process.stderr.write(`ok — result written (not applied)\n`);
    }

    if (i + 1 < pending.length) await sleep(o.delayMs);
  }

  const stillPending = await listPending(outDir, bases);
  console.error('');
  console.error(`[gemini-run] DONE this run: ${calls} CLI call(s), ${generated} batch(es) generated, ${applied} field(s) applied.` +
    (stop ? `  Stopped early: ${stopReason}.` : ''));
  console.error(`[gemini-run] remaining pending: ${stillPending.length}${stillPending.length ? ` (next: ${stillPending.slice(0,5).join(', ')}${stillPending.length>5?'…':''}) — re-run the same command to resume.` : ' — course fully polished 🎉'}`);
}

main().catch((e) => die(e && e.stack ? e.stack : String(e)));
