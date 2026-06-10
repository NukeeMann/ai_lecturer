// Path helpers, ported to plain JS from src/lib/server/paths.ts. Pure, no deps.
// This tool lives at <repo>/tools/gemini-polish; repoRoot is two levels up.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const toolDir = path.resolve(here, '..');
export const repoRoot = path.resolve(toolDir, '..', '..');

export class InvalidSlugError extends Error {
  constructor(slug) {
    super(`Invalid slug: ${JSON.stringify(slug)}`);
    this.name = 'InvalidSlugError';
  }
}

export function assertSafeSlug(slug) {
  if (typeof slug !== 'string' || slug.length === 0) {
    throw new InvalidSlugError(String(slug));
  }
  if (slug.includes('/') || slug.includes('\\') || slug.includes('..')) {
    throw new InvalidSlugError(slug);
  }
}

export function coursesRoot() {
  const override = process.env.COURSES_ROOT_OVERRIDE;
  if (override && override.length > 0) return override;
  return path.join(repoRoot, 'courses');
}

export function courseDir(slug) {
  assertSafeSlug(slug);
  return path.join(coursesRoot(), slug);
}

export function courseFile(slug) {
  return path.join(courseDir(slug), 'course.json');
}

export function lessonsDir(slug) {
  return path.join(courseDir(slug), 'lessons');
}

export function lessonFile(slug, lessonSlug) {
  assertSafeSlug(lessonSlug);
  return path.join(courseDir(slug), 'lessons', `${lessonSlug}.json`);
}
