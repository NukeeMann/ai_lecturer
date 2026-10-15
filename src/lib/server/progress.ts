import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  ProgressSchema,
  SectionStateSchema,
  type Progress,
} from '@/lib/schemas/progress';
import { atomicWriteJson } from '@/lib/server/atomic';

export function progressFile(): string {
  const override = process.env.PROGRESS_FILE_OVERRIDE;
  if (override && override.length > 0) return override;
  return path.join(os.homedir(), '.ai-lecturer', 'progress.json');
}

export function defaultProgress(): Progress {
  return { courses: {} };
}

export async function readOrInitProgress(): Promise<Progress> {
  const file = progressFile();
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      const initial = defaultProgress();
      await atomicWriteJson(file, initial);
      return initial;
    }
    throw err;
  }
  const json: unknown = JSON.parse(raw);
  return ProgressSchema.parse(json);
}

/**
 * Upper bound for one section's serialized `widgetState` in a PATCH. The
 * whole progress file is re-read and rewritten on every PATCH, so a runaway
 * widget must not be able to bloat it. Enforced on writes only — reading an
 * existing progress.json never fails because of it.
 */
export const MAX_WIDGET_STATE_CHARS = 64 * 1024;

const PatchSectionStateSchema = SectionStateSchema.superRefine((state, ctx) => {
  if (state.widgetState === undefined) return;
  const size = JSON.stringify(state.widgetState).length;
  if (size > MAX_WIDGET_STATE_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['widgetState'],
      message: `widgetState is ${size} chars once serialized; the limit is ${MAX_WIDGET_STATE_CHARS}`,
    });
  }
});

export const ProgressPatchSchema = z.object({
  courseSlug: z.string().min(1),
  lessonSlug: z.string().min(1),
  status: z.enum(['started', 'finished']).optional(),
  markVisited: z.boolean().optional(),
  /**
   * Per-section REPLACEMENT: each listed section's stored object becomes
   * exactly the value sent. The Code widget's reset relies on this (it sends
   * `{}` to clear `userCode`/`done`), and widgets that persist `widgetState`
   * send their full state.
   */
  sectionState: z.record(PatchSectionStateSchema).optional(),
  /**
   * Per-section shallow MERGE into the stored object, applied after
   * `sectionState`. For writers that only want to set some fields without
   * knowing the rest — e.g. the lesson page marking sections `done: true`
   * (auto-advance, Space) must not wipe the `widgetState`/`score` a widget
   * wrote directly to the server.
   */
  mergeSectionState: z.record(PatchSectionStateSchema).optional(),
  manuallyCompletedSections: z.record(z.boolean()).optional(),
});

export type ProgressPatch = z.infer<typeof ProgressPatchSchema>;

export function applyProgressPatch(
  current: Progress,
  patch: ProgressPatch,
  now: string,
): Progress {
  const next: Progress = {
    courses: { ...current.courses },
  };

  const existingCourse = next.courses[patch.courseSlug];
  const course = existingCourse
    ? { ...existingCourse, lessons: { ...existingCourse.lessons } }
    : { lessons: {} };
  next.courses[patch.courseSlug] = course;

  const existingLesson = course.lessons[patch.lessonSlug];
  const lesson = existingLesson
    ? { ...existingLesson }
    : { status: 'not_started' as const };
  course.lessons[patch.lessonSlug] = lesson;

  let touched = false;

  if (patch.status !== undefined && patch.status !== lesson.status) {
    lesson.status = patch.status;
    if (patch.status === 'started' && !lesson.startedAt) {
      lesson.startedAt = now;
    }
    if (patch.status === 'finished' && !lesson.finishedAt) {
      lesson.finishedAt = now;
    }
    touched = true;
  }

  if (patch.sectionState) {
    lesson.sectionState = {
      ...(lesson.sectionState ?? {}),
      ...patch.sectionState,
    };
  }

  if (patch.mergeSectionState) {
    const merged = { ...(lesson.sectionState ?? {}) };
    for (const [sectionId, fields] of Object.entries(patch.mergeSectionState)) {
      merged[sectionId] = { ...(merged[sectionId] ?? {}), ...fields };
    }
    lesson.sectionState = merged;
  }

  if (patch.manuallyCompletedSections) {
    const merged: Record<string, boolean> = {
      ...(lesson.manuallyCompletedSections ?? {}),
    };
    for (const [sectionId, value] of Object.entries(
      patch.manuallyCompletedSections,
    )) {
      if (value) merged[sectionId] = true;
      else delete merged[sectionId];
    }
    if (Object.keys(merged).length > 0) {
      lesson.manuallyCompletedSections = merged;
    } else {
      delete lesson.manuallyCompletedSections;
    }
  }

  if (patch.markVisited === true) {
    touched = true;
  }

  if (touched) {
    course.lastVisitedAt = now;
    course.lastVisitedLessonSlug = patch.lessonSlug;
  }

  return next;
}
