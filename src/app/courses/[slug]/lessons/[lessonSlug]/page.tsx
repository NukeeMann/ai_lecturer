'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Library,
  Pencil,
  RefreshCw,
} from 'lucide-react';

import { AppLogoLink } from '@/components/AppLogo';
import { AvatarMenu } from '@/components/AvatarMenu';
import { Callout } from '@/components/Callout';
import {
  EditorFormFooter,
  EditorFormSaveError,
  formBodyStyle,
} from '@/components/EditorForm';
import { openShortcutsModal } from '@/components/GlobalShortcutsHost';
import { SidePanel } from '@/components/SidePanel';
import {
  LessonSourcesPanel,
  SectionSourcesPopover,
  SourcesField,
} from '@/components/Sources';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  isMod,
  preferredScrollBehavior,
  useKeyboardShortcuts,
  type KeyboardShortcut,
} from '@/lib/hooks/useKeyboardShortcuts';
import { usePyodide } from '@/lib/pyodide/client';
import type { Course } from '@/lib/schemas/course';
import type { Lesson, Section, Source } from '@/lib/schemas/lesson';
import type { LessonStatus, Progress, SectionState } from '@/lib/schemas/progress';
import { CodeEditor } from '@/widgets/Code/CodeEditor';
import { CodeWidget } from '@/widgets/Code/CodeWidget';
import { DemoEditor } from '@/widgets/Demo/DemoEditor';
import { CodeClozeEditor } from '@/widgets/CodeCloze/CodeClozeEditor';
import { DragMatchEditor } from '@/widgets/DragMatch/DragMatchEditor';
import { HistogramEditor } from '@/widgets/Histogram/HistogramEditor';
import { ParametricExplorerEditor } from '@/widgets/ParametricExplorer/ParametricExplorerEditor';
import { PlotImageEditor } from '@/widgets/PlotImage/PlotImageEditor';
import { QuizEditor } from '@/widgets/Quiz/QuizEditor';
import { QuizWidget } from '@/widgets/Quiz/QuizWidget';
import { SandboxEditor } from '@/widgets/Sandbox/SandboxEditor';
import { SandboxWidget } from '@/widgets/Sandbox/SandboxWidget';
import { TheoryEditor } from '@/widgets/Theory/TheoryEditor';
import { Widget, type WidgetStatus } from '@/widgets/Widget';
import { widgetRegistry, type WidgetType } from '@/widgets/registry';

const TOC_COLLAPSED_KEY = 'toc-collapsed';

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
  const router = useRouter();
  const { resetNamespace } = usePyodide();

  const [course, setCourse] = useState<Course | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [sessionToast, setSessionToast] = useState<string | null>(null);

  // TOC collapse, persisted to localStorage['toc-collapsed'].
  const [tocCollapsed, setTocCollapsed] = useState(false);
  // Per-module expansion state (default: all open). Keyed by module.id.
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({});
  // Per-section edit-mode flags for inline theory editing (US-022). Keyed by
  // section.id; true means the editor is rendered in place of the read-mode
  // body. Each TheoryEditor instance owns its own draft, so opening edit mode
  // on multiple sections does not lose drafts in the others.
  const [editingSections, setEditingSections] = useState<Record<string, boolean>>(
    {},
  );
  // Side-panel edit (US-023): non-theory widgets open a 320px side panel
  // instead of an inline editor. At most one panel is open at a time.
  const [panelSectionId, setPanelSectionId] = useState<string | null>(null);
  // Lesson-level sources side panel (US-040). Independent of section panel.
  const [lessonSourcesPanelOpen, setLessonSourcesPanelOpen] = useState(false);
  // Chat is closed by default in MVP.
  const [chatOpen] = useState(false);
  // Focus mode (US-021 'f'): when on, both side panels are collapsed; when
  // toggled off, the previous TOC-collapsed state is restored.
  const focusModeRef = useRef<{ active: boolean; previousToc: boolean }>({
    active: false,
    previousToc: false,
  });

  // Hydrate collapse state from localStorage on mount. Lazy useState init can't
  // touch window during SSR, so we read after mount and accept a one-frame flash.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TOC_COLLAPSED_KEY);
      if (stored === 'true') {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTocCollapsed(true);
      }
    } catch {
      // localStorage unavailable (SSR / privacy mode) — fall back to default.
    }
  }, []);

  const toggleToc = useCallback(() => {
    setTocCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(TOC_COLLAPSED_KEY, next ? 'true' : 'false');
      } catch {
        // Persistence unavailable — toggle still works for the session.
      }
      return next;
    });
  }, []);

  const toggleModule = useCallback((moduleId: string) => {
    setOpenModules((prev) => ({
      ...prev,
      [moduleId]: prev[moduleId] === undefined ? false : !prev[moduleId],
    }));
  }, []);

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
      const upgrading =
        currentStatus === undefined || currentStatus === 'not_started';
      if (upgrading) {
        body.status = 'started';
      }
      // Optimistically reflect the markVisited intent in local state so the
      // TOC dot for the current lesson flips to 'started' (and lastVisitedAt
      // updates) without waiting for the PATCH round-trip.
      const optimisticAt = new Date().toISOString();
      setProgress((prev) => {
        const base: Progress = prev ?? { courses: {} };
        const courses = { ...base.courses };
        const cp = courses[slug]
          ? { ...courses[slug], lessons: { ...courses[slug].lessons } }
          : { lessons: {} };
        const existingLesson = cp.lessons[lessonSlug] ?? {
          status: 'not_started' as LessonStatus,
        };
        const nextStatus: LessonStatus = upgrading
          ? 'started'
          : existingLesson.status;
        cp.lessons[lessonSlug] = {
          ...existingLesson,
          status: nextStatus,
          startedAt:
            nextStatus !== 'not_started' && !existingLesson.startedAt
              ? optimisticAt
              : existingLesson.startedAt,
        };
        cp.lastVisitedAt = optimisticAt;
        cp.lastVisitedLessonSlug = lessonSlug;
        courses[slug] = cp;
        return { ...base, courses };
      });
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

  // Wipe the Pyodide lesson namespace whenever the active lesson changes.
  // Queues behind the worker's readyPromise — safe to call before Pyodide
  // finishes loading. Errors are non-fatal (Python widgets surface their own).
  useEffect(() => {
    void resetNamespace(lessonSlug).catch(() => {});
  }, [resetNamespace, lessonSlug]);

  const handleResetSession = useCallback(() => {
    void resetNamespace(lessonSlug)
      .then(() => {
        setSessionToast('Python session reset');
      })
      .catch(() => {
        setSessionToast('Could not reset session');
      });
  }, [resetNamespace, lessonSlug]);

  useEffect(() => {
    if (!sessionToast) return;
    const handle = window.setTimeout(() => setSessionToast(null), 2000);
    return () => window.clearTimeout(handle);
  }, [sessionToast]);

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
    opacity: advancing ? 0 : 1,
    transition:
      'grid-template-columns 180ms ease, opacity 600ms ease',
  };

  const flatLessons = useMemo(() => {
    if (!course) return [] as Array<{ slug: string; title: string }>;
    return course.modules.flatMap((m) =>
      m.lessons.map((l) => ({ slug: l.slug, title: l.title })),
    );
  }, [course]);

  const { prevLesson, nextLesson } = useMemo(() => {
    const idx = flatLessons.findIndex((l) => l.slug === lessonSlug);
    if (idx < 0) return { prevLesson: null, nextLesson: null };
    return {
      prevLesson: idx > 0 ? flatLessons[idx - 1] : null,
      nextLesson: idx < flatLessons.length - 1 ? flatLessons[idx + 1] : null,
    };
  }, [flatLessons, lessonSlug]);

  const lessonStatus: LessonStatus =
    progress?.courses?.[slug]?.lessons?.[lessonSlug]?.status ?? 'not_started';

  const handleNavigate = useCallback(
    (targetSlug: string) => {
      router.push(`/courses/${slug}/lessons/${targetSlug}`);
    },
    [router, slug],
  );

  const handleMarkComplete = useCallback(async () => {
    setProgress((prev) => {
      if (!prev) return prev;
      const courses = { ...prev.courses };
      const cp = courses[slug]
        ? { ...courses[slug], lessons: { ...courses[slug].lessons } }
        : { lessons: {} };
      const existing = cp.lessons[lessonSlug] ?? { status: 'not_started' as LessonStatus };
      cp.lessons[lessonSlug] = { ...existing, status: 'finished' };
      courses[slug] = cp;
      return { ...prev, courses };
    });

    try {
      await fetch('/api/progress', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseSlug: slug,
          lessonSlug,
          status: 'finished',
        }),
      });
    } catch {
      // Local optimistic update already applied; surfacing the error here
      // would require an inline toast we don't have yet.
    }

    if (nextLesson) {
      setAdvancing(true);
      window.setTimeout(() => {
        router.push(`/courses/${slug}/lessons/${nextLesson.slug}`);
      }, 600);
    }
  }, [slug, lessonSlug, nextLesson, router]);

  // Computes a position offset for each section relative to the main content
  // scroll container's content origin. Plus identifies the "current" section
  // (the last one whose top has scrolled past the viewport top).
  const getSectionState = useCallback(() => {
    const main = document.querySelector(
      '[data-testid="lesson-content"]',
    ) as HTMLElement | null;
    if (!main) return null;
    const sections = Array.from(
      main.querySelectorAll<HTMLElement>('[data-section-id]'),
    );
    if (sections.length === 0) return null;
    const mainRect = main.getBoundingClientRect();
    const offsets = sections.map(
      (s) => s.getBoundingClientRect().top - mainRect.top + main.scrollTop,
    );
    const buffer = 8;
    // "current" = last section whose top has scrolled to/past the viewport top.
    let currentIdx = 0;
    for (let i = 0; i < offsets.length; i++) {
      if (offsets[i] <= main.scrollTop + buffer) currentIdx = i;
    }
    return { main, sections, offsets, currentIdx, buffer };
  }, []);

  const scrollToSection = useCallback(
    (direction: 'next' | 'prev') => {
      const state = getSectionState();
      if (!state) return;
      const { main, offsets, buffer } = state;
      // For 'next': first section whose top is strictly below viewport top.
      // For 'prev': last section whose top is strictly above viewport top.
      let targetIdx = -1;
      if (direction === 'next') {
        for (let i = 0; i < offsets.length; i++) {
          if (offsets[i] > main.scrollTop + buffer) {
            targetIdx = i;
            break;
          }
        }
      } else {
        for (let i = 0; i < offsets.length; i++) {
          if (offsets[i] < main.scrollTop - buffer) {
            targetIdx = i;
          }
        }
      }
      if (targetIdx < 0) return;
      main.scrollTo({
        top: Math.max(0, offsets[targetIdx] - buffer),
        behavior: preferredScrollBehavior(),
      });
    },
    [getSectionState],
  );

  const handleSpaceMarkSection = useCallback(() => {
    const state = getSectionState();
    if (!state) return;
    const { sections, currentIdx } = state;
    const target = sections[currentIdx];
    const sectionId = target.getAttribute('data-section-id');
    if (!sectionId) return;

    const current: SectionState =
      progress?.courses?.[slug]?.lessons?.[lessonSlug]?.sectionState?.[sectionId] ??
      {};
    if (current.done) return; // Already complete — Space is a no-op.
    const nextState: SectionState = { ...current, done: true };

    // Optimistic local update so the toolbar pill / TOC reflect immediately.
    setProgress((prev) => {
      const base: Progress = prev ?? { courses: {} };
      const courses = { ...base.courses };
      const cp = courses[slug]
        ? { ...courses[slug], lessons: { ...courses[slug].lessons } }
        : { lessons: {} };
      const existingLesson = cp.lessons[lessonSlug] ?? {
        status: 'not_started' as LessonStatus,
      };
      cp.lessons[lessonSlug] = {
        ...existingLesson,
        sectionState: {
          ...(existingLesson.sectionState ?? {}),
          [sectionId]: nextState,
        },
      };
      courses[slug] = cp;
      return { ...base, courses };
    });

    void fetch('/api/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseSlug: slug,
        lessonSlug,
        sectionState: { [sectionId]: nextState },
      }),
    }).catch(() => {
      // Optimistic update already applied; no inline error UI yet.
    });
  }, [getSectionState, progress, slug, lessonSlug]);

  const handleNextLesson = useCallback(() => {
    if (lessonStatus !== 'finished') return;
    if (!nextLesson) return;
    router.push(`/courses/${slug}/lessons/${nextLesson.slug}`);
  }, [lessonStatus, nextLesson, router, slug]);

  const handlePrevLesson = useCallback(() => {
    if (!prevLesson) return;
    router.push(`/courses/${slug}/lessons/${prevLesson.slug}`);
  }, [prevLesson, router, slug]);

  const handleToggleEdit = useCallback((sectionId: string) => {
    setEditingSections((prev) => {
      if (prev[sectionId]) {
        const copy = { ...prev };
        delete copy[sectionId];
        return copy;
      }
      return { ...prev, [sectionId]: true };
    });
  }, []);

  const persistLesson = useCallback(
    async (next: Lesson): Promise<Lesson> => {
      const res = await fetch(`/api/courses/${slug}/lessons/${lessonSlug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        let message = `Save failed (${res.status})`;
        try {
          const detail = (await res.json()) as { error?: string };
          if (detail?.error) message = detail.error;
        } catch {
          // Fall through to status-only message.
        }
        throw new Error(message);
      }
      return (await res.json()) as Lesson;
    },
    [slug, lessonSlug],
  );

  const handleSaveTheory = useCallback(
    async (sectionId: string, nextMarkdown: string) => {
      if (!lesson) {
        throw new Error('Lesson not loaded');
      }
      const next: Lesson = {
        ...lesson,
        sections: lesson.sections.map((s) =>
          s.id === sectionId && s.type === 'theory'
            ? { ...s, data: { ...s.data, markdown: nextMarkdown } }
            : s,
        ),
      };
      const saved = await persistLesson(next);
      setLesson(saved);
      setEditingSections((prev) => {
        if (!prev[sectionId]) return prev;
        const copy = { ...prev };
        delete copy[sectionId];
        return copy;
      });
    },
    [lesson, persistLesson],
  );

  const handleSavePanelSection = useCallback(
    async (sectionId: string, nextData: unknown, nextSources?: Source[]) => {
      if (!lesson) {
        throw new Error('Lesson not loaded');
      }
      const next: Lesson = {
        ...lesson,
        sections: lesson.sections.map((s) => {
          if (s.id !== sectionId) return s;
          const updated: Record<string, unknown> = {
            ...s,
            data: nextData,
          };
          if (nextSources && nextSources.length > 0) {
            updated.sources = nextSources;
          } else {
            delete updated.sources;
          }
          return updated as Section;
        }),
      };
      const saved = await persistLesson(next);
      setLesson(saved);
      setPanelSectionId((cur) => (cur === sectionId ? null : cur));
    },
    [lesson, persistLesson],
  );

  const handleSaveLessonSources = useCallback(
    async (nextSources: Source[] | undefined) => {
      if (!lesson) {
        throw new Error('Lesson not loaded');
      }
      const next: Lesson = { ...lesson };
      if (nextSources && nextSources.length > 0) {
        next.sources = nextSources;
      } else {
        delete next.sources;
      }
      const saved = await persistLesson(next);
      setLesson(saved);
      setLessonSourcesPanelOpen(false);
    },
    [lesson, persistLesson],
  );

  const handleOpenPanel = useCallback((sectionId: string) => {
    setPanelSectionId((cur) => (cur === sectionId ? null : sectionId));
  }, []);

  const handleClosePanel = useCallback(() => {
    setPanelSectionId(null);
  }, []);

  const handleToggleFocus = useCallback(() => {
    if (focusModeRef.current.active) {
      setTocCollapsed(focusModeRef.current.previousToc);
      focusModeRef.current.active = false;
    } else {
      focusModeRef.current.previousToc = tocCollapsed;
      setTocCollapsed(true);
      focusModeRef.current.active = true;
    }
  }, [tocCollapsed]);

  const shortcuts: KeyboardShortcut[] = useMemo(
    () => [
      {
        match: (e) => !isMod(e) && !e.shiftKey && !e.altKey && (e.key === 'j' || e.key === 'ArrowDown'),
        handler: () => scrollToSection('next'),
      },
      {
        match: (e) => !isMod(e) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'ArrowUp'),
        handler: () => scrollToSection('prev'),
      },
      {
        match: (e) => isMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b',
        handler: () => toggleToc(),
      },
      {
        match: (e) => isMod(e) && !e.shiftKey && !e.altKey && e.key === '.',
        handler: () => {
          // Tutor toggle is a no-op visible state in MVP — the chat panel
          // stays closed (see CHAT_OPEN constant).
        },
      },
      {
        match: (e) =>
          e.code === 'Space' &&
          !isMod(e) &&
          !e.shiftKey &&
          !e.altKey &&
          !(e.target instanceof HTMLButtonElement) &&
          !(e.target instanceof HTMLAnchorElement),
        handler: () => handleSpaceMarkSection(),
      },
      {
        match: (e) => !isMod(e) && !e.shiftKey && !e.altKey && e.key === 'n',
        handler: () => handleNextLesson(),
      },
      {
        match: (e) => !isMod(e) && !e.shiftKey && !e.altKey && e.key === 'p',
        handler: () => handlePrevLesson(),
      },
      {
        match: (e) => !isMod(e) && !e.shiftKey && !e.altKey && e.key === 'f',
        handler: () => handleToggleFocus(),
      },
    ],
    [
      scrollToSection,
      toggleToc,
      handleSpaceMarkSection,
      handleNextLesson,
      handlePrevLesson,
      handleToggleFocus,
    ],
  );

  useKeyboardShortcuts(shortcuts);

  const panelSection = useMemo(() => {
    if (!lesson || !panelSectionId) return null;
    return lesson.sections.find((s) => s.id === panelSectionId) ?? null;
  }, [lesson, panelSectionId]);

  return (
    <div data-testid="lesson-shell" style={shellStyle}>
      <Toolbar
        course={course}
        lesson={lesson}
        moduleTitle={moduleTitle}
        slug={slug}
        sectionTotals={sectionTotals}
        onResetSession={handleResetSession}
      />

      <TocColumn
        collapsed={tocCollapsed}
        onToggle={toggleToc}
        course={course}
        progress={progress}
        slug={slug}
        lessonSlug={lessonSlug}
        openModules={openModules}
        onToggleModule={toggleModule}
      />

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
        ) : lesson ? (
          <LessonStream
            course={course}
            lesson={lesson}
            slug={slug}
            lessonSlug={lessonSlug}
            progress={progress}
            editingSections={editingSections}
            onToggleEdit={handleToggleEdit}
            onSaveTheory={handleSaveTheory}
            panelSectionId={panelSectionId}
            onOpenPanel={handleOpenPanel}
            onOpenLessonSources={() => setLessonSourcesPanelOpen(true)}
          />
        ) : null}
      </main>

      <ChatColumn open={chatOpen} />

      <BottomBar
        prevLesson={prevLesson}
        nextLesson={nextLesson}
        status={lessonStatus}
        onMarkComplete={handleMarkComplete}
        onNavigate={handleNavigate}
      />

      <WidgetEditPanel
        section={panelSection}
        courseSlug={slug}
        open={panelSectionId !== null && panelSection !== null}
        onClose={handleClosePanel}
        onSave={handleSavePanelSection}
      />

      <LessonSourcesEditPanel
        open={lessonSourcesPanelOpen}
        sources={lesson?.sources}
        onClose={() => setLessonSourcesPanelOpen(false)}
        onSave={handleSaveLessonSources}
      />

      {sessionToast && <SessionToast message={sessionToast} />}
    </div>
  );
}

function SessionToast({ message }: { message: string }) {
  return (
    <div
      data-testid="session-toast"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: TOOLBAR_H + 12,
        right: 16,
        zIndex: 50,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-strong)',
        color: 'var(--text)',
        fontSize: 'var(--fs-sm)',
        padding: '8px 14px',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md, 0 8px 24px rgba(0, 0, 0, 0.12))',
      }}
    >
      {message}
    </div>
  );
}

interface WidgetEditPanelProps {
  section: Section | null;
  courseSlug: string;
  open: boolean;
  onClose: () => void;
  onSave: (sectionId: string, data: unknown, sources?: Source[]) => Promise<void>;
}

function WidgetEditPanel({ section, courseSlug, open, onClose, onSave }: WidgetEditPanelProps) {
  const title = section ? `Edit ${widgetRegistry[section.type as WidgetType].label}` : 'Edit';
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={title}
      testId="widget-edit-panel"
    >
      {section?.type === 'quiz' && (
        <QuizEditor
          key={section.id}
          initial={section.data}
          initialSources={section.sources}
          onCancel={onClose}
          onSave={(next, sources) => onSave(section.id, next, sources)}
        />
      )}
      {section?.type === 'code' && (
        <CodeEditor
          key={section.id}
          initial={section.data}
          initialSources={section.sources}
          onCancel={onClose}
          onSave={(next, sources) => onSave(section.id, next, sources)}
        />
      )}
      {section?.type === 'codeCloze' && (
        <CodeClozeEditor
          key={section.id}
          initial={section.data}
          initialSources={section.sources}
          onCancel={onClose}
          onSave={(next, sources) => onSave(section.id, next, sources)}
        />
      )}
      {section?.type === 'demo' && (
        <DemoEditor
          key={section.id}
          initial={section.data}
          initialSources={section.sources}
          onCancel={onClose}
          onSave={(next, sources) => onSave(section.id, next, sources)}
        />
      )}
      {section?.type === 'sandbox' && (
        <SandboxEditor
          key={section.id}
          initial={section.data}
          initialSources={section.sources}
          onCancel={onClose}
          onSave={(next, sources) => onSave(section.id, next, sources)}
        />
      )}
      {section?.type === 'histogram' && (
        <HistogramEditor
          key={section.id}
          initial={section.data}
          initialSources={section.sources}
          onCancel={onClose}
          onSave={(next, sources) => onSave(section.id, next, sources)}
        />
      )}
      {section?.type === 'plotImage' && (
        <PlotImageEditor
          key={section.id}
          initial={section.data}
          initialSources={section.sources}
          courseSlug={courseSlug}
          onCancel={onClose}
          onSave={(next, sources) => onSave(section.id, next, sources)}
        />
      )}
      {section?.type === 'parametricExplorer' && (
        <ParametricExplorerEditor
          key={section.id}
          initial={section.data}
          initialSources={section.sources}
          onCancel={onClose}
          onSave={(next, sources) => onSave(section.id, next, sources)}
        />
      )}
      {section?.type === 'dragMatch' && (
        <DragMatchEditor
          key={section.id}
          initial={section.data}
          initialSources={section.sources}
          onCancel={onClose}
          onSave={(next, sources) => onSave(section.id, next, sources)}
        />
      )}
    </SidePanel>
  );
}

interface LessonSourcesEditPanelProps {
  open: boolean;
  sources: Source[] | undefined;
  onClose: () => void;
  onSave: (next: Source[] | undefined) => Promise<void>;
}

function LessonSourcesEditPanel({
  open,
  sources,
  onClose,
  onSave,
}: LessonSourcesEditPanelProps) {
  const initialKey = useMemo(
    () => JSON.stringify(sources ?? null),
    [sources],
  );
  const [draft, setDraft] = useState<Source[] | undefined>(sources);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-sync draft from server-saved sources when the panel opens or upstream changes.
  const lastInitialKey = useRef(initialKey);
  useEffect(() => {
    if (lastInitialKey.current !== initialKey) {
      lastInitialKey.current = initialKey;
      setDraft(sources);
    }
  }, [initialKey, sources]);

  const dirty = JSON.stringify(draft ?? null) !== initialKey;

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      await onSave(draft);
      setSaving(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }, [dirty, draft, onSave, saving]);

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Lesson sources"
      testId="lesson-sources-edit-panel"
    >
      <div
        data-testid="lesson-sources-editor"
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <div style={formBodyStyle}>
          <SourcesField
            sources={draft}
            onChange={setDraft}
            label="Lesson-level sources"
            testId="lesson-sources-field"
          />
        </div>
        <EditorFormSaveError message={saveError} />
        <EditorFormFooter
          saving={saving}
          saveDisabled={!dirty}
          onCancel={onClose}
          onSave={() => void handleSave()}
          cancelTestId="lesson-sources-cancel"
          saveTestId="lesson-sources-save"
        />
      </div>
    </SidePanel>
  );
}

interface ToolbarProps {
  course: Course | null;
  lesson: Lesson | null;
  moduleTitle: string;
  slug: string;
  sectionTotals: { total: number; done: number };
  onResetSession: () => void;
}

function Toolbar({
  course,
  lesson,
  moduleTitle,
  slug,
  sectionTotals,
  onResetSession,
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
      <AppLogoLink collapseLabelOnNarrow maxWidth={180} />

      <div
        aria-hidden
        style={{
          width: 1,
          height: 22,
          background: 'var(--border)',
          margin: '0 var(--space-2)',
        }}
      />

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

      <ThemeToggle />

      <ToolbarIconBtn
        testId="reset-session-btn"
        ariaLabel="Reset Python session"
        onClick={onResetSession}
      >
        <RefreshCw size={16} strokeWidth={2} />
      </ToolbarIconBtn>

      <ToolbarIconBtn
        testId="shortcuts-btn"
        ariaLabel="Keyboard shortcuts"
        onClick={openShortcutsModal}
      >
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

      <AvatarMenu />
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
  onClick,
}: {
  children: React.ReactNode;
  testId: string;
  ariaLabel: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
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

interface TocColumnProps {
  collapsed: boolean;
  onToggle: () => void;
  course: Course | null;
  progress: Progress | null;
  slug: string;
  lessonSlug: string;
  openModules: Record<string, boolean>;
  onToggleModule: (moduleId: string) => void;
}

function TocColumn({
  collapsed,
  onToggle,
  course,
  progress,
  slug,
  lessonSlug,
  openModules,
  onToggleModule,
}: TocColumnProps) {
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
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <TocHeader collapsed={collapsed} onToggle={onToggle} course={course} />
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: collapsed
            ? 'var(--space-3) 0'
            : 'var(--space-2) var(--space-3) var(--space-4)',
        }}
      >
        {collapsed ? (
          <TocCollapsedDots
            course={course}
            progress={progress}
            slug={slug}
            currentLessonSlug={lessonSlug}
          />
        ) : (
          <TocExpanded
            course={course}
            progress={progress}
            slug={slug}
            currentLessonSlug={lessonSlug}
            openModules={openModules}
            onToggleModule={onToggleModule}
          />
        )}
      </div>
    </aside>
  );
}

function TocHeader({
  collapsed,
  onToggle,
  course,
}: {
  collapsed: boolean;
  onToggle: () => void;
  course: Course | null;
}) {
  return (
    <div
      data-testid="toc-header"
      style={{
        padding: collapsed
          ? 'var(--space-3) 0'
          : 'var(--space-4) var(--space-3) var(--space-3)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: collapsed ? 'center' : 'flex-start',
        justifyContent: collapsed ? 'center' : 'space-between',
        gap: 'var(--space-2)',
        minWidth: 0,
      }}
    >
      {!collapsed && (
        <div style={{ minWidth: 0, flex: 1 }}>
          <Link
            href="/"
            data-testid="toc-all-courses"
            style={{
              display: 'block',
              fontSize: 'var(--fs-xs)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 600,
              color: 'var(--text-tertiary)',
              textDecoration: 'none',
              marginBottom: 4,
            }}
          >
            All courses
          </Link>
          <div
            data-testid="toc-course-title"
            style={{
              fontSize: 'var(--fs-sm)',
              fontWeight: 600,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={course?.title ?? ''}
          >
            {course?.title ?? '—'}
          </div>
        </div>
      )}
      <button
        type="button"
        data-testid="toc-toggle"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        onClick={onToggle}
        style={{
          width: 28,
          height: 28,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-tertiary)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {collapsed ? (
          <ChevronRight size={14} strokeWidth={2} />
        ) : (
          <ChevronLeft size={14} strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

interface TocExpandedProps {
  course: Course | null;
  progress: Progress | null;
  slug: string;
  currentLessonSlug: string;
  openModules: Record<string, boolean>;
  onToggleModule: (moduleId: string) => void;
}

function TocExpanded({
  course,
  progress,
  slug,
  currentLessonSlug,
  openModules,
  onToggleModule,
}: TocExpandedProps) {
  if (!course) return null;
  const lessonsState = progress?.courses?.[slug]?.lessons ?? {};
  return (
    <nav
      data-testid="toc-modules"
      style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      {course.modules.map((mod) => {
        const open = openModules[mod.id] !== false; // default open
        return (
          <div key={mod.id} data-testid="toc-module" data-module-id={mod.id}>
            <button
              type="button"
              data-testid="toc-module-header"
              aria-expanded={open}
              onClick={() => onToggleModule(mod.id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                textAlign: 'left',
                color: 'var(--text)',
                fontSize: 'var(--fs-sm)',
                fontWeight: 600,
              }}
            >
              <ChevronDown
                size={12}
                strokeWidth={2.25}
                style={{
                  color: 'var(--text-tertiary)',
                  transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
                  transition: 'transform 120ms ease',
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {mod.title}
              </span>
            </button>
            {open && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  marginTop: 2,
                  marginBottom: 4,
                }}
              >
                {mod.lessons.map((les) => {
                  const status: LessonStatus =
                    lessonsState[les.slug]?.status ?? 'not_started';
                  const isActive = les.slug === currentLessonSlug;
                  return (
                    <TocLessonRow
                      key={les.slug}
                      title={les.title}
                      slug={les.slug}
                      courseSlug={slug}
                      status={status}
                      active={isActive}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function TocLessonRow({
  title,
  slug,
  courseSlug,
  status,
  active,
}: {
  title: string;
  slug: string;
  courseSlug: string;
  status: LessonStatus;
  active: boolean;
}) {
  return (
    <Link
      href={`/courses/${courseSlug}/lessons/${slug}`}
      data-testid="toc-lesson"
      data-lesson-slug={slug}
      data-active={active ? 'true' : 'false'}
      data-status={status}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        height: 28,
        padding: '0 12px',
        fontSize: 'var(--fs-sm)',
        fontWeight: active ? 600 : 400,
        color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
        background: active ? 'var(--accent-subtle)' : 'transparent',
        borderRadius: 'var(--radius-sm)',
        textDecoration: 'none',
        minWidth: 0,
      }}
    >
      {active && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: -1,
            top: 4,
            bottom: 4,
            width: 2,
            background: 'var(--accent)',
            borderRadius: 999,
          }}
        />
      )}
      <StatusDot status={status} />
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={title}
      >
        {title}
      </span>
    </Link>
  );
}

function StatusDot({ status }: { status: LessonStatus }) {
  const base: CSSProperties = {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'inline-block',
  };
  if (status === 'finished') {
    return <span data-status-dot="finished" style={{ ...base, background: 'var(--success)' }} />;
  }
  if (status === 'started') {
    return <span data-status-dot="started" style={{ ...base, background: 'var(--accent)' }} />;
  }
  return (
    <span
      data-status-dot="not_started"
      style={{
        ...base,
        background: 'transparent',
        boxShadow: 'inset 0 0 0 1.5px var(--border-strong)',
      }}
    />
  );
}

interface TocCollapsedDotsProps {
  course: Course | null;
  progress: Progress | null;
  slug: string;
  currentLessonSlug: string;
}

function TocCollapsedDots({
  course,
  progress,
  slug,
  currentLessonSlug,
}: TocCollapsedDotsProps) {
  if (!course) return null;
  const lessonsState = progress?.courses?.[slug]?.lessons ?? {};
  const flat = course.modules.flatMap((m) => m.lessons);
  return (
    <div
      data-testid="toc-collapsed-dots"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '4px 0',
      }}
    >
      {flat.map((les) => {
        const status: LessonStatus =
          lessonsState[les.slug]?.status ?? 'not_started';
        const isActive = les.slug === currentLessonSlug;
        return (
          <Link
            key={les.slug}
            href={`/courses/${slug}/lessons/${les.slug}`}
            data-testid="toc-collapsed-dot"
            data-lesson-slug={les.slug}
            data-active={isActive ? 'true' : 'false'}
            title={les.title}
            aria-label={les.title}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              borderRadius: 'var(--radius-sm)',
              background: isActive ? 'var(--accent-subtle)' : 'transparent',
              textDecoration: 'none',
            }}
          >
            <StatusDot status={status} />
          </Link>
        );
      })}
    </div>
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

interface LessonRefMin {
  slug: string;
  title: string;
}

interface BottomBarProps {
  prevLesson: LessonRefMin | null;
  nextLesson: LessonRefMin | null;
  status: LessonStatus;
  onMarkComplete: () => void;
  onNavigate: (slug: string) => void;
}

function BottomBar({
  prevLesson,
  nextLesson,
  status,
  onMarkComplete,
  onNavigate,
}: BottomBarProps) {
  const isFinished = status === 'finished';
  return (
    <footer
      data-testid="lesson-bottom-bar"
      style={{
        gridColumn: '1 / -1',
        gridRow: '3 / 4',
        height: BOTTOM_H,
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--space-5)',
        gap: 'var(--space-3)',
      }}
    >
      <NavButton
        side="prev"
        target={prevLesson}
        onClick={onNavigate}
      />
      <MarkCompleteButton finished={isFinished} onClick={onMarkComplete} />
      <NavButton
        side="next"
        target={nextLesson}
        onClick={onNavigate}
      />
    </footer>
  );
}

function NavButton({
  side,
  target,
  onClick,
}: {
  side: 'prev' | 'next';
  target: LessonRefMin | null;
  onClick: (slug: string) => void;
}) {
  const disabled = target === null;
  const isPrev = side === 'prev';
  const eyebrow = isPrev ? 'Previous' : 'Next';
  const testId = isPrev ? 'bottom-bar-prev' : 'bottom-bar-next';
  const label = target?.title ?? '';

  const inner = (
    <>
      {isPrev && (
        <ArrowLeft
          size={14}
          strokeWidth={2}
          style={{ flexShrink: 0, opacity: disabled ? 0.5 : 1 }}
        />
      )}
      <span
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: isPrev ? 'flex-start' : 'flex-end',
          lineHeight: 1.1,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: '10.5px',
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontWeight: 600,
          }}
        >
          {eyebrow}
        </span>
        <span
          style={{
            fontSize: 'var(--fs-sm)',
            color: disabled ? 'var(--text-quaternary)' : 'var(--text)',
            fontWeight: 500,
            maxWidth: 200,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={label}
        >
          {label || '—'}
        </span>
      </span>
      {!isPrev && (
        <ArrowRight
          size={14}
          strokeWidth={2}
          style={{ flexShrink: 0, opacity: disabled ? 0.5 : 1 }}
        />
      )}
    </>
  );

  return (
    <button
      type="button"
      data-testid={testId}
      data-disabled={disabled ? 'true' : 'false'}
      aria-label={
        disabled
          ? `${eyebrow} lesson (none)`
          : `${eyebrow} lesson: ${label}`
      }
      disabled={disabled}
      onClick={() => {
        if (!disabled && target) onClick(target.slug);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        height: 40,
        padding: '0 12px',
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 'var(--radius-md)',
        color: 'var(--text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        textAlign: 'left',
        minWidth: 0,
      }}
    >
      {inner}
    </button>
  );
}

function MarkCompleteButton({
  finished,
  onClick,
}: {
  finished: boolean;
  onClick: () => void;
}) {
  const baseStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 32,
    padding: '0 14px',
    fontSize: 'var(--fs-sm)',
    fontWeight: 500,
    borderRadius: 'var(--radius-md)',
    border: '1px solid transparent',
    cursor: 'pointer',
    lineHeight: 1,
    whiteSpace: 'nowrap',
  };

  if (finished) {
    return (
      <button
        type="button"
        data-testid="bottom-bar-mark-complete"
        data-finished="true"
        onClick={onClick}
        style={{
          ...baseStyle,
          background: 'transparent',
          color: 'var(--text-secondary)',
        }}
        aria-label="Lesson completed"
      >
        <Check size={14} strokeWidth={2.25} />
        Lesson completed
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid="bottom-bar-mark-complete"
      data-finished="false"
      onClick={onClick}
      style={{
        ...baseStyle,
        background: 'var(--accent)',
        color: 'var(--text-on-accent)',
      }}
      aria-label="Mark lesson complete"
    >
      Mark lesson complete
    </button>
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

interface LessonStreamProps {
  course: Course | null;
  lesson: Lesson;
  slug: string;
  lessonSlug: string;
  progress: Progress | null;
  editingSections: Record<string, boolean>;
  onToggleEdit: (sectionId: string) => void;
  onSaveTheory: (sectionId: string, nextMarkdown: string) => Promise<void>;
  panelSectionId: string | null;
  onOpenPanel: (sectionId: string) => void;
  onOpenLessonSources: () => void;
}

function LessonStream({
  course,
  lesson,
  slug,
  lessonSlug,
  progress,
  editingSections,
  onToggleEdit,
  onSaveTheory,
  panelSectionId,
  onOpenPanel,
  onOpenLessonSources,
}: LessonStreamProps) {
  const sectionState =
    progress?.courses?.[slug]?.lessons?.[lessonSlug]?.sectionState ?? {};

  // Sections completed in-session (quiz answered correctly, code submitted
  // passing). Persisted completions come from sectionState[id].done.
  const [autoDone, setAutoDone] = useState<Record<string, boolean>>({});
  const markSectionDone = useCallback((sectionId: string) => {
    setAutoDone((prev) =>
      prev[sectionId] ? prev : { ...prev, [sectionId]: true },
    );
  }, []);

  const { moduleN, lessonM } = useMemo(() => {
    if (!course) return { moduleN: 0, lessonM: 0 };
    const mIdx = course.modules.findIndex((m) => m.id === lesson.moduleId);
    if (mIdx < 0) return { moduleN: 0, lessonM: 0 };
    const lIdx = course.modules[mIdx].lessons.findIndex(
      (l) => l.slug === lesson.slug,
    );
    return { moduleN: mIdx + 1, lessonM: lIdx >= 0 ? lIdx + 1 : 0 };
  }, [course, lesson]);

  return (
    <div
      data-testid="lesson-stream"
      style={{
        maxWidth: 760,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-section)',
      }}
    >
      <LessonHeader
        moduleN={moduleN}
        lessonM={lessonM}
        title={lesson.title}
        description={lesson.description}
        sourcesCount={lesson.sources?.length ?? 0}
        onOpenLessonSources={onOpenLessonSources}
      />
      {lesson.sections.map((section, idx) => {
        const persistedDone = sectionState[section.id]?.done === true;
        const live = autoDone[section.id] === true;
        const status: WidgetStatus = persistedDone || live ? 'done' : 'todo';
        return (
          <SectionRenderer
            key={section.id}
            section={section}
            sectionNumber={idx + 1}
            status={status}
            initialUserCode={sectionState[section.id]?.userCode}
            courseSlug={slug}
            lessonSlug={lessonSlug}
            onComplete={() => markSectionDone(section.id)}
            editing={editingSections[section.id] === true}
            onToggleEdit={onToggleEdit}
            onSaveTheory={onSaveTheory}
            panelOpen={panelSectionId === section.id}
            onOpenPanel={onOpenPanel}
          />
        );
      })}
      {lesson.sources && lesson.sources.length > 0 && (
        <LessonSourcesPanel sources={lesson.sources} />
      )}
    </div>
  );
}

function LessonHeader({
  moduleN,
  lessonM,
  title,
  description,
  sourcesCount,
  onOpenLessonSources,
}: {
  moduleN: number;
  lessonM: number;
  title: string;
  description: string;
  sourcesCount: number;
  onOpenLessonSources: () => void;
}) {
  return (
    <header
      data-testid="lesson-header"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <div
        data-testid="lesson-header-eyebrow"
        style={{
          fontSize: 'var(--fs-xs)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
          color: 'var(--text-tertiary)',
          lineHeight: 1.2,
        }}
      >
        Module {moduleN} · Lesson {lessonM}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--space-3)',
        }}
      >
        <h1
          data-testid="lesson-header-title"
          style={{
            margin: 0,
            flex: 1,
            fontSize: 'var(--fs-3xl)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            fontFamily: 'var(--font-display)',
            color: 'var(--text)',
            lineHeight: 1.15,
          }}
        >
          {title}
        </h1>
        <button
          type="button"
          data-testid="lesson-header-sources-btn"
          onClick={onOpenLessonSources}
          aria-label="Edit lesson sources"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 30,
            padding: '0 10px',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 'var(--fs-xs)',
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          <Library size={14} aria-hidden />
          Lesson sources
          {sourcesCount > 0 && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-tertiary)',
              }}
            >
              {sourcesCount}
            </span>
          )}
        </button>
      </div>
      {description ? (
        <p
          data-testid="lesson-header-description"
          style={{
            margin: 0,
            fontSize: 'var(--fs-md)',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      ) : null}
    </header>
  );
}

interface SectionRendererProps {
  section: Section;
  sectionNumber: number;
  status: WidgetStatus;
  initialUserCode?: string;
  courseSlug: string;
  lessonSlug: string;
  onComplete: () => void;
  editing: boolean;
  onToggleEdit: (sectionId: string) => void;
  onSaveTheory: (sectionId: string, nextMarkdown: string) => Promise<void>;
  panelOpen: boolean;
  onOpenPanel: (sectionId: string) => void;
}

function SectionRenderer({
  section,
  sectionNumber,
  status,
  initialUserCode,
  courseSlug,
  lessonSlug,
  onComplete,
  editing,
  onToggleEdit,
  onSaveTheory,
  panelOpen,
  onOpenPanel,
}: SectionRendererProps) {
  // Runtime check guards against unknown widget types (e.g. malformed lesson
  // JSON or future schema additions); the static union covers the 6 known ones.
  if (!(section.type in widgetRegistry)) {
    return (
      <div
        id={`section-${section.id}`}
        data-section-id={section.id}
        data-widget-unknown
      >
        <Callout tone="warning">
          Unsupported widget type:{' '}
          <code style={{ fontFamily: 'var(--font-mono)' }}>
            {(section as { type: string }).type}
          </code>
        </Callout>
      </div>
    );
  }

  const progressKey = {
    courseSlug,
    lessonSlug,
    sectionId: section.id,
  };

  let body: ReactNode;
  let pencilNode: ReactNode | undefined;
  const sourcesNode: ReactNode | undefined =
    section.sources && section.sources.length > 0 ? (
      <SectionSourcesPopover sources={section.sources} sectionId={section.id} />
    ) : undefined;

  function pencilButton(
    pressed: boolean,
    label: string,
    onClick: () => void,
    testId: string,
  ): ReactNode {
    return (
      <button
        type="button"
        data-testid={testId}
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        style={{
          width: 28,
          height: 28,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid transparent',
          background: pressed ? 'var(--bg-active)' : 'transparent',
          color: pressed ? 'var(--text)' : 'var(--text-tertiary)',
          cursor: 'pointer',
        }}
      >
        <Pencil size={14} strokeWidth={2} aria-hidden />
      </button>
    );
  }

  if (section.type === 'quiz') {
    body = <QuizWidget data={section.data} onCorrect={onComplete} />;
    pencilNode = pencilButton(
      panelOpen,
      panelOpen ? 'Close edit' : 'Edit quiz',
      () => onOpenPanel(section.id),
      'quiz-edit-btn',
    );
  } else if (section.type === 'code') {
    body = (
      <CodeWidget
        data={section.data}
        initialCode={initialUserCode}
        progressKey={progressKey}
        onComplete={onComplete}
      />
    );
    pencilNode = pencilButton(
      panelOpen,
      panelOpen ? 'Close edit' : 'Edit code exercise',
      () => onOpenPanel(section.id),
      'code-edit-btn',
    );
  } else if (section.type === 'codeCloze') {
    const Body = widgetRegistry.codeCloze.component as ComponentType<{
      data?: unknown;
      progressKey?: typeof progressKey;
      onComplete?: () => void;
    }>;
    body = (
      <Body
        data={section.data}
        progressKey={progressKey}
        onComplete={onComplete}
      />
    );
    pencilNode = pencilButton(
      panelOpen,
      panelOpen ? 'Close edit' : 'Edit code cloze',
      () => onOpenPanel(section.id),
      'code-cloze-edit-btn',
    );
  } else if (section.type === 'sandbox') {
    body = (
      <SandboxWidget
        data={section.data}
        initialCode={initialUserCode}
        progressKey={progressKey}
      />
    );
    pencilNode = pencilButton(
      panelOpen,
      panelOpen ? 'Close edit' : 'Edit sandbox',
      () => onOpenPanel(section.id),
      'sandbox-edit-btn',
    );
  } else if (section.type === 'demo') {
    const Body = widgetRegistry.demo.component;
    body = <Body data={section.data} />;
    pencilNode = pencilButton(
      panelOpen,
      panelOpen ? 'Close edit' : 'Edit demo',
      () => onOpenPanel(section.id),
      'demo-edit-btn',
    );
  } else if (section.type === 'histogram') {
    const Body = widgetRegistry.histogram.component;
    body = <Body data={section.data} />;
    pencilNode = pencilButton(
      panelOpen,
      panelOpen ? 'Close edit' : 'Edit histogram',
      () => onOpenPanel(section.id),
      'histogram-edit-btn',
    );
  } else if (section.type === 'plotImage') {
    const Body = widgetRegistry.plotImage.component;
    body = <Body data={section.data} />;
    pencilNode = pencilButton(
      panelOpen,
      panelOpen ? 'Close edit' : 'Edit plot image',
      () => onOpenPanel(section.id),
      'plot-image-edit-btn',
    );
  } else if (section.type === 'parametricExplorer') {
    const Body = widgetRegistry.parametricExplorer.component;
    body = <Body data={section.data} />;
    pencilNode = pencilButton(
      panelOpen,
      panelOpen ? 'Close edit' : 'Edit parametric explorer',
      () => onOpenPanel(section.id),
      'parametric-explorer-edit-btn',
    );
  } else if (section.type === 'dragMatch') {
    const Body = widgetRegistry.dragMatch.component as ComponentType<{
      data?: unknown;
      progressKey?: typeof progressKey;
      onComplete?: () => void;
    }>;
    body = (
      <Body
        data={section.data}
        progressKey={progressKey}
        onComplete={onComplete}
      />
    );
    pencilNode = pencilButton(
      panelOpen,
      panelOpen ? 'Close edit' : 'Edit drag match',
      () => onOpenPanel(section.id),
      'drag-match-edit-btn',
    );
  } else if (section.type === 'theory') {
    if (editing) {
      body = (
        <TheoryEditor
          initialMarkdown={section.data.markdown}
          onCancel={() => onToggleEdit(section.id)}
          onSave={(next) => onSaveTheory(section.id, next)}
        />
      );
    } else {
      const Body = widgetRegistry.theory.component;
      body = <Body data={section.data} />;
    }
    pencilNode = pencilButton(
      editing,
      editing ? 'Close edit' : 'Edit theory',
      () => onToggleEdit(section.id),
      'theory-edit-btn',
    );
  } else {
    const Body = widgetRegistry[section.type as WidgetType].component;
    body = <Body data={section.data} />;
  }

  const headerActions: ReactNode | undefined =
    sourcesNode || pencilNode ? (
      <>
        {sourcesNode}
        {pencilNode}
      </>
    ) : undefined;

  return (
    <div
      id={`section-${section.id}`}
      data-section-id={section.id}
      data-section-type={section.type}
      data-section-editing={editing || panelOpen ? 'true' : 'false'}
    >
      <Widget
        type={section.type as WidgetType}
        sectionNumber={sectionNumber}
        title={section.title}
        status={status}
        headerActions={headerActions}
      >
        {body}
      </Widget>
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
