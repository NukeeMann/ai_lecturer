import path from 'node:path';

export class InvalidSlugError extends Error {
  constructor(slug: string) {
    super(`Invalid slug: ${JSON.stringify(slug)}`);
    this.name = 'InvalidSlugError';
  }
}

export function coursesRoot(): string {
  const override = process.env.COURSES_ROOT_OVERRIDE;
  if (override && override.length > 0) return override;
  // Test-env safety net: refuse to fall back to the developer's real
  // ./courses when running under vitest without an explicit override. The
  // generation pipeline is async/detached, so a leaked write or spawn can
  // resolve coursesRoot() AFTER a test's afterEach has deleted
  // COURSES_ROOT_OVERRIDE — and several fixtures use slugs that collide with
  // real course dirs (`edge-detection-basics`, `demo`). Without this guard
  // such a stray op silently corrupts the real course (observed 2026-06-13:
  // a makeWritingSpawn stub overwrote a real 14 KB lesson). Throwing here
  // makes the isolation violation impossible to miss; the pipeline's
  // best-effort catch blocks swallow it without touching real data.
  if (process.env.VITEST !== undefined || process.env.NODE_ENV === 'test') {
    throw new Error(
      'coursesRoot() called under test without COURSES_ROOT_OVERRIDE — refusing to touch the real ./courses',
    );
  }
  return path.join(process.cwd(), 'courses');
}

export function assertSafeSlug(slug: unknown): asserts slug is string {
  if (typeof slug !== 'string' || slug.length === 0) {
    throw new InvalidSlugError(String(slug));
  }
  if (slug.includes('/') || slug.includes('\\') || slug.includes('..')) {
    throw new InvalidSlugError(slug);
  }
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function courseDir(slug: string): string {
  assertSafeSlug(slug);
  return path.join(coursesRoot(), slug);
}

export function courseFile(slug: string): string {
  return path.join(courseDir(slug), 'course.json');
}

export function courseSpecFile(slug: string): string {
  return path.join(courseDir(slug), 'course-spec.json');
}

export function lessonFile(slug: string, lessonSlug: string): string {
  assertSafeSlug(lessonSlug);
  return path.join(courseDir(slug), 'lessons', `${lessonSlug}.json`);
}

export function genLogsDir(slug: string): string {
  return path.join(courseDir(slug), 'logs');
}

export function stageLogFile(slug: string, stage: string): string {
  assertSafeSlug(stage);
  return path.join(genLogsDir(slug), `${stage}.log`);
}
