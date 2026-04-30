'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import { use } from 'react';
import Link from 'next/link';
import { HelpCircle, Sun } from 'lucide-react';

import { Callout } from '@/components/Callout';
import type { Course } from '@/lib/schemas/course';
import type { Lesson } from '@/lib/schemas/lesson';
import type { LessonStatus, Progress } from '@/lib/schemas/progress';

interface RouteParams {
  slug: string;
  lessonSlug: string;
}

const TOC_EXPANDED = 276;
const TOC_COLLAPSED = 52;
const CHAT_OPEN = 320;
const TOOLBAR_H = 52;
const BOTTOM_H = 56;

export default function LessonShellPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { slug, lessonSlug } = use(params);

  const [course, setCourse] = useState<Course | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // TOC state — collapse comes in US-016 but we render the column at the right width.
  const [tocCollapsed] = useState(false);
  // Chat is closed by default in MVP.
  const [chatOpen] = useState(false);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [lessonRes, courseRes, progressRes] = await Promise.all([
        fetch(`/api/courses/${slug}/lessons/${lessonSlug}`, { cache: 'no-store' }),
        fetch(`/api/courses/${slug}`, { cache: 'no-store' }),
        fetch('/api/progress', { cache: 'no-store' }),
      ]);

      if (lessonRes.status === 404) {
        setError('Lesson not found');
        setLoaded(true);
        return;
      }
      if (!lessonRes.ok) {
        throw new Error(`GET lesson failed (${lessonRes.status})`);
      }
      if (!courseRes.ok) {
        throw new Error(`GET course failed (${courseRes.status})`);
      }
      if (!progressRes.ok) {
        throw new Error(`GET progress failed (${progressRes.status})`);
      }

      const lessonData = (await lessonRes.json()) as Lesson;
      const courseData = (await courseRes.json()) as Course;
      const progressData = (await progressRes.json()) as Progress;

      setLesson(lessonData);
      setCourse(courseData);
      setProgress(progressData);
      setLoaded(true);

      // Mark visited; only upgrade status from not_started → started.
      const currentStatus: LessonStatus | undefined =
        progressData.courses?.[slug]?.lessons?.[lessonSlug]?.status;
      const body: Record<string, unknown> = {
        courseSlug: slug,
        lessonSlug,
        markVisited: true,
      };
      if (currentStatus === undefined || currentStatus === 'not_started') {
        body.status = 'started';
      }
      await fetch('/api/progress', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoaded(true);
    }
  }, [slug, lessonSlug]);

  useEffect(() => {
    // setState happens inside loadAll AFTER fetch resolves — i.e. as a subscriber
    // callback, the recommended pattern. The lint rule's static analysis can't
    // tell the difference, so suppress it at the call site.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAll();
  }, [loadAll]);

  const moduleTitle = useMemo(() => {
    if (!course || !lesson) return '';
    return course.modules.find((m) => m.id === lesson.moduleId)?.title ?? '';
  }, [course, lesson]);

  const sectionTotals = useMemo(() => {
    if (!lesson) return { total: 0, done: 0 };
    const total = lesson.sections.length;
    const sectionState =
      progress?.courses?.[slug]?.lessons?.[lessonSlug]?.sectionState ?? {};
    let done = 0;
    for (const s of lesson.sections) {
      if (sectionState[s.id]?.done) done += 1;
    }
    return { total, done };
  }, [lesson, progress, slug, lessonSlug]);

  const tocCol = tocCollapsed ? TOC_COLLAPSED : TOC_EXPANDED;
  const chatCol = chatOpen ? CHAT_OPEN : 0;

  const shellStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `${tocCol}px minmax(0,1fr) ${chatCol}px`,
    gridTemplateRows: `${TOOLBAR_H}px 1fr ${BOTTOM_H}px`,
    height: '100vh',
    width: '100%',
    overflow: 'hidden',
    background: 'var(--bg)',
    color: 'var(--text)',
  };

  return (
    <div data-testid="lesson-shell" style={shellStyle}>
      <Toolbar
        course={course}
        lesson={lesson}
        moduleTitle={moduleTitle}
        slug={slug}
        sectionTotals={sectionTotals}
      />

      <TocColumn collapsed={tocCollapsed} />

      <main
        data-testid="lesson-content"
        style={{
          gridColumn: '2 / 3',
          gridRow: '2 / 3',
          minWidth: 0,
          overflow: 'auto',
          padding: 'var(--space-6) var(--space-6) var(--space-7)',
          background: 'var(--bg)',
        }}
      >
        {!loaded ? (
          <ContentSkeleton />
        ) : error ? (
          <LessonNotFound slug={slug} message={error} />
        ) : (
          // Center column ready for US-017 content stream.
          <div data-testid="lesson-content-ready" />
        )}
      </main>

      <ChatColumn open={chatOpen} />

      <BottomBar />
    </div>
  );
}

interface ToolbarProps {
  course: Course | null;
  lesson: Lesson | null;
  moduleTitle: string;
  slug: string;
  sectionTotals: { total: number; done: number };
}

function Toolbar({
  course,
  lesson,
  moduleTitle,
  slug,
  sectionTotals,
}: ToolbarProps) {
  return (
    <header
      data-testid="lesson-toolbar"
      style={{
        gridColumn: '1 / -1',
        gridRow: '1 / 2',
        height: TOOLBAR_H,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: '0 var(--space-5)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
      }}
    >
      <Breadcrumb
        course={course}
        lesson={lesson}
        moduleTitle={moduleTitle}
        slug={slug}
      />

      <div style={{ flex: 1 }} />

      <SectionProgress totals={sectionTotals} />

      <div
        aria-hidden
        style={{
          width: 1,
          height: 22,
          background: 'var(--border)',
          margin: '0 var(--space-2)',
        }}
      />

      <ToolbarIconBtn
        testId="theme-toggle-slot"
        ariaLabel="Toggle theme"
      >
        <Sun size={16} strokeWidth={2} />
      </ToolbarIconBtn>

      <ToolbarIconBtn testId="shortcuts-btn" ariaLabel="Keyboard shortcuts">
        <HelpCircle size={16} strokeWidth={2} />
      </ToolbarIconBtn>

      <ToolbarIconBtn
        testId="tutor-btn"
        ariaLabel="AI tutor (coming soon)"
        disabled
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.02em',
          }}
        >
          ⌘.
        </span>
      </ToolbarIconBtn>
    </header>
  );
}

interface BreadcrumbProps {
  course: Course | null;
  lesson: Lesson | null;
  moduleTitle: string;
  slug: string;
}

function Breadcrumb({ course, lesson, moduleTitle, slug }: BreadcrumbProps) {
  const tertiary: CSSProperties = {
    color: 'var(--text-tertiary)',
    fontSize: 'var(--fs-sm)',
    textDecoration: 'none',
  };
  const primary: CSSProperties = {
    color: 'var(--text)',
    fontSize: 'var(--fs-sm)',
    fontWeight: 500,
  };
  const sep: CSSProperties = {
    color: 'var(--text-quaternary)',
    fontSize: 'var(--fs-sm)',
    margin: '0 6px',
  };
  return (
    <nav
      data-testid="lesson-breadcrumb"
      aria-label="Breadcrumb"
      style={{
        display: 'flex',
        alignItems: 'center',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <Link href="/" style={tertiary} data-testid="breadcrumb-course">
        {course?.title ?? '—'}
      </Link>
      <span style={sep} aria-hidden>
        ›
      </span>
      <Link href={`/courses/${slug}`} style={tertiary} data-testid="breadcrumb-module">
        {moduleTitle || '—'}
      </Link>
      <span style={sep} aria-hidden>
        ›
      </span>
      <span style={primary} data-testid="breadcrumb-lesson">
        {lesson?.title ?? '—'}
      </span>
    </nav>
  );
}

function SectionProgress({
  totals,
}: {
  totals: { total: number; done: number };
}) {
  const { total, done } = totals;
  const segments = Math.max(total, 1);
  const segmentGap = 2;
  const barWidth = 60;
  const segWidth = (barWidth - segmentGap * (segments - 1)) / segments;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
      }}
    >
      <span
        data-testid="section-progress-pill"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-sm)',
          color: 'var(--text-secondary)',
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '4px 10px',
          lineHeight: 1,
        }}
      >
        {done}/{total}
      </span>
      <div
        data-testid="section-progress-bar"
        aria-hidden
        style={{
          width: barWidth,
          height: 4,
          display: 'flex',
          gap: segmentGap,
        }}
      >
        {Array.from({ length: segments }).map((_, i) => (
          <span
            key={i}
            style={{
              width: segWidth,
              height: 4,
              borderRadius: 2,
              background:
                i < done ? 'var(--accent)' : 'var(--border)',
              display: 'inline-block',
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ToolbarIconBtn({
  children,
  testId,
  ariaLabel,
  disabled,
}: {
  children: React.ReactNode;
  testId: string;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      disabled={disabled}
      style={{
        width: 32,
        height: 32,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--radius-md)',
        border: '1px solid transparent',
        background: 'transparent',
        color: disabled ? 'var(--text-quaternary)' : 'var(--text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

function TocColumn({ collapsed }: { collapsed: boolean }) {
  return (
    <aside
      data-testid="lesson-toc"
      data-collapsed={collapsed ? 'true' : 'false'}
      style={{
        gridColumn: '1 / 2',
        gridRow: '2 / 3',
        borderRight: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        overflow: 'hidden',
      }}
    />
  );
}

function ChatColumn({ open }: { open: boolean }) {
  return (
    <aside
      data-testid="lesson-chat"
      data-open={open ? 'true' : 'false'}
      style={{
        gridColumn: '3 / 4',
        gridRow: '2 / 3',
        borderLeft: open ? '1px solid var(--border)' : 'none',
        background: 'var(--bg-elevated)',
        overflow: 'hidden',
        display: open ? 'flex' : 'none',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-5)',
      }}
    >
      {open && (
        <p
          style={{
            color: 'var(--text-tertiary)',
            fontSize: 'var(--fs-sm)',
            textAlign: 'center',
          }}
        >
          AI tutor — coming soon
        </p>
      )}
    </aside>
  );
}

function BottomBar() {
  return (
    <footer
      data-testid="lesson-bottom-bar"
      style={{
        gridColumn: '1 / -1',
        gridRow: '3 / 4',
        height: BOTTOM_H,
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
      }}
    />
  );
}

function ContentSkeleton() {
  const bar: CSSProperties = {
    width: '100%',
    maxWidth: 760,
    margin: '0 auto',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border)',
  };
  return (
    <div
      data-testid="lesson-skeleton"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-section)',
        paddingTop: 'var(--space-5)',
      }}
    >
      <div style={{ ...bar, height: 220 }} />
      <div style={{ ...bar, height: 280 }} />
      <div style={{ ...bar, height: 240 }} />
    </div>
  );
}

function LessonNotFound({ slug, message }: { slug: string; message: string }) {
  return (
    <div
      data-testid="lesson-error"
      style={{ maxWidth: 560, margin: '0 auto', paddingTop: 'var(--space-7)' }}
    >
      <Callout tone="warning" title="Lesson not found">
        <p style={{ marginBottom: 'var(--space-3)' }}>
          {message ||
            "We couldn't load this lesson. It may have been removed or renamed."}
        </p>
        <Link
          href={`/courses/${slug}`}
          style={{
            color: 'var(--accent-text)',
            textDecoration: 'underline',
            fontSize: 'var(--fs-sm)',
          }}
        >
          ← Back to course
        </Link>
      </Callout>
    </div>
  );
}
