// Reads a lesson JSON on stdin and validates it against the app's real
// LessonSchema. Exits 0 on success, 1 on schema failure (issues on stderr),
// 2 on JSON parse failure. Run via tsx from the repo root so the `@/` alias
// resolves to <repo>/src.

import { LessonSchema } from '@/lib/schemas/lesson';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    console.error('JSON parse error: ' + (e as Error).message);
    process.exit(2);
  }
  const res = LessonSchema.safeParse(json);
  if (res.success) {
    process.exit(0);
  }
  console.error(JSON.stringify(res.error.issues.slice(0, 25), null, 2));
  process.exit(1);
});
