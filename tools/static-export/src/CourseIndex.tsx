// Course landing page: title, description, module → lesson outline with
// links to the per-lesson static pages. No AI, no chat, no generation UI.
//
// Behaviour on visit:
//   - Compute resume target (last 100%-done lesson → next, see
//     getResumeLessonSlug). If the learner has *any* progress, auto-redirect
//     to that lesson so they can keep going on whatever device they pick up.
//   - Bypass the redirect when the URL has `?index=1` — used when the
//     learner explicitly wants the outline (e.g. clicking the title from
//     inside a lesson).

import { useEffect, useMemo } from 'react';
import type { SxPayload, SxNavLesson, SxNavModule } from './payload';
import { getLessonCompletion, getResumeLessonSlug } from './progressStore';

function flattenLessons(
  nav: SxNavModule[],
): Array<SxNavLesson & { moduleIndex: number; lessonIndex: number }> {
  const out: Array<SxNavLesson & { moduleIndex: number; lessonIndex: number }> = [];
  nav.forEach((m, mi) => {
    m.lessons.forEach((l, li) => {
      out.push({ ...l, moduleIndex: mi, lessonIndex: li });
    });
  });
  return out;
}

export function CourseIndex({ payload }: { payload: SxPayload }) {
  const course = payload.course ?? {};
  const lessonHref = (slug: string) => `${payload.lessonHrefBase}${slug}.html`;

  const flatLessons = useMemo(() => flattenLessons(payload.nav), [payload.nav]);

  let totalLessons = 0;
  for (const m of payload.nav) totalLessons += m.lessons.length;

  // Resume target: where should the learner pick up?
  // Recomputed on every render (cheap — small arrays) so the badge always
  // reflects what's in localStorage right now, not what we saw at first load.
  const resume = useMemo(
    () =>
      getResumeLessonSlug(
        payload.courseSlug,
        flatLessons.map((l) => ({ slug: l.slug, sectionIds: l.sectionIds })),
      ),
    [payload.courseSlug, flatLessons],
  );

  useEffect(() => {
    // Skip auto-redirect when:
    //  - learner explicitly asked for the outline (`?index=1`)
    //  - there's no resume target (empty course)
    //  - learner is completely fresh (no progress at all — let them see the
    //    course outline before diving in)
    //  - the course is fully complete (stay on index — show "all done")
    if (!resume || resume.fresh || resume.allDone) return;
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('index')) return;
    } catch {
      /* ignore — proceed with redirect */
    }
    // Use replace() so the index page doesn't end up in browser history —
    // the back button should take the learner to the library home, not loop
    // back to the redirect page.
    window.location.replace(lessonHref(resume.slug));
  }, [resume, payload.lessonHrefBase]);

  const continueHref = resume ? lessonHref(resume.slug) : null;
  const continueLabel = resume?.allDone
    ? 'Review last lesson'
    : resume?.fresh
    ? 'Start course'
    : 'Continue';

  return (
    <div className="sx-shell sx-shell--index">
      <main className="sx-main sx-main--index">
        {payload.homeHref ? (
          <a className="sx-back-link" href={payload.homeHref}>
            ← Library
          </a>
        ) : null}
        <header className="sx-course-head">
          <div className="sx-eyebrow">AI Lecturer · Static course</div>
          <h1>{course.title ?? payload.courseSlug}</h1>
          {course.description ? (
            <p className="sx-course-desc">{course.description}</p>
          ) : null}
          <div className="sx-course-meta">
            {payload.nav.length} module{payload.nav.length === 1 ? '' : 's'} ·{' '}
            {totalLessons} lesson{totalLessons === 1 ? '' : 's'}
          </div>
          {continueHref && (
            <a className="sx-continue-cta" href={continueHref}>
              ▶ {continueLabel}
            </a>
          )}
        </header>

        <ol className="sx-modules">
          {payload.nav.map((m, mi) => (
            <li key={m.id} className="sx-module">
              <div className="sx-module-head">
                <span className="sx-module-index">Module {mi + 1}</span>
                <h2>{m.title}</h2>
                {m.summary ? (
                  <p className="sx-module-summary">{m.summary}</p>
                ) : null}
              </div>
              <ol className="sx-lessons">
                {m.lessons.map((l, li) => {
                  const ids = l.sectionIds ?? [];
                  const { done, total } = getLessonCompletion(
                    payload.courseSlug,
                    l.slug,
                    ids,
                  );
                  const isDone = total > 0 && done >= total;
                  const isPartial = !isDone && done > 0;
                  return (
                    <li
                      key={l.slug}
                      className="sx-lesson-row"
                      data-completion={
                        isDone ? 'done' : isPartial ? 'partial' : 'none'
                      }
                    >
                      <a href={lessonHref(l.slug)}>
                        <span className="sx-lesson-num">
                          {mi + 1}.{li + 1}
                        </span>
                        <span className="sx-lesson-title">{l.title}</span>
                        <span className="sx-lesson-status" aria-hidden>
                          {isDone
                            ? '✓'
                            : total > 0
                            ? `${done}/${total}`
                            : ''}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>

        <footer className="sx-foot">
          Exported from{' '}
          <a
            href="https://github.com/NukeeMann/ai_lecturer"
            target="_blank"
            rel="noopener noreferrer"
          >
            AI Lecturer
          </a>
        </footer>
      </main>
    </div>
  );
}
