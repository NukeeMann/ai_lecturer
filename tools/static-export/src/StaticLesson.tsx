// Faithful, minimal re-implementation of the app's SectionRenderer
// (src/app/courses/[slug]/lessons/[lessonSlug]/page.tsx). It renders the
// REAL widget components from the main project, wrapped in the REAL <Widget>
// chrome — with the exact per-widget props the app passes — but with every
// AI / edit / regenerate / chat affordance removed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Widget } from '@/widgets/Widget';
import { widgetRegistry, type WidgetType } from '@/widgets/registry';
import { Callout } from '@/components/Callout';
import { MarkdownInline } from '@/components/MarkdownInline';
import type { SxPayload } from './payload';
import {
  getLessonCompletion,
  isSectionDone,
  onProgressChange,
  setSectionAuto,
  setSectionManual,
} from './progressStore';
import { useAutoCompleteOnView } from './useAutoCompleteOnView';

/**
 * Widget types that already drive their own `onComplete` from a real success
 * signal (quiz answered correctly, code tests passed, drag-match completed,
 * etc.). For these we do NOT auto-mark on view — being visible isn't proof
 * the learner actually did anything.
 *
 * Everything else (theory, demo, histogram, plotImage, parametricExplorer,
 * dataTable, sandbox, audioPlayer, video, sttDemo, ttsDemo, custom) is
 * either passive content or an unscored playground — for those we auto-mark
 * after a sustained view, the way Coursera marks reading material.
 */
const INTERACTIVE_TYPES: ReadonlySet<string> = new Set([
  'quiz',
  'code',
  'codeCloze',
  'dragMatch',
  'transcriptCloze',
]);

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
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  // Static / passive widgets are auto-marked after a sustained view.
  // Interactive widgets drive their own completion via onComplete callbacks
  // wired up in the switch below.
  const useAutoMark = !INTERACTIVE_TYPES.has(section.type);
  useAutoCompleteOnView({
    enabled: useAutoMark && !done,
    onComplete,
    threshold: 0.5,        // 50% of the section in viewport
    minVisibleMs: 1500,    // for 1.5s — Coursera-style dwell
    ref: containerRef,
  });

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
      ref={containerRef}
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

  // Re-render whenever any section/lesson progress changes, so the sidebar
  // TOC's completion badges stay in sync with what the learner just did
  // (clicked a checkbox, answered a quiz, scrolled through theory).
  const [, setProgressVersion] = useState(0);
  useEffect(
    () => onProgressChange(() => setProgressVersion((n) => n + 1)),
    [],
  );

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

  // Find (moduleIdx, lessonIdx) of the current lesson so we can show a
  // "M.L · Title" label in the mobile header. Cheap nested find.
  const lessonLabel = useMemo(() => {
    for (let mi = 0; mi < payload.nav.length; mi++) {
      const li = payload.nav[mi].lessons.findIndex((l) => l.slug === lesson.slug);
      if (li !== -1) return `${mi + 1}.${li + 1}`;
    }
    return '';
  }, [payload.nav, lesson.slug]);

  // Mobile drawer state. Desktop ignores `tocOpen` (CSS keeps sidebar visible).
  const [tocOpen, setTocOpen] = useState(false);
  const closeToc = useCallback(() => setTocOpen(false), []);

  return (
    <div className="sx-shell" data-toc-open={tocOpen ? 'true' : 'false'}>
      {/* Mobile-only header: lesson label on the left, burger on the right.
       *  CSS hides the whole header on desktop. The title gets text-overflow
       *  ellipsis so it can't push the burger or trigger a layout shift. */}
      <header className="sx-mobile-header" aria-label="Lesson header">
        <div className="sx-mobile-header-title" title={lesson.title}>
          {lessonLabel ? (
            <span className="sx-mobile-header-num">{lessonLabel}</span>
          ) : null}
          <span className="sx-mobile-header-name">{lesson.title}</span>
        </div>
        <button
          type="button"
          className="sx-toc-trigger"
          aria-label="Open course contents"
          aria-controls="sx-toc-aside"
          aria-expanded={tocOpen}
          onClick={() => setTocOpen(true)}
        >
          <span aria-hidden>☰</span>
        </button>
      </header>
      {/* Backdrop sits between the page and the drawer; click to close. */}
      <div
        className="sx-toc-backdrop"
        aria-hidden
        onClick={closeToc}
      />
      <aside
        id="sx-toc-aside"
        className="sx-toc"
        aria-label="Course contents"
      >
        <button
          type="button"
          className="sx-toc-close"
          aria-label="Close course contents"
          onClick={closeToc}
        >
          ×
        </button>
        {payload.homeHref ? (
          <a className="sx-toc-library" href={payload.homeHref} onClick={closeToc}>
            ← Library
          </a>
        ) : null}
        <a className="sx-toc-home" href={payload.indexHref} onClick={closeToc}>
          ← {payload.course?.title ?? 'Course'}
        </a>
        {payload.nav.map((m) => (
          <div key={m.id} className="sx-toc-module">
            <div className="sx-toc-module-title">{m.title}</div>
            <ul>
              {m.lessons.map((l) => {
                const ids = l.sectionIds ?? [];
                const { done, total } = getLessonCompletion(
                  courseSlug,
                  l.slug,
                  ids,
                );
                const isDone = total > 0 && done >= total;
                const isPartial = !isDone && done > 0;
                const isActive = l.slug === lesson.slug;
                return (
                  <li key={l.slug}>
                    <a
                      href={lessonHref(l.slug)}
                      aria-current={isActive ? 'page' : undefined}
                      onClick={closeToc}
                      className={
                        'sx-toc-link' +
                        (isActive ? ' active' : '') +
                        (isDone ? ' done' : isPartial ? ' partial' : '')
                      }
                      data-completion={
                        isDone ? 'done' : isPartial ? 'partial' : 'none'
                      }
                    >
                      <span className="sx-toc-link-title">{l.title}</span>
                      <span className="sx-toc-link-badge" aria-hidden>
                        {isDone ? '✓' : total > 0 ? `${done}/${total}` : ''}
                      </span>
                    </a>
                  </li>
                );
              })}
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
            <p className="sx-lesson-desc">
              <MarkdownInline>{lesson.description}</MarkdownInline>
            </p>
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
