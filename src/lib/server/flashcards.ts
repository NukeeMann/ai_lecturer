// Server side of the Anki flashcards feature.
//
// On disk, per course:
//   /courses/<slug>/flashcards/<moduleId>.json   one FlashcardDeck per module
//                                                (written by the
//                                                generate_flashcards skill)
//   /courses/<slug>/flashcards/deck.apkg         the whole course as one Anki
//                                                package, rebuilt from the
//                                                JSON files whenever stale
//
// The flashcards are produced either as the last stage of course generation
// (see runFlashcardsStage in generation.ts) or on demand for an existing
// course (see flashcardsJob.ts). Both spawn the same agent brief built by
// defaultFlashcardsCommand below.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { buildApkg } from '@/lib/flashcards/apkg';
import type { Course } from '@/lib/schemas/course';
import {
  FlashcardDeckSchema,
  type FlashcardDeck,
  type FlashcardsJobStatus,
  type FlashcardsSummary,
} from '@/lib/schemas/flashcards';
import { LessonSchema } from '@/lib/schemas/lesson';
import { readCourse } from './courses';
import { assertSafeSlug, courseDir, courseFile, lessonFile } from './paths';

export const APKG_BASENAME = 'deck.apkg';

export function flashcardsDir(slug: string): string {
  return path.join(courseDir(slug), 'flashcards');
}

export function flashcardsModuleFile(slug: string, moduleId: string): string {
  assertSafeSlug(moduleId);
  return path.join(flashcardsDir(slug), `${moduleId}.json`);
}

export function flashcardsApkgFile(slug: string): string {
  return path.join(flashcardsDir(slug), APKG_BASENAME);
}

export type ModuleFlashcardsResult =
  | { ok: true; deck: FlashcardDeck }
  | { ok: false; reason: string; missing: boolean };

/** Read + validate one module's flashcards file. */
export async function readModuleFlashcards(
  slug: string,
  moduleId: string,
): Promise<ModuleFlashcardsResult> {
  let raw: string;
  try {
    raw = await fs.readFile(flashcardsModuleFile(slug, moduleId), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, missing: true, reason: `flashcards/${moduleId}.json was not written` };
    }
    return { ok: false, missing: false, reason: String(err) };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { ok: false, missing: false, reason: `flashcards/${moduleId}.json is not valid JSON: ${(err as Error).message}` };
  }
  const parsed = FlashcardDeckSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 12)
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    return {
      ok: false,
      missing: false,
      reason: `flashcards/${moduleId}.json failed FlashcardDeckSchema validation:\n${issues}`,
    };
  }
  if (parsed.data.courseSlug !== slug || parsed.data.moduleId !== moduleId) {
    return {
      ok: false,
      missing: false,
      reason: `flashcards/${moduleId}.json has courseSlug=${JSON.stringify(parsed.data.courseSlug)} moduleId=${JSON.stringify(parsed.data.moduleId)}, expected ${JSON.stringify(slug)} / ${JSON.stringify(moduleId)}`,
    };
  }
  return { ok: true, deck: parsed.data };
}

/** Modules worth making flashcards for: at least one lesson file on disk
 * that validates. A module whose lessons all failed to generate has no
 * material to draw from. */
export async function modulesWithLessons(slug: string, course: Course): Promise<Course['modules']> {
  const out: Course['modules'] = [];
  for (const mod of course.modules) {
    for (const les of mod.lessons) {
      try {
        const raw = await fs.readFile(lessonFile(slug, les.slug), 'utf8');
        if (LessonSchema.safeParse(JSON.parse(raw)).success) {
          out.push(mod);
          break;
        }
      } catch {
        /* missing / invalid lesson — keep looking */
      }
    }
  }
  return out;
}

export async function getFlashcardsSummary(
  slug: string,
  job: FlashcardsJobStatus | null = null,
): Promise<FlashcardsSummary | null> {
  const course = await readCourse(slug);
  if (!course) return null;
  const withLessons = new Set((await modulesWithLessons(slug, course)).map((m) => m.id));
  const modules: FlashcardsSummary['modules'] = [];
  let totalCards = 0;
  let missingModules = 0;
  for (const mod of course.modules) {
    const res = await readModuleFlashcards(slug, mod.id);
    const cards = res.ok ? countAnkiCards(res.deck) : 0;
    totalCards += cards;
    if (!res.ok && withLessons.has(mod.id)) missingModules += 1;
    modules.push({ moduleId: mod.id, title: mod.title, cards });
  }
  return { available: totalCards > 0, totalCards, modules, missingModules, job };
}

// Anki cards, not notes: a reversed note is two cards, a cloze note one card
// per distinct cN number. Matches what the learner sees in Anki after import.
export function countAnkiCards(deck: FlashcardDeck): number {
  let n = 0;
  for (const card of deck.cards) {
    if (card.kind === 'cloze') {
      const nums = new Set([...card.text.matchAll(/\{\{c(\d+)::/g)].map((m) => m[1]));
      n += Math.max(1, nums.size);
    } else {
      n += card.reverse ? 2 : 1;
    }
  }
  return n;
}

/** Build the course .apkg from whatever module files are valid right now.
 * Returns null when no module has flashcards. */
export async function buildCourseApkg(slug: string): Promise<Buffer | null> {
  const course = await readCourse(slug);
  if (!course) return null;
  const modules = [];
  for (const mod of course.modules) {
    const res = await readModuleFlashcards(slug, mod.id);
    modules.push({ moduleId: mod.id, title: mod.title, cards: res.ok ? res.deck.cards : [] });
  }
  if (modules.every((m) => m.cards.length === 0)) return null;
  const lessonTitles: Record<string, string> = {};
  for (const mod of course.modules) {
    for (const les of mod.lessons) lessonTitles[les.slug] = les.title;
  }
  const { data } = await buildApkg({
    courseSlug: slug,
    courseTitle: course.title,
    courseDescription: course.description,
    modules,
    lessonTitles,
  });
  return data;
}

export async function writeCourseApkg(slug: string): Promise<string | null> {
  const data = await buildCourseApkg(slug);
  const target = flashcardsApkgFile(slug);
  if (!data) {
    await fs.rm(target, { force: true });
    return null;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(tmp, data);
  try {
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return target;
}

async function mtimeMs(file: string): Promise<number | null> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

/** Path to an up-to-date deck.apkg, rebuilding it when any module file or
 * course.json (deck / module titles) changed after the last build. */
export async function ensureCourseApkg(slug: string): Promise<string | null> {
  const target = flashcardsApkgFile(slug);
  const builtAt = await mtimeMs(target);
  let stale = builtAt === null;
  if (!stale) {
    const inputs = [courseFile(slug)];
    try {
      for (const name of await fs.readdir(flashcardsDir(slug))) {
        if (name.endsWith('.json')) inputs.push(path.join(flashcardsDir(slug), name));
      }
    } catch {
      /* no flashcards dir */
    }
    for (const f of inputs) {
      const m = await mtimeMs(f);
      if (m !== null && m > (builtAt as number)) {
        stale = true;
        break;
      }
    }
  }
  if (!stale) return target;
  return writeCourseApkg(slug);
}

/** "Geografia Polski: powtórka" → safe download names for Content-Disposition. */
export function apkgDownloadNames(courseTitle: string): { utf8: string; ascii: string } {
  const base =
    courseTitle
      .replace(/[\u0000-\u001f/\\:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'flashcards';
  const ascii =
    base
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/ł/g, 'l')
      .replace(/Ł/g, 'L')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'flashcards';
  return { utf8: `${base}.apkg`, ascii: `${ascii}.apkg` };
}

// ── Agent brief ────────────────────────────────────────────────────────────

const MOCK_SCRIPT = path.join(
  process.cwd(),
  'src',
  'lib',
  'server',
  'generationMockScripts',
  'generateFlashcards.cjs',
);

export function defaultFlashcardsCommand(
  slug: string,
  moduleId: string,
  previousAttemptReason?: string,
  isQuizOnly = false,
): { command: string; args: string[] } {
  assertSafeSlug(slug);
  assertSafeSlug(moduleId);
  if (process.env.GENERATION_MOCK === '1') {
    return { command: process.execPath, args: [MOCK_SCRIPT, slug, moduleId] };
  }
  const brief =
    `Run the generate_flashcards skill defined in scripts/ralph/skills/generate_flashcards/SKILL.md. ` +
    `Arguments: slug = "${slug}", module-id = "${moduleId}". ` +
    `Read that SKILL.md and execute its steps end-to-end: read /courses/${slug}/course.json, then every lesson file of module "${moduleId}" under /courses/${slug}/lessons/, ` +
    `and write exactly one file, /courses/${slug}/flashcards/${moduleId}.json, validated against FlashcardDeckSchema in src/lib/schemas/flashcards.ts. ` +
    `If that file already exists, read it first and keep the ids of cards that still cover the same fact. ` +
    `Do NOT modify course.json, any lesson file, or any other module's flashcards. Do NOT touch scripts/ralph/. One call, one module.`;
  const prompt = previousAttemptReason
    ? `PREVIOUS ATTEMPT FAILED:\n${previousAttemptReason}\n\nFix these issues specifically.\n\n${brief}`
    : brief;
  return {
    command: 'claude',
    args: [
      '-p',
      prompt,
      // Same model split as the lesson stage: full courses run on Opus,
      // quiz-only courses on Sonnet.
      '--model',
      isQuizOnly ? 'sonnet' : 'opus',
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ],
  };
}
