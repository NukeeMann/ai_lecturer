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

export const ProgressPatchSchema = z.object({
  courseSlug: z.string().min(1),
  lessonSlug: z.string().min(1),
  status: z.enum(['started', 'finished']).optional(),
  markVisited: z.boolean().optional(),
  sectionState: z.record(SectionStateSchema).optional(),
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

  if (patch.markVisited === true) {
    touched = true;
  }

  if (touched) {
    course.lastVisitedAt = now;
    course.lastVisitedLessonSlug = patch.lessonSlug;
  }

  return next;
}
