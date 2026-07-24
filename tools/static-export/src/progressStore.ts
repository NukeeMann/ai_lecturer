// Progress persistence for the static export. The real app talks to
// /api/progress (server + ~/.ai-lecturer/progress.json). A static site has
// no server, so we keep an equivalent in localStorage and ALSO answer the
// widgets' own /api/progress fetches from here (see apiShim.ts).
//
// Shape kept deliberately close to the app's Progress schema so the shimmed
// GET /api/progress returns something the widgets can parse.
//
// Storage layers:
//   1) localStorage (primary) — full progress doc per course, including
//      transient `sectionState` (last quiz attempt, user code etc.).
//   2) cookies (backup) — compact "which section ids are completed" map
//      per course. Used only to *rehydrate* when localStorage is empty
//      (private mode, Safari ITP cleanup, history clear, new device on the
//      same browser-cookie scope, etc.). 1-year TTL.
//
// Public API (isSectionDone / setSectionAuto / setSectionManual /
// readProgressDoc / applyProgressPatch / loadCourseProgress) is unchanged —
// cookies are an internal implementation detail.

// Neutral, brand-free storage key so an exported course carries no "AI
// Lecturer" reference anywhere — not even in localStorage keys a curious
// learner might inspect via devtools. (Renaming resets any progress saved
// under the old key, which only matters when re-exporting an already-shared
// course; fresh exports are unaffected.)
const KEY_PREFIX = 'static-course:progress:';

// ---- cookie backup ---------------------------------------------------------

const COOKIE_PREFIX = 'scp__'; // static-course progress (brand-free)
const COOKIE_TTL_SECONDS = 365 * 24 * 60 * 60;
/** Stay safely below the 4096-byte per-cookie hard limit. */
const COOKIE_MAX_BYTES = 3500;
/**
 * Cookie writes are now SYNCHRONOUS (0 ms). The earlier 100 ms debounce
 * "saved" a few cookie writes per rapid checkbox click but introduced a race:
 * if the user hit Refresh within the debounce window the cookie never landed,
 * and on mobile Safari (where localStorage can be wiped by ITP) the progress
 * was effectively lost. `document.cookie =` costs <1 ms; debouncing it bought
 * us nothing.
 */
const COOKIE_DEBOUNCE_MS = 0;
const cookieWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Slug → cookie name. */
function cookieNameFor(courseSlug: string): string {
  return COOKIE_PREFIX + courseSlug;
}

/** Read a single cookie value, URL-decoded; null when absent or no DOM. */
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  for (const raw of document.cookie.split(';')) {
    const c = raw.trim();
    if (c.startsWith(prefix)) {
      try {
        return decodeURIComponent(c.slice(prefix.length));
      } catch {
        return c.slice(prefix.length);
      }
    }
  }
  return null;
}

/**
 * Write a cookie with our standard attributes:
 * - Max-Age = 1 year so progress survives even when localStorage is wiped.
 * - Path=/  so every page under the same host can read it.
 * - SameSite=Lax  is the modern default and works across all our use cases
 *   (the static site never embeds third-party iframes that need the cookie).
 * - Secure  is added ONLY on HTTPS pages. On iOS Safari, cookies on HTTPS
 *   pages without the Secure attribute are treated as "non-essential" by
 *   ITP and can be aged out aggressively; on HTTP the attribute is forbidden
 *   (it would make the browser ignore the cookie entirely).
 */
function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  try {
    const isHttps =
      typeof window !== 'undefined' && window.location?.protocol === 'https:';
    const encoded = encodeURIComponent(value);
    document.cookie =
      `${name}=${encoded}` +
      `; Max-Age=${COOKIE_TTL_SECONDS}` +
      `; Path=/` +
      `; SameSite=Lax` +
      (isHttps ? `; Secure` : '');
  } catch {
    /* document.cookie can throw in odd sandboxes — same policy as localStorage */
  }
}

/** Build the compact { [lessonSlug]: completedSectionIds[] } map. */
function buildCompletedMap(
  course: CourseProgress,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [lessonSlug, lesson] of Object.entries(course.lessons)) {
    const ids = new Set<string>();
    for (const [id, v] of Object.entries(lesson.autoCompletedSections ?? {})) {
      if (v) ids.add(id);
    }
    for (const [id, v] of Object.entries(
      lesson.manuallyCompletedSections ?? {},
    )) {
      if (v) ids.add(id);
    }
    if (ids.size > 0) out[lessonSlug] = [...ids];
  }
  return out;
}

/** Write the cookie, dropping oldest lessons if we hit the size cap. */
function writeCookieWithFallback(
  courseSlug: string,
  map: Record<string, string[]>,
): void {
  const name = cookieNameFor(courseSlug);
  // Empty payload — delete the cookie outright so we don't keep stale state.
  if (Object.keys(map).length === 0) {
    document.cookie =
      `${name}=` +
      `; Max-Age=0` +
      `; Path=/` +
      `; SameSite=Lax`;
    return;
  }
  let payload = JSON.stringify(map);
  // Total budget is name + "=" + encoded(value); URL-encoding can roughly
  // double JSON length when the input is full of " and ,. Estimate worst-case.
  const overhead = name.length + 1;
  let entries = Object.entries(map);
  while (
    overhead + encodeURIComponent(payload).length > COOKIE_MAX_BYTES &&
    entries.length > 1
  ) {
    // Drop the first entry (oldest insertion order in modern JS object) and
    // try again. Last-touched lessons stay — they're the ones the user is
    // actively working on.
    entries = entries.slice(1);
    payload = JSON.stringify(Object.fromEntries(entries));
  }
  if (overhead + encodeURIComponent(payload).length > COOKIE_MAX_BYTES) {
    console.warn(
      `[progressStore] cookie for "${courseSlug}" exceeds ${COOKIE_MAX_BYTES}B even after pruning — skipping cookie backup`,
    );
    return;
  }
  if (entries.length < Object.keys(map).length) {
    console.warn(
      `[progressStore] cookie for "${courseSlug}" was pruned to fit (${entries.length}/${Object.keys(map).length} lessons kept)`,
    );
  }
  writeCookie(name, payload);
}

/** Debounced cookie write — coalesces rapid clicks into one write. */
function scheduleCookieWrite(courseSlug: string, data: CourseProgress): void {
  const prev = cookieWriteTimers.get(courseSlug);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    cookieWriteTimers.delete(courseSlug);
    try {
      writeCookieWithFallback(courseSlug, buildCompletedMap(data));
    } catch {
      /* never throw from the persistence path */
    }
  }, COOKIE_DEBOUNCE_MS);
  cookieWriteTimers.set(courseSlug, timer);
}

/** Rebuild a minimal CourseProgress from the cookie, when localStorage is empty. */
function hydrateFromCookie(courseSlug: string): CourseProgress | null {
  const raw = readCookie(cookieNameFor(courseSlug));
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const course = emptyCourse();
  for (const [lessonSlug, ids] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (!Array.isArray(ids)) continue;
    const lesson: LessonProgress = {
      status: 'started',
      sectionState: {},
      manuallyCompletedSections: {},
      autoCompletedSections: {},
    };
    for (const id of ids) {
      if (typeof id === 'string') {
        // We don't know whether each section was completed via quiz or manual
        // checkbox; treat all rehydrated entries as "auto" so the rebuilt
        // state is functionally equivalent (isSectionDone returns true).
        lesson.autoCompletedSections![id] = true;
      }
    }
    course.lessons[lessonSlug] = lesson;
  }
  return Object.keys(course.lessons).length > 0 ? course : null;
}

// ---- shape -----------------------------------------------------------------

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
    if (raw) {
      const parsed = JSON.parse(raw) as CourseProgress;
      if (parsed && typeof parsed === 'object' && parsed.lessons) {
        return parsed;
      }
    }
  } catch {
    /* fall through to cookie hydrate */
  }
  // localStorage empty or unreadable — try to reconstruct from cookie backup.
  const fromCookie = hydrateFromCookie(courseSlug);
  if (fromCookie) {
    // Best-effort re-seed localStorage so subsequent reads stay fast and we
    // don't re-parse the cookie on every isSectionDone() call.
    try {
      localStorage.setItem(keyFor(courseSlug), JSON.stringify(fromCookie));
    } catch {
      /* private mode etc. — still usable in memory for this session */
    }
    return fromCookie;
  }
  return emptyCourse();
}

function saveCourseProgress(courseSlug: string, data: CourseProgress): void {
  try {
    localStorage.setItem(keyFor(courseSlug), JSON.stringify(data));
  } catch {
    /* quota / private mode — progress just won't persist, widgets still work */
  }
  // Mirror to the cookie backup. Always — cookies survive some failure modes
  // that take localStorage with them (private mode, Safari ITP cleanup).
  scheduleCookieWrite(courseSlug, data);
  // Tell any subscribed components (e.g. the sidebar TOC) that progress has
  // changed, so they can re-read and refresh their completion badges.
  emitProgressChange();
}

// ---- progress change events ------------------------------------------------

const progressEvents =
  typeof EventTarget !== 'undefined' ? new EventTarget() : null;

function emitProgressChange(): void {
  if (!progressEvents) return;
  try {
    progressEvents.dispatchEvent(new Event('change'));
  } catch {
    /* ignore */
  }
}

/**
 * Subscribe to "any progress for any course just changed" events. Returns
 * an unsubscribe function. Used by views that render derived state across
 * multiple sections (e.g. the sidebar TOC showing "X/Y done" per lesson)
 * so they refresh whenever a checkbox or auto-complete flips.
 */
export function onProgressChange(cb: () => void): () => void {
  if (!progressEvents) return () => {};
  progressEvents.addEventListener('change', cb);
  return () => progressEvents.removeEventListener('change', cb);
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

/**
 * Count how many of a lesson's sections are marked done. Pass the full list
 * of `sectionIds` (from the payload's nav) so we can also report the total,
 * which the UI needs to render "X / Y" badges and to decide what's 100% done.
 */
export function getLessonCompletion(
  courseSlug: string,
  lessonSlug: string,
  sectionIds: readonly string[],
): { done: number; total: number } {
  if (sectionIds.length === 0) return { done: 0, total: 0 };
  const c = loadCourseProgress(courseSlug);
  const l = c.lessons[lessonSlug];
  if (!l) return { done: 0, total: sectionIds.length };
  let done = 0;
  for (const id of sectionIds) {
    if (l.autoCompletedSections?.[id] || l.manuallyCompletedSections?.[id]) {
      done++;
    }
  }
  return { done, total: sectionIds.length };
}

/** A lesson is "done" only when every one of its sections is done. */
export function isLessonDone(
  courseSlug: string,
  lessonSlug: string,
  sectionIds: readonly string[],
): boolean {
  if (sectionIds.length === 0) return false;
  const { done, total } = getLessonCompletion(courseSlug, lessonSlug, sectionIds);
  return done >= total;
}

/**
 * "Where should I continue?" — picks the lesson the learner should land on
 * when they re-enter the course.
 *
 * Algorithm (per user spec):
 *   1. Walk the lessons in course order.
 *   2. Find the LAST 100%-done lesson.
 *   3. Return the first lesson AFTER it that is not 100% done.
 *   4. If every lesson is done → return the last lesson (course finished;
 *      the index page can show a "you're done" CTA instead of redirecting).
 *   5. If NO lesson is done → return the first lesson (fresh start).
 *
 * Example from user: lessons 1..10 = 0%, lessons 11..12 = 100%, lessons
 * 13..N = 0%  →  resume at lesson 13.
 *
 * Returns { slug, allDone } so the caller can distinguish "resume here"
 * from "course already complete".
 */
export interface ResumeTarget {
  slug: string;
  /** True only when *every* lesson in the course is 100% done. */
  allDone: boolean;
  /** True when no progress at all has been recorded yet. */
  fresh: boolean;
}

export function getResumeLessonSlug(
  courseSlug: string,
  lessons: ReadonlyArray<{ slug: string; sectionIds?: readonly string[] }>,
): ResumeTarget | null {
  if (lessons.length === 0) return null;

  let lastDoneIdx = -1;
  let anyProgress = false;
  for (let i = 0; i < lessons.length; i++) {
    const ls = lessons[i];
    const ids = ls.sectionIds ?? [];
    const { done, total } = getLessonCompletion(courseSlug, ls.slug, ids);
    if (done > 0) anyProgress = true;
    if (total > 0 && done >= total) lastDoneIdx = i;
  }

  if (lastDoneIdx === lessons.length - 1) {
    // Every lesson up to and including the last is done — course complete.
    return { slug: lessons[lastDoneIdx].slug, allDone: true, fresh: false };
  }
  if (lastDoneIdx >= 0) {
    return {
      slug: lessons[lastDoneIdx + 1].slug,
      allDone: false,
      fresh: false,
    };
  }
  // No lesson is fully done yet — start at the first one. "fresh" lets the
  // caller decide whether to auto-redirect (usually skip it when fresh).
  return { slug: lessons[0].slug, allDone: false, fresh: !anyProgress };
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

// ---- unload safety net -----------------------------------------------------

/**
 * Drain every still-pending cookie write synchronously. The current default
 * of `COOKIE_DEBOUNCE_MS = 0` means there *shouldn't* be any pending timers
 * in practice — but this remains the safety net for callers that change the
 * debounce, and for the global lifecycle listeners below.
 */
export function flushCookieWritesSync(): void {
  for (const [slug, timer] of cookieWriteTimers.entries()) {
    clearTimeout(timer);
    cookieWriteTimers.delete(slug);
    try {
      // Re-read course state so we write the most current snapshot.
      const data = loadCourseProgress(slug);
      writeCookieWithFallback(slug, buildCompletedMap(data));
    } catch {
      /* ignore — never throw from the persistence path */
    }
  }
}

/**
 * Browser-only lifecycle wiring: make sure pending cookie writes land before
 * the page goes away.
 *
 * - `beforeunload` covers desktop refresh / navigate-away (some mobile
 *   browsers, especially iOS Safari, don't fire it reliably though).
 * - `visibilitychange → hidden` is the only signal that fires consistently
 *   on iOS when the user switches tabs / locks the screen / kills the app.
 *   It's the most important one for mobile.
 * - `pagehide` is the back/forward-cache friendly counterpart to
 *   `beforeunload` and is the spec-recommended replacement.
 *
 * Wrapped in a typeof check so the module stays SSR-safe (no-op in Node).
 * `installed` guard prevents double-binding when bundlers HMR this module.
 */
let __lifecycleInstalled = false;
function installLifecycleFlush() {
  if (__lifecycleInstalled) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  __lifecycleInstalled = true;
  window.addEventListener('beforeunload', flushCookieWritesSync);
  window.addEventListener('pagehide', flushCookieWritesSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushCookieWritesSync();
  });
}
installLifecycleFlush();
