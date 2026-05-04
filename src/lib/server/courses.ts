import { promises as fs } from 'node:fs';
import { CourseSchema, type Course } from '@/lib/schemas/course';
import { courseFile } from '@/lib/server/paths';

/**
 * Reads a course's `course.json` from disk and validates it against
 * `CourseSchema`. Returns null when the course directory does not exist.
 * Throws `InvalidSlugError` for unsafe slugs and propagates JSON / Zod
 * errors so callers can map them to HTTP responses or 404s as appropriate.
 */
export async function readCourse(slug: string): Promise<Course | null> {
  const file = courseFile(slug);

  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  const json: unknown = JSON.parse(raw);
  return CourseSchema.parse(json);
}
