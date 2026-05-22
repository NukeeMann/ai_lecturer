// Course landing page: title, description, module → lesson outline with
// links to the per-lesson static pages. No AI, no chat, no generation UI.

import type { SxPayload } from './payload';

export function CourseIndex({ payload }: { payload: SxPayload }) {
  const course = payload.course ?? {};
  const lessonHref = (slug: string) => `${payload.lessonHrefBase}${slug}.html`;

  let totalLessons = 0;
  for (const m of payload.nav) totalLessons += m.lessons.length;

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
                {m.lessons.map((l, li) => (
                  <li key={l.slug} className="sx-lesson-row">
                    <a href={lessonHref(l.slug)}>
                      <span className="sx-lesson-num">
                        {mi + 1}.{li + 1}
                      </span>
                      <span className="sx-lesson-title">{l.title}</span>
                    </a>
                  </li>
                ))}
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
          </a>{' '}
          · interactive widgets run locally in your browser.
        </footer>
      </main>
    </div>
  );
}
