#!/usr/bin/env node
// Helper used by spawned `claude -p` agents (and humans) to fetch Sentinel /
// Copernicus Data Space products without re-deriving the OAuth + OData flow
// each time. Credentials are read from ~/.ai-lecturer/secrets.env (the same
// file src/lib/server/secrets.ts loads), so a course-generation agent that
// inherits the env can call this script straight from Bash. No npm deps —
// runs on plain `node scripts/copernicus-fetch.mjs ...`.
//
// Subcommands:
//   search    — query OData catalog, print JSONL of matches on stdout
//   download  — stream a whole product .SAFE.zip to disk
//   quicklook — fetch just preview/quick-look.png from inside the .SAFE archive
//
// Run `node scripts/copernicus-fetch.mjs --help` for argument details.

import { readFileSync, createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { request } from 'node:https';
import { URL } from 'node:url';

const SECRETS_PATH = `${homedir()}/.ai-lecturer/secrets.env`;
const TOKEN_URL =
  'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const CATALOG_BASE = 'https://catalogue.dataspace.copernicus.eu/odata/v1';
const DOWNLOAD_BASE = 'https://download.dataspace.copernicus.eu/odata/v1';

function parseSecretsEnv(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function loadCreds() {
  // Env vars (set by spawnChild) win over the file; file is the fallback for
  // direct shell invocations where the parent didn't inject anything.
  const fromEnv = {
    COPERNICUS_USER: process.env.COPERNICUS_USER,
    COPERNICUS_PASSWORD: process.env.COPERNICUS_PASSWORD,
  };
  if (fromEnv.COPERNICUS_USER && fromEnv.COPERNICUS_PASSWORD) return fromEnv;
  let raw = '';
  try {
    raw = readFileSync(SECRETS_PATH, 'utf8');
  } catch {
    return fromEnv;
  }
  const fromFile = parseSecretsEnv(raw);
  return {
    COPERNICUS_USER: fromEnv.COPERNICUS_USER || fromFile.COPERNICUS_USER,
    COPERNICUS_PASSWORD: fromEnv.COPERNICUS_PASSWORD || fromFile.COPERNICUS_PASSWORD,
  };
}

// One in-process token; valid 30 min per CDSE keycloak realm. Short-lived
// CLI invocations only ever need one, but cache it so search+download in
// a single run don't pay the auth round-trip twice.
let cachedToken = null;
async function getToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) {
    return cachedToken.value;
  }
  const { COPERNICUS_USER, COPERNICUS_PASSWORD } = loadCreds();
  if (!COPERNICUS_USER || !COPERNICUS_PASSWORD) {
    throw new Error(
      `Missing Copernicus credentials. Set COPERNICUS_USER / COPERNICUS_PASSWORD in env or ${SECRETS_PATH}.`,
    );
  }
  const body = new URLSearchParams({
    client_id: 'cdse-public',
    username: COPERNICUS_USER,
    password: COPERNICUS_PASSWORD,
    grant_type: 'password',
  }).toString();
  const { status, text } = await httpPost(TOKEN_URL, body, {
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  if (status !== 200) {
    throw new Error(`Token request failed (${status}): ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text);
  if (!json.access_token) {
    throw new Error(`Token response missing access_token: ${text.slice(0, 300)}`);
  }
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in || 1800) * 1000,
  };
  return cachedToken.value;
}

function httpPost(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = request(
      {
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname + u.search,
        port: u.port || 443,
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpGetText(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    request(
      {
        method: 'GET',
        hostname: u.hostname,
        path: u.pathname + u.search,
        port: u.port || 443,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    )
      .on('error', reject)
      .end();
  });
}

// Streams response body to `outPath`, following 301/302/303/307/308 redirects
// (CDSE issues a 302 from the OData download endpoint to a CDN URL).
// Re-sends the Authorization header on each hop because the CDN host still
// requires the bearer token for product blobs.
async function streamToFile(urlStr, outPath, headers, onProgress) {
  mkdirSync(dirname(outPath), { recursive: true });
  let current = urlStr;
  for (let hop = 0; hop < 5; hop++) {
    const result = await new Promise((resolve, reject) => {
      const u = new URL(current);
      const req = request(
        {
          method: 'GET',
          hostname: u.hostname,
          path: u.pathname + u.search,
          port: u.port || 443,
          headers,
        },
        (res) => resolve(res),
      );
      req.on('error', reject);
      req.end();
    });
    const status = result.statusCode || 0;
    if (status >= 300 && status < 400 && result.headers.location) {
      current = new URL(result.headers.location, current).toString();
      result.resume();
      continue;
    }
    if (status !== 200) {
      const errText = await new Promise((resolve) => {
        const chunks = [];
        result.on('data', (c) => chunks.push(c));
        result.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').slice(0, 400)));
      });
      throw new Error(`GET ${current} -> ${status}: ${errText}`);
    }
    const total = Number(result.headers['content-length'] || 0);
    let written = 0;
    const sink = createWriteStream(outPath);
    await new Promise((resolve, reject) => {
      result.on('data', (chunk) => {
        written += chunk.length;
        sink.write(chunk);
        onProgress?.(written, total);
      });
      result.on('end', () => sink.end(resolve));
      result.on('error', reject);
      sink.on('error', reject);
    });
    return { bytes: written, total };
  }
  throw new Error(`Too many redirects starting from ${urlStr}`);
}

function bboxToWkt(bbox) {
  const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number);
  if ([minLon, minLat, maxLon, maxLat].some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid --bbox: expected "minLon,minLat,maxLon,maxLat", got "${bbox}"`);
  }
  return (
    `POLYGON((${minLon} ${minLat},${maxLon} ${minLat},` +
    `${maxLon} ${maxLat},${minLon} ${maxLat},${minLon} ${minLat}))`
  );
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[k] = true;
      } else {
        out[k] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function progressReporter() {
  const start = Date.now();
  let lastLogged = 0;
  return (written, total) => {
    const now = Date.now();
    if (now - lastLogged < 5000 && written < total) return;
    lastLogged = now;
    const mb = written / 1e6;
    const totMb = total / 1e6;
    const pct = total ? ((written / total) * 100).toFixed(1) : '?';
    const mbps = mb / Math.max((now - start) / 1000, 0.001);
    process.stderr.write(
      `  ${mb.toFixed(1).padStart(7)} / ${totMb.toFixed(1)} MB  (${pct}%)  ${mbps.toFixed(2)} MB/s\n`,
    );
  };
}

async function cmdSearch(args) {
  const collection = args.collection || 'SENTINEL-1';
  const nameContains = args['name-contains']; // e.g. GRDH, SLC, MSIL2A
  const since = args.since; // ISO date or full timestamp
  const until = args.until;
  const top = Math.min(Number(args.top || 10), 100);
  const filters = [`Collection/Name eq '${collection}'`];
  if (nameContains) filters.push(`contains(Name,'${nameContains}')`);
  if (args.bbox) {
    filters.push(`OData.CSC.Intersects(area=geography'SRID=4326;${bboxToWkt(args.bbox)}')`);
  }
  if (since) {
    const v = since.includes('T') ? since : `${since}T00:00:00.000Z`;
    filters.push(`ContentDate/Start gt ${v}`);
  }
  if (until) {
    const v = until.includes('T') ? until : `${until}T00:00:00.000Z`;
    filters.push(`ContentDate/Start lt ${v}`);
  }
  const params = new URLSearchParams({
    $filter: filters.join(' and '),
    $top: String(top),
    $orderby: 'ContentDate/Start desc',
  });
  const url = `${CATALOG_BASE}/Products?${params.toString()}`;
  const res = await httpGetText(url);
  if (res.status !== 200) {
    throw new Error(`Search failed (${res.status}): ${res.text.slice(0, 300)}`);
  }
  const data = JSON.parse(res.text);
  for (const p of data.value || []) {
    process.stdout.write(
      JSON.stringify({
        id: p.Id,
        name: p.Name,
        sizeMb: Math.round((p.ContentLength || 0) / 1e5) / 10,
        sensingStart: p.ContentDate?.Start,
        sensingEnd: p.ContentDate?.End,
      }) + '\n',
    );
  }
}

async function cmdDownload(args) {
  const id = args.id;
  const out = args.out;
  if (!id || !out) throw new Error('download requires --id <uuid> --out <path>');
  const token = await getToken();
  const url = `${DOWNLOAD_BASE}/Products(${id})/$value`;
  process.stderr.write(`Downloading ${id} -> ${out}\n`);
  const { bytes } = await streamToFile(
    url,
    out,
    { Authorization: `Bearer ${token}` },
    progressReporter(),
  );
  process.stdout.write(`${out}\n`);
  process.stderr.write(`Done: ${(bytes / 1e6).toFixed(1)} MB\n`);
}

async function cmdQuicklook(args) {
  const id = args.id;
  const out = args.out;
  if (!id || !out) throw new Error('quicklook requires --id <uuid> --out <path>');
  const token = await getToken();
  // Look up product Name so we can address the file inside the .SAFE archive
  // by its OData Nodes(...) path. CDSE serves quick-look.png as a navigable
  // node, no need to download the whole 1.7 GB zip.
  const meta = await httpGetText(
    `${CATALOG_BASE}/Products(${id})?$select=Name`,
    { Accept: 'application/json' },
  );
  if (meta.status !== 200) {
    throw new Error(`Product metadata lookup failed (${meta.status}): ${meta.text.slice(0, 300)}`);
  }
  const name = JSON.parse(meta.text).Name;
  if (!name) throw new Error(`Product ${id} has no Name field`);
  const url =
    `${DOWNLOAD_BASE}/Products(${id})/Nodes(${name})` +
    `/Nodes(preview)/Nodes(quick-look.png)/$value`;
  process.stderr.write(`Fetching quicklook for ${name} -> ${out}\n`);
  const { bytes } = await streamToFile(
    url,
    out,
    { Authorization: `Bearer ${token}` },
  );
  process.stdout.write(`${out}\n`);
  process.stderr.write(`Done: ${(bytes / 1024).toFixed(1)} KB\n`);
}

const USAGE = `Usage:
  node scripts/copernicus-fetch.mjs search    [--collection SENTINEL-1|SENTINEL-2|...]
                                              [--name-contains GRDH|SLC|MSIL2A]
                                              [--bbox minLon,minLat,maxLon,maxLat]
                                              [--since YYYY-MM-DD] [--until YYYY-MM-DD]
                                              [--top N]
  node scripts/copernicus-fetch.mjs download  --id <uuid> --out <path-to-.zip>
  node scripts/copernicus-fetch.mjs quicklook --id <uuid> --out <path-to-.png>

Credentials are read from $COPERNICUS_USER / $COPERNICUS_PASSWORD, falling
back to ~/.ai-lecturer/secrets.env. search prints one JSON object per line
(id, name, sizeMb, sensingStart, sensingEnd) so the next step can pipe
through jq. download and quicklook print the output path on stdout and a
short progress log on stderr.
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sub = args._[0];
  if (!sub || args.help) {
    process.stdout.write(USAGE);
    process.exit(sub ? 0 : 1);
  }
  try {
    if (sub === 'search') await cmdSearch(args);
    else if (sub === 'download') await cmdDownload(args);
    else if (sub === 'quicklook') await cmdQuicklook(args);
    else {
      process.stderr.write(`Unknown subcommand: ${sub}\n${USAGE}`);
      process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exit(1);
  }
}

main();
