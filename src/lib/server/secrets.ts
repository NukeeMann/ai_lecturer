// Loads dotenv-style key/value pairs from `~/.ai-lecturer/secrets.env` so the
// course-generation pipeline can pass third-party credentials (e.g. Copernicus
// Data Space user/password for SAR imagery) into spawned `claude -p` children
// via their environment. The file lives outside the repo, so secrets never
// land in git or course artifacts.
//
// Format: one `KEY=VALUE` per line, `#` line comments, surrounding single or
// double quotes stripped. Missing file → empty record (no throw); malformed
// lines are skipped silently so a typo can't brick course generation.

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function secretsEnvPath(): string {
  return path.join(os.homedir(), '.ai-lecturer', 'secrets.env');
}

export function parseSecretsEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadSecretsEnv(filePath: string = secretsEnvPath()): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return {};
  }
  return parseSecretsEnv(raw);
}
