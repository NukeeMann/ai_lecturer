// Backup helper: copy <lesson>.json -> <lesson>.json.bak BEFORE overwriting.
// By default refuses to clobber an existing .bak, so the pristine original
// survives repeated runs (idempotency). --force overrides.

import { promises as fs } from 'node:fs';
import { exists } from './loadCourse.mjs';

export async function writeBackup(lessonFilePath, { force = false } = {}) {
  const bak = lessonFilePath + '.bak';
  if (await exists(bak)) {
    if (!force) return { skipped: true, path: bak };
  }
  await fs.copyFile(lessonFilePath, bak);
  return { skipped: false, path: bak };
}
