// Progress persistence for the static export. The real app talks to
// /api/progress (server + ~/.ai-lecturer/progress.json). A static site has
// no server, so we keep an equivalent in localStorage and ALSO answer the
// widgets' own /api/progress fetches from here (see apiShim.ts).
//
// Shape kept deliberately close to the app's Progress schema so the shimmed
// GET /api/progress returns something the widgets can parse.

const KEY_PREFIX = 'ai-lecturer-static:progress:';

interface LessonProgress {
  status: 'not_started' | 'started' | 'finished';
  startedAt?: string;
  finishedAt?: string;
  sectionState?: Record<string, unknown>;
  manuallyCompletedSections?: Record<string, boolean>;
  /** Our own extra: per-section auto-completion (quiz solved / tests passed). */
  autoCompletedSections?: Record<string, boolean>;
}

interface CourseProgress {
  lastVisitedAt?: string;
  lastVisitedLessonSlug?: string;
  lessons: Record<string, LessonProgress>;
}

export interface ProgressDoc {
  courses: Record<string, CourseProgress>;
}

function keyFor(courseSlug: string): string {
  return KEY_PREFIX + courseSlug;
}

function emptyCourse(): CourseProgress {
  return { lessons: {} };
}

export function loadCourseProgress(courseSlug: string): CourseProgress {
  try {
    const raw = localStorage.getItem(keyFor(courseSlug));
    if (!raw) return emptyCourse();
    const parsed = JSON.parse(raw) as CourseProgress;
    if (!parsed || typeof parsed !== 'object' || !parsed.lessons) {
      return emptyCourse();
    }
    return parsed;
  } catch {
    return emptyCourse();
  }
}

function saveCourseProgress(courseSlug: string, data: CourseProgress): void {
  try {
    localStorage.setItem(keyFor(courseSlug), JSON.stringify(data));
  } catch {
    /* quota / private mode — progress just won't persist, widgets still work */
  }
}

function ensureLesson(
  course: CourseProgress,
  lessonSlug: string,
): LessonProgress {
  if (!course.lessons[lessonSlug]) {
    course.lessons[lessonSlug] = { status: 'not_started' };
  }
  const l = course.lessons[lessonSlug];
  l.sectionState ??= {};
  l.manuallyCompletedSections ??= {};
  l.autoCompletedSections ??= {};
  return l;
}

/** True if a section is complete via either auto-signal or manual checkbox. */
export function isSectionDone(
  courseSlug: string,
  lessonSlug: string,
  sectionId: string,
): boolean {
  const c = loadCourseProgress(courseSlug);
  const l = c.lessons[lessonSlug];
  if (!l) return false;
  return Boolean(
    l.autoCompletedSections?.[sectionId] ||
      l.manuallyCompletedSections?.[sectionId],
  );
}

export function setSectionAuto(
  courseSlug: string,
  lessonSlug: string,
  sectionId: string,
  done: boolean,
): void {
  const c = loadCourseProgress(courseSlug);
  const l = ensureLesson(c, lessonSlug);
  l.autoCompletedSections![sectionId] = done;
  if (l.status === 'not_started') {
    l.status = 'started';
    l.startedAt = new Date().toISOString();
  }
  saveCourseProgress(courseSlug, c);
}

export function setSectionManual(
  courseSlug: string,
  lessonSlug: string,
  sectionId: string,
  done: boolean,
): void {
  const c = loadCourseProgress(courseSlug);
  const l = ensureLesson(c, lessonSlug);
  if (done) l.manuallyCompletedSections![sectionId] = true;
  else delete l.manuallyCompletedSections![sectionId];
  saveCourseProgress(courseSlug, c);
}

/** /api/progress GET payload (shimmed). */
export function readProgressDoc(courseSlug: string): ProgressDoc {
  return { courses: { [courseSlug]: loadCourseProgress(courseSlug) } };
}

/** /api/progress PATCH (shimmed) — best-effort merge of the app's patch shape. */
export function applyProgressPatch(patch: any): void {
  if (!patch || typeof patch !== 'object') return;
  const courseSlug = patch.courseSlug;
  const lessonSlug = patch.lessonSlug;
  if (typeof courseSlug !== 'string' || typeof lessonSlug !== 'string') return;
  const c = loadCourseProgress(courseSlug);
  const l = ensureLesson(c, lessonSlug);
  if (patch.status === 'started' || patch.status === 'finished') {
    l.status = patch.status;
    if (patch.status === 'finished' && !l.finishedAt) {
      l.finishedAt = new Date().toISOString();
    }
  }
  if (patch.sectionState && typeof patch.sectionState === 'object') {
    l.sectionState = { ...l.sectionState, ...patch.sectionState };
  }
  if (
    patch.manuallyCompletedSections &&
    typeof patch.manuallyCompletedSections === 'object'
  ) {
    for (const [id, v] of Object.entries(patch.manuallyCompletedSections)) {
      if (v) l.manuallyCompletedSections![id] = true;
      else delete l.manuallyCompletedSections![id];
    }
  }
  saveCourseProgress(courseSlug, c);
}
