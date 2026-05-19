// The exporter injects `window.__SX__` into every generated HTML page,
// before the bundle loads. This is the only contract between export.mjs
// (Node build step) and the runtime React app.

export interface SxNavLesson {
  slug: string;
  title: string;
  moduleId: string;
}

export interface SxNavModule {
  id: string;
  title: string;
  summary?: string;
  lessons: SxNavLesson[];
}

export interface SxPayload {
  /** Which page this is. */
  kind: 'index' | 'lesson';
  /** Course slug (used to match /api/courses/<slug>/assets/... fetches). */
  courseSlug: string;
  /** Full course.json (already validated by the app when generated). */
  course: any;
  /** Full lesson.json — only on kind === 'lesson'. */
  lesson?: any;
  /** Flat module/lesson nav for the sidebar + prev/next. */
  nav: SxNavModule[];
  /** Relative href prefix to reach sibling lesson pages from THIS page. */
  lessonHrefBase: string;
  /** Relative href to the course index from THIS page. */
  indexHref: string;
  /** Relative URL prefix where copied course assets live, from THIS page. */
  courseAssetBase: string;
}

export function readPayload(): SxPayload {
  const p = (window as any).__SX__ as SxPayload | undefined;
  if (!p) {
    throw new Error(
      '[static-export] window.__SX__ missing — this page was not produced by export.mjs.',
    );
  }
  return p;
}
