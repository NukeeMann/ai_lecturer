import { promises as fs, renameSync } from 'node:fs';
import path from 'node:path';

export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, filePath);
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
