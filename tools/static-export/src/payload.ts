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

/** A single course shown as a tile inside a collection section on the
 *  library home page. Slim — only what the tile needs to render. */
export interface SxLibraryCourse {
  slug: string;
  title: string;
  description?: string;
  accentColor?: string;
  icon?: string;
  modulesCount: number;
  lessonsCount: number;
  /** Relative URL from the library home to the course's index.html. */
  href: string;
}

export interface SxLibraryCollection {
  id: string;
  name: string;
  courses: SxLibraryCourse[];
}

export interface SxPayload {
  /** Which page this is. */
  kind: 'home' | 'index' | 'lesson';
  /** Course slug (used to match /api/courses/<slug>/assets/... fetches).
   *  Empty string on the library home page (no course context). */
  courseSlug: string;
  /** Full course.json (already validated by the app when generated).
   *  Absent on `home` pages. */
  course?: any;
  /** Full lesson.json — only on kind === 'lesson'. */
  lesson?: any;
  /** Flat module/lesson nav for the sidebar + prev/next. Empty on `home`. */
  nav: SxNavModule[];
  /** Relative href prefix to reach sibling lesson pages from THIS page. */
  lessonHrefBase: string;
  /** Relative href to the course index from THIS page. */
  indexHref: string;
  /** Relative URL prefix where copied course assets live, from THIS page.
   *  Empty string on the library home page (no specific course context). */
  courseAssetBase: string;
  /** Relative URL to the library home (index.html). Only set in library mode;
   *  absent for the legacy single-course exports — that's how the UI decides
   *  whether to render the "← Library" back-link. */
  homeHref?: string;
  /** Library bundle metadata (collections + courses). Only on kind === 'home'. */
  library?: {
    title: string;
    /** Eyebrow above the title. Defaults to "AI Lecturer · Static library". */
    eyebrow?: string;
    /** Optional one-line subtitle below the count line. */
    subtitle?: string | null;
    /** Custom footer HTML. Defaults to the "Exported from AI Lecturer …" string. */
    footerHtml?: string;
    collections: SxLibraryCollection[];
  };
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
