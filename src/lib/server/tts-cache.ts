// US-154: soft-cap LRU eviction for ~/.ai-lecturer/tts-cache/.
// Called on every successful /api/tts response. The directory is small
// (each .wav is a few hundred KB at most for a paragraph of text), so
// an O(N) full-scan is fine.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEFAULT_TTS_CACHE_BUDGET_BYTES = 500 * 1024 * 1024; // 500MB

/** Resolve the project's "home" directory under which we stash user-level
 *  state (TTS cache, progress.json, etc.). Honours `AI_LECTURER_HOME_OVERRIDE`
 *  for tests so we never touch the real user home. */
export function aiLecturerHome(): string {
  const override = process.env.AI_LECTURER_HOME_OVERRIDE;
  if (override && override.length > 0) return override;
  return path.join(os.homedir(), '.ai-lecturer');
}

export function ttsCacheDir(): string {
  return path.join(aiLecturerHome(), 'tts-cache');
}

export interface CacheFile {
  name: string;
  fullPath: string;
  size: number;
  mtimeMs: number;
}

export async function listCacheFiles(dir: string = ttsCacheDir()): Promise<CacheFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const entries: CacheFile[] = [];
  for (const name of names) {
    const fullPath = path.join(dir, name);
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    entries.push({ name, fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return entries;
}

/**
 * Evict oldest files (by mtime) until total bytes ≤ budget. Returns the
 * names of removed files (useful for tests / telemetry).
 */
export async function evictOldestUntilUnderBudget(opts: {
  dir?: string;
  budgetBytes?: number;
} = {}): Promise<string[]> {
  const dir = opts.dir ?? ttsCacheDir();
  const budgetBytes = opts.budgetBytes ?? DEFAULT_TTS_CACHE_BUDGET_BYTES;
  const files = await listCacheFiles(dir);
  let total = files.reduce((acc, f) => acc + f.size, 0);
  if (total <= budgetBytes) return [];

  // Oldest first.
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const removed: string[] = [];
  for (const f of files) {
    if (total <= budgetBytes) break;
    try {
      await fs.unlink(f.fullPath);
      total -= f.size;
      removed.push(f.name);
    } catch {
      // best-effort eviction; ignore individual failures
    }
  }
  return removed;
}
