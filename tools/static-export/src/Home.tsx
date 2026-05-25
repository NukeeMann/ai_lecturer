// Library home page: title + one section per collection, each section
// is a grid of course tiles. Clicking a tile goes to the course's index.

import type { SxPayload } from './payload';
import { AccentIcon } from './AccentIcon';

const DEFAULT_EYEBROW = 'AI Lecturer · Static library';
const DEFAULT_FOOTER_HTML =
  'Exported from <a href="https://github.com/NukeeMann/ai_lecturer" target="_blank" rel="noopener noreferrer">AI Lecturer</a> · interactive widgets run locally in your browser.';

export function Home({ payload }: { payload: SxPayload }) {
  const lib = payload.library;
  if (!lib) {
    return (
      <div className="sx-shell sx-shell--index">
        <main className="sx-main sx-main--index">
          <p>No library payload — this page was not produced correctly.</p>
        </main>
      </div>
    );
  }

  const totalCourses = lib.collections.reduce(
    (sum, c) => sum + c.courses.length,
    0,
  );
  const totalLessons = lib.collections.reduce(
    (sum, c) =>
      sum + c.courses.reduce((s, course) => s + course.lessonsCount, 0),
    0,
  );

  const eyebrow = lib.eyebrow ?? DEFAULT_EYEBROW;
  const footerHtml = lib.footerHtml ?? DEFAULT_FOOTER_HTML;

  return (
    <div className="sx-shell sx-shell--index">
      <main className="sx-main sx-main--index sx-main--home">
        <header className="sx-course-head">
          <div className="sx-eyebrow">{eyebrow}</div>
          <h1>{lib.title}</h1>
          <div className="sx-course-meta">
            {lib.collections.length} collection
            {lib.collections.length === 1 ? '' : 's'} · {totalCourses} course
            {totalCourses === 1 ? '' : 's'} · {totalLessons} lesson
            {totalLessons === 1 ? '' : 's'}
          </div>
          {lib.subtitle ? (
            <p className="sx-course-desc">{lib.subtitle}</p>
          ) : null}
        </header>

        {lib.collections.map((coll) => (
          <section key={coll.id} className="sx-collection">
            <header className="sx-collection-head">
              <h2>{coll.name}</h2>
              <span className="sx-collection-meta">
                {coll.courses.length} course
                {coll.courses.length === 1 ? '' : 's'}
              </span>
            </header>
            {coll.courses.length === 0 ? (
              <p className="sx-collection-empty">
                No courses in this collection.
              </p>
            ) : (
              <ul className="sx-card-grid">
                {coll.courses.map((course) => (
                  <li key={course.slug} className="sx-card-li">
                    <a className="sx-card" href={course.href}>
                      <AccentIcon
                        iconName={course.icon}
                        accent={course.accentColor}
                        size={44}
                        glyphSize={22}
                      />
                      <div className="sx-card-body">
                        <h3 className="sx-card-title">{course.title}</h3>
                        {course.description ? (
                          <p className="sx-card-desc">{course.description}</p>
                        ) : null}
                        <div className="sx-card-meta">
                          {course.modulesCount} module
                          {course.modulesCount === 1 ? '' : 's'} ·{' '}
                          {course.lessonsCount} lesson
                          {course.lessonsCount === 1 ? '' : 's'}
                        </div>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <footer
          className="sx-foot"
          dangerouslySetInnerHTML={{ __html: footerHtml }}
        />
      </main>
    </div>
  );
}
