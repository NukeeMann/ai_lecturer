// Faithful, minimal re-implementation of the app's SectionRenderer
// (src/app/courses/[slug]/lessons/[lessonSlug]/page.tsx). It renders the
// REAL widget components from the main project, wrapped in the REAL <Widget>
// chrome — with the exact per-widget props the app passes — but with every
// AI / edit / regenerate / chat affordance removed.

import { useCallback, useMemo, useState } from 'react';
import { Widget } from '@/widgets/Widget';
import { widgetRegistry, type WidgetType } from '@/widgets/registry';
import { Callout } from '@/components/Callout';
import type { SxPayload } from './payload';
import {
  isSectionDone,
  setSectionAuto,
  setSectionManual,
} from './progressStore';

interface SectionLike {
  id: string;
  type: string;
  title: string;
  description?: string;
  data: unknown;
  sources?: unknown[];
}

interface LessonLike {
  slug: string;
  title: string;
  eyebrow?: string;
  description?: string;
  moduleId: string;
  sections: SectionLike[];
  sources?: Array<{
    title: string;
    author?: string;
    year?: number | string;
    url?: string;
  }>;
}

function SectionView({
  section,
  index,
  courseSlug,
  lessonSlug,
}: {
  section: SectionLike;
  index: number;
  courseSlug: string;
  lessonSlug: string;
}) {
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);

  const done = isSectionDone(courseSlug, lessonSlug, section.id);
  const progressKey = { courseSlug, lessonSlug, sectionId: section.id };

  const onComplete = useCallback(() => {
    setSectionAuto(courseSlug, lessonSlug, section.id, true);
    rerender();
  }, [courseSlug, lessonSlug, section.id, rerender]);

  const onToggleManual = useCallback(
    (next: boolean) => {
      setSectionManual(courseSlug, lessonSlug, section.id, next);
      rerender();
    },
    [courseSlug, lessonSlug, section.id, rerender],
  );

  if (!(section.type in widgetRegistry)) {
    return (
      <div data-section-id={section.id} data-widget-unknown>
        <Callout tone="warning">
          Unsupported widget type:{' '}
          <code style={{ fontFamily: 'var(--font-mono)' }}>{section.type}</code>
        </Callout>
      </div>
    );
  }

  // Same component the app dispatches to (registry is the single source of
  // truth). Props differ per type — mirrored verbatim from SectionRenderer.
  const Body = widgetRegistry[section.type as WidgetType].component as any;
  const data = section.data as any;
  let body: React.ReactNode;

  switch (section.type) {
    case 'quiz':
      body = (
        <Body
          data={data}
          onCorrect={onComplete}
          alreadyCompleted={done}
          progressKey={progressKey}
        />
      );
      break;
    case 'code':
      body = (
        <Body
          data={data}
          initialCode={undefined}
          progressKey={progressKey}
          onComplete={onComplete}
          alreadyCompleted={done}
        />
      );
      break;
    case 'codeCloze':
      body = (
        <Body data={data} progressKey={progressKey} onComplete={onComplete} />
      );
      break;
    case 'sandbox':
      body = (
        <Body data={data} initialCode={undefined} progressKey={progressKey} />
      );
      break;
    case 'dragMatch':
      body = (
        <Body data={data} progressKey={progressKey} onComplete={onComplete} />
      );
      break;
    case 'transcriptCloze':
      body = (
        <Body
          data={data}
          courseSlug={courseSlug}
          progressKey={progressKey}
          onComplete={onComplete}
        />
      );
      break;
    case 'audioPlayer':
      body = <Body data={data} courseSlug={courseSlug} />;
      break;
    case 'video':
      body = <Body data={data} onTranscriptFetched={() => {}} />;
      break;
    // demo, histogram, plotImage, parametricExplorer, dataTable, theory,
    // sttDemo, ttsDemo, custom — data only (same as the app).
    default:
      body = <Body data={data} />;
      break;
  }

  return (
    <div
      id={`section-${section.id}`}
      data-section-id={section.id}
      data-section-type={section.type}
    >
      <Widget
        type={section.type as WidgetType}
        sectionNumber={index + 1}
        title={section.title}
        description={section.description}
        status={done ? 'done' : 'todo'}
        checkbox={{
          completed: done,
          onToggle: onToggleManual,
          testId: `section-complete-${section.id}`,
          ariaLabel: {
            checked: `Mark section "${section.title}" as not completed`,
            unchecked: `Mark section "${section.title}" as completed`,
          },
          title: {
            checked: 'Unmark section as completed',
            unchecked: 'Mark section as completed',
          },
        }}
      >
        {body}
      </Widget>
    </div>
  );
}

export function StaticLesson({ payload }: { payload: SxPayload }) {
  const lesson = payload.lesson as LessonLike;
  const courseSlug = payload.courseSlug;

  // Flat lesson order across modules for prev/next.
  const flat = useMemo(
    () =>
      payload.nav.flatMap((m) =>
        m.lessons.map((l) => ({ slug: l.slug, title: l.title })),
      ),
    [payload.nav],
  );
  const here = flat.findIndex((l) => l.slug === lesson.slug);
  const prev = here > 0 ? flat[here - 1] : null;
  const next = here >= 0 && here < flat.length - 1 ? flat[here + 1] : null;
  const lessonHref = (slug: string) => `${payload.lessonHrefBase}${slug}.html`;

  return (
    <div className="sx-shell">
      <aside className="sx-toc" aria-label="Course contents">
        {payload.homeHref ? (
          <a className="sx-toc-library" href={payload.homeHref}>
            ← Library
          </a>
        ) : null}
        <a className="sx-toc-home" href={payload.indexHref}>
          ← {payload.course?.title ?? 'Course'}
        </a>
        {payload.nav.map((m) => (
          <div key={m.id} className="sx-toc-module">
            <div className="sx-toc-module-title">{m.title}</div>
            <ul>
              {m.lessons.map((l) => (
                <li key={l.slug}>
                  <a
                    href={lessonHref(l.slug)}
                    aria-current={l.slug === lesson.slug ? 'page' : undefined}
                    className={
                      l.slug === lesson.slug ? 'sx-toc-link active' : 'sx-toc-link'
                    }
                  >
                    {l.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>

      <main className="sx-main">
        <header className="sx-lesson-head">
          {lesson.eyebrow ? (
            <div className="sx-eyebrow">{lesson.eyebrow}</div>
          ) : null}
          <h1>{lesson.title}</h1>
          {lesson.description ? (
            <p className="sx-lesson-desc">{lesson.description}</p>
          ) : null}
        </header>

        <div className="sx-sections">
          {lesson.sections.map((s, i) => (
            <SectionView
              key={s.id}
              section={s}
              index={i}
              courseSlug={courseSlug}
              lessonSlug={lesson.slug}
            />
          ))}
        </div>

        {lesson.sources && lesson.sources.length > 0 ? (
          <section className="sx-sources">
            <h2>Sources</h2>
            <ol>
              {lesson.sources.map((s, i) => (
                <li key={i}>
                  {s.title}
                  {s.author ? ` — ${s.author}` : ''}
                  {s.year ? ` (${s.year})` : ''}{' '}
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.url}
                    </a>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <nav className="sx-pager">
          {prev ? (
            <a className="sx-pager-prev" href={lessonHref(prev.slug)}>
              ← {prev.title}
            </a>
          ) : (
            <span />
          )}
          {next ? (
            <a className="sx-pager-next" href={lessonHref(next.slug)}>
              {next.title} →
            </a>
          ) : (
            <span />
          )}
        </nav>
      </main>
    </div>
  );
}
