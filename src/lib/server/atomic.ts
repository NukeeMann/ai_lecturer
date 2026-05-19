import { promises as fs, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Unique temp name per write. A fixed `${filePath}.tmp` collides when two
  // requests write the same target concurrently (e.g. several first-load
  // `GET /api/progress` calls initialising progress.json at once): writer A
  // renames the shared tmp away, writer B's rename then fails ENOENT. Keep
  // the tmp in the target's directory so the rename stays same-filesystem
  // and therefore atomic.
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tmpPath, content, 'utf8');
  try {
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true });
    throw err;
  }
}

// POSIX rename(2) is atomic, so the rotator for `.generation-events.ndjson`
// (US-138) doesn't need a `.tmp` swap — this thin sync wrapper exists so
// callers opt into atomic-rotation semantics without reaching into node:fs
// directly. Sync because it lives inside the synchronous emit() path that
// must guarantee "ndjson append happens before listeners are notified" — an
// async rename would leak the not-yet-rotated active file into the next
// emit's append.
export function atomicRenameSync(src: string, dest: string): void {
  renameSync(src, dest);
}
