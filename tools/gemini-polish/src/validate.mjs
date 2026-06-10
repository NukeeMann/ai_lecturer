// Validate a lesson object against the app's real LessonSchema by piping it to
// the tsx validator (tools/validate-lesson.ts) run from the repo root.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { repoRoot, toolDir } from './paths.mjs';

const TSX_BIN = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const VALIDATOR = path.join(toolDir, 'tools', 'validate-lesson.ts');

/** Returns { ok: boolean, errors: string }. */
export function validateLesson(lessonObj) {
  return new Promise((resolve) => {
    const child = spawn(TSX_BIN, [VALIDATOR], {
      cwd: repoRoot, // so the @/ alias resolves via root tsconfig
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ ok: false, errors: `validator spawn failed: ${e.message}` }));
    child.on('close', (code) => resolve({ ok: code === 0, errors: err.trim() }));
    child.stdin.write(JSON.stringify(lessonObj));
    child.stdin.end();
  });
}
