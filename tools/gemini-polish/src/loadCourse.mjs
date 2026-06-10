// Load a course's course.json + lesson JSONs from disk. Mirrors the
// loadCourseWithLessons() pattern in tools/static-export/scripts/export.mjs.

import { promises as fs } from 'node:fs';
import { courseFile, lessonFile } from './paths.mjs';

function die(msg) {
  console.error(`\n[gemini-polish] ERROR: ${msg}\n`);
  process.exit(1);
}

export async function readJson(file) {
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

export async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns an ordered list of { slug, file, lesson } for the course's lessons.
 * If `onlyLesson` is given, restricts to that one lesson slug.
 */
export async function loadCourseLessons(slug, onlyLesson = null) {
  const courseJsonPath = courseFile(slug);
  if (!(await exists(courseJsonPath))) {
    die(`course not found: ${courseJsonPath}`);
  }
  const course = await readJson(courseJsonPath);
  const modules = Array.isArray(course.modules) ? course.modules : [];

  const out = [];
  const seen = new Set();
  for (const m of modules) {
    for (const ref of m.lessons ?? []) {
      const lessonSlug = ref.slug;
      if (!lessonSlug || seen.has(lessonSlug)) continue;
      if (onlyLesson && lessonSlug !== onlyLesson) continue;
      const file = lessonFile(slug, lessonSlug);
      if (!(await exists(file))) {
        console.warn(`[gemini-polish] WARN: ${slug}/${lessonSlug}.json missing, skipping`);
        continue;
      }
      seen.add(lessonSlug);
      out.push({ slug: lessonSlug, file, lesson: await readJson(file) });
    }
  }
  if (onlyLesson && out.length === 0) {
    die(`lesson "${onlyLesson}" not found in course "${slug}"`);
  }
  return { course, lessons: out };
}
