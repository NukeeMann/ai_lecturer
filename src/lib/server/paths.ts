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
