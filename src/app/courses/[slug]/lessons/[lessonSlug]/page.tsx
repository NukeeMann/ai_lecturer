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
  Loader2,
  Pencil,
  Printer,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

import { AppLogoLink } from '@/components/AppLogo';
import { AvatarMenu } from '@/components/AvatarMenu';
import { Callout } from '@/components/Callout';
import { formBodyStyle } from '@/components/EditorForm';
import { openShortcutsModal } from '@/components/GlobalShortcutsHost';
import { LessonChat } from '@/components/LessonChat';
import { keyLabel } from '@/lib/platform/platform';
import { useIsMacPlatform } from '@/lib/platform/useIsMacPlatform';
import { SidePanel } from '@/components/SidePanel';
import {
  LessonSourcesPanel,
  SectionSourcesPopover,
  SourceCard,
  SourcesField,
} from '@/components/Sources';
import {
  SettingsMenu,
  applyAccent,
  readAccentOverride,
} from '@/components/SettingsMenu';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  isMod,
  preferredScrollBehavior,
  useKeyboardShortcuts,
  type KeyboardShortcut,
} from '@/lib/hooks/useKeyboardShortcuts';
import {
  areAllSectionsDone,
  buildAutoAdvancePatch,
  countDoneSections,
  pathForAdvanceTarget,
  resolveAdvanceTarget,
} from '@/lib/lessons/advance';
import { usePyodide } from '@/lib/pyodide/client';
import type { Course } from '@/lib/schemas/course';
import type { Lesson, Section, Source } from '@/lib/schemas/lesson';
import type { LessonStatus, Progress, SectionState } from '@/lib/schemas/progress';
import { CodeEditor } from '@/widgets/Code/CodeEditor';
import { CodeWidget } from '@/widgets/Code/CodeWidget';
import { DemoEditor } from '@/widgets/Demo/DemoEditor';
import { CodeClozeEditor } from '@/widgets/CodeCloze/CodeClozeEditor';
import { DataTableEditor } from '@/widgets/DataTable/DataTableEditor';
import { DragMatchEditor } from '@/widgets/DragMatch/DragMatchEditor';
import { HistogramEditor } from '@/widgets/Histogram/HistogramEditor';
import { ParametricExplorerEditor } from '@/widgets/ParametricExplorer/ParametricExplorerEditor';
import { PlotImageEditor } from '@/widgets/PlotImage/PlotImageEditor';
import { QuizEditor } from '@/widgets/Quiz/QuizEditor';
import { QuizWidget } from '@/widgets/Quiz/QuizWidget';
import { SandboxEditor } from '@/widgets/Sandbox/SandboxEditor';
import { SandboxWidget } from '@/widgets/Sandbox/SandboxWidget';
import { TheoryEditor } from '@/widgets/Theory/TheoryEditor';
import { VideoEditor } from '@/widgets/Video/VideoEditor';
import { VideoWidget } from '@/widgets/Video/VideoWidget';
import type { VideoTranscriptSegment } from '@/widgets/Video/schema';
import { AudioPlayerEditor } from '@/widgets/AudioPlayer/AudioPlayerEditor';
import { AudioPlayerWidget } from '@/widgets/AudioPlayer/AudioPlayerWidget';
import { SttDemoEditor } from '@/widgets/SttDemo/SttDemoEditor';
import { SttDemoWidget } from '@/widgets/SttDemo/SttDemoWidget';
import { TtsDemoEditor } from '@/widgets/TtsDemo/TtsDemoEditor';
import { TtsDemoWidget } from '@/widgets/TtsDemo/TtsDemoWidget';
import { TranscriptClozeEditor } from '@/widgets/TranscriptCloze/TranscriptClozeEditor';
import { TranscriptClozeWidget } from '@/widgets/TranscriptCloze/TranscriptClozeWidget';
import { Widget, type WidgetStatus } from '@/widgets/Widget';
import { widgetRegistry, type WidgetType } from '@/widgets/registry';
import diffWords, { type DiffPart } from '@/lib/diff/sectionDiff';

const TOC_COLLAPSED_KEY = 'toc-collapsed';
const CHAT_OPEN_KEY = 'lessonChat-open';
const CHAT_WIDTH_KEY = 'lessonChat-width';

interface RouteParams {
  slug: string;
  lessonSlug: string;
}

const TOC_EXPANDED = 276;
const TOC_COLLAPSED = 52;
const CHAT_DEFAULT_WIDTH = 320;
const CHAT_MIN_WIDTH = 280;
const CHAT_MAX_WIDTH = 720;
const CHAT_NARROW_WINDOW_THRESHOLD = 600;
const CHAT_MIN_LESSON_WIDTH = 320;
const TOOLBAR_H = 52;
const BOTTOM_H = 56;

function readChatWidth(): number {
  try {
    const stored = window.localStorage.getItem(CHAT_WIDTH_KEY);
    if (stored === null) return CHAT_DEFAULT_WIDTH;
    const parsed = parseInt(stored, 10);
    if (!Number.isFinite(parsed)) return CHAT_DEFAULT_WIDTH;
    return Math.min(CHAT_MAX_WIDTH, Math.max(CHAT_MIN_WIDTH, parsed));
  } catch {
    return CHAT_DEFAULT_WIDTH;
  }
}

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
  const [sessionToast, setSessionToast] = useState<string | null>(null);
  // US-153: separate toast for "Generating PDF…" with its own 30s lifecycle,
  // dismissed when navigation triggers the download (visibilitychange) or
  // after the timeout — whichever first.
  const [pdfToast, setPdfToast] = useState<string | null>(null);
  const pdfToastTimerRef = useRef<number | null>(null);

  // Sections completed in-session (Quiz correct, Code submit pass, etc.).
  // Lifted from LessonStream so the page can compute lesson-level completion
  // for the US-067 auto-advance trigger.
  const [autoDone, setAutoDone] = useState<Record<string, boolean>>({});
  const markSectionAutoDone = useCallback((sectionId: string) => {
    setAutoDone((prev) => (prev[sectionId] ? prev : { ...prev, [sectionId]: true }));
  }, []);

  // Auto-advance toast (US-067).
  const [autoAdvancePending, setAutoAdvancePending] = useState(false);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const cancelledLessonsRef = useRef<Set<string>>(new Set());
  const lastAllDoneRef = useRef(false);
  // Tracks whether we've captured the first lesson+progress baseline so that
  // re-entering an already-completed lesson does NOT auto-advance immediately.
  const baselineSetRef = useRef(false);

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
  // Section regenerate popover (US-147). At most one popover open at a time.
  const [regenSectionId, setRegenSectionId] = useState<string | null>(null);
  // Full-lesson regenerate dialog + Undo banner (US-149).
  const [regenLessonDialogOpen, setRegenLessonDialogOpen] = useState(false);
  const [regenLessonInstruction, setRegenLessonInstruction] = useState('');
  const [regenLessonSubmitting, setRegenLessonSubmitting] = useState(false);
  const [regenLessonError, setRegenLessonError] = useState<string | null>(null);
  const [undoBannerVisible, setUndoBannerVisible] = useState(false);
  const [undoBannerFading, setUndoBannerFading] = useState(false);
  const [undoBannerError, setUndoBannerError] = useState<string | null>(null);
  const undoBannerErrorTimerRef = useRef<number | null>(null);
  const undoBannerFadeTimerRef = useRef<number | null>(null);
  // Lesson-level sources side panel (US-040). Independent of section panel.
  const [lessonSourcesPanelOpen, setLessonSourcesPanelOpen] = useState(false);
  // LessonChat side-panel state, persisted to localStorage['lessonChat-open'].
  // Hydrated from storage in the same effect that hydrates TOC collapse below.
  const [chatOpen, setChatOpen] = useState(false);
  // Chat panel width, persisted to localStorage['lessonChat-width']. Default
  // 320 keeps the legacy fixed width unchanged on first paint; hydrated below.
  const [chatWidth, setChatWidth] = useState<number>(CHAT_DEFAULT_WIDTH);
  // Live-drag flag: while dragging, the grid's column transition is disabled
  // so the chat tracks the pointer 1:1; restored on pointer-up so close/open
  // animations keep their easing.
  const [chatDragging, setChatDragging] = useState(false);
  // Mirrors current window width for the narrow-viewport clamp described in
  // US-135 AC. Initial render uses 1280 to stay SSR-safe; the resize effect
  // below replaces it with the real value on mount.
  const [chatWindowWidth, setChatWindowWidth] = useState<number>(1280);
  const chatWidthRef = useRef<number>(CHAT_DEFAULT_WIDTH);
  useEffect(() => {
    chatWidthRef.current = chatWidth;
  }, [chatWidth]);
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
      const chatStored = window.localStorage.getItem(CHAT_OPEN_KEY);
      if (chatStored === 'true') {
        setChatOpen(true);
      }
      const hydratedWidth = readChatWidth();
      if (hydratedWidth !== CHAT_DEFAULT_WIDTH) {
        setChatWidth(hydratedWidth);
      }
      setChatWindowWidth(window.innerWidth);
    } catch {
      // localStorage unavailable (SSR / privacy mode) — fall back to default.
    }
  }, []);

  // Track viewport width so we can clamp the effective chat width on narrow
  // windows without persisting that clamp (the user's preferred width is
  // restored when the window widens again).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setChatWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
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

  const toggleChat = useCallback(() => {
    setChatOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(CHAT_OPEN_KEY, next ? 'true' : 'false');
      } catch {
        // Persistence unavailable — toggle still works for the session.
      }
      return next;
    });
  }, []);

  const closeChat = useCallback(() => {
    setChatOpen(false);
    try {
      window.localStorage.setItem(CHAT_OPEN_KEY, 'false');
    } catch {
      // Persistence unavailable — close still works for the session.
    }
  }, []);

  const persistChatWidth = useCallback((w: number) => {
    try {
      window.localStorage.setItem(CHAT_WIDTH_KEY, String(Math.round(w)));
    } catch {
      // Persistence unavailable — in-memory width still works.
    }
  }, []);

  const handleChatResize = useCallback((w: number) => {
    setChatWidth(w);
  }, []);

  const handleChatResizeStart = useCallback(() => {
    setChatDragging(true);
  }, []);

  const handleChatResizeEnd = useCallback(
    (finalWidth: number) => {
      setChatDragging(false);
      setChatWidth(finalWidth);
      persistChatWidth(finalWidth);
    },
    [persistChatWidth],
  );

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

  // Apply the per-course accent (US-076). Resolution order is user override
  // (localStorage `aiLecturer.accent.<slug>`) → course.json `accentColor`
  // → 'default'. Re-runs when the course changes (navigating between
  // courses) and on cleanup resets to 'default' so leaving the lesson
  // route (back to dashboard, etc.) drops any non-default accent.
  useEffect(() => {
    if (!course) return;
    const override = readAccentOverride(slug);
    applyAccent(override ?? course.accentColor ?? 'default');
    return () => {
      applyAccent('default');
    };
  }, [slug, course]);

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

  // Reset transient auto-advance state on lesson change. Cancellations are
  // tracked per-lesson in cancelledLessonsRef and persist across remounts
  // within the same SPA session, so they intentionally do NOT reset here.
  useEffect(() => {
    setAutoDone({});
    setAutoAdvancePending(false);
    lastAllDoneRef.current = false;
    baselineSetRef.current = false;
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  }, [lessonSlug]);

  // Cleanup auto-advance timer on unmount.
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
  }, []);

  const moduleTitle = useMemo(() => {
    if (!course || !lesson) return '';
    return course.modules.find((m) => m.id === lesson.moduleId)?.title ?? '';
  }, [course, lesson]);

  const sectionTotals = useMemo(() => {
    if (!lesson) return { total: 0, done: 0 };
    return countDoneSections(lesson, {
      persistedSectionState:
        progress?.courses?.[slug]?.lessons?.[lessonSlug]?.sectionState,
      manuallyCompleted:
        progress?.courses?.[slug]?.lessons?.[lessonSlug]
          ?.manuallyCompletedSections,
      liveAutoDone: autoDone,
    });
  }, [lesson, progress, slug, lessonSlug, autoDone]);

  const tocCol = tocCollapsed ? TOC_COLLAPSED : TOC_EXPANDED;
  // Clamp the effective chat width when the window is narrow enough that
  // honouring the user's persisted width would squeeze the lesson column
  // below 320px. Persistence is intentionally not touched here.
  const effectiveChatWidth =
    chatWindowWidth < CHAT_NARROW_WINDOW_THRESHOLD
      ? Math.max(0, Math.min(chatWidth, chatWindowWidth - CHAT_MIN_LESSON_WIDTH))
      : chatWidth;
  const chatCol = chatOpen ? effectiveChatWidth : 0;

  const shellStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `${tocCol}px minmax(0,1fr) ${chatCol}px`,
    gridTemplateRows: `${TOOLBAR_H}px 1fr ${BOTTOM_H}px`,
    height: '100vh',
    width: '100%',
    overflow: 'hidden',
    background: 'var(--bg)',
    color: 'var(--text)',
    transition: chatDragging ? 'none' : 'grid-template-columns 180ms ease',
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

  const advanceTarget = useMemo(() => {
    if (!course) return null;
    return resolveAdvanceTarget(course, lessonSlug);
  }, [course, lessonSlug]);

  // Refs that mirror the latest lesson/progress/autoDone so the auto-advance
  // timer callback (set up once per scheduling, fires up to 1500ms later) can
  // read the most recent values when computing the US-081 persistence patch.
  const lessonRef = useRef(lesson);
  const progressRef = useRef(progress);
  const autoDoneRef = useRef(autoDone);
  useEffect(() => {
    lessonRef.current = lesson;
  }, [lesson]);
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);
  useEffect(() => {
    autoDoneRef.current = autoDone;
  }, [autoDone]);

  const scheduleAutoAdvance = useCallback(
    (opts: { force?: boolean } = {}) => {
      if (!advanceTarget) return;
      if (!opts.force && cancelledLessonsRef.current.has(lessonSlug)) return;
      if (autoAdvanceTimerRef.current !== null) return;
      setAutoAdvancePending(true);
      autoAdvanceTimerRef.current = window.setTimeout(() => {
        autoAdvanceTimerRef.current = null;
        setAutoAdvancePending(false);

        // US-081: persist completion for the just-left lesson before
        // navigating away. Auto-advance is the trigger; manual navigation
        // (handleNextLesson / handlePrevLesson) bypasses this path and
        // therefore does NOT mark the lesson Completed.
        const currentLesson = lessonRef.current;
        if (currentLesson) {
          const lessonProgress =
            progressRef.current?.courses?.[slug]?.lessons?.[lessonSlug];
          const patch = buildAutoAdvancePatch(currentLesson.sections, {
            persistedSectionState: lessonProgress?.sectionState,
            manuallyCompleted: lessonProgress?.manuallyCompletedSections,
            liveAutoDone: autoDoneRef.current,
          });

          setProgress((prev) => {
            const base: Progress = prev ?? { courses: {} };
            const courses = { ...base.courses };
            const cp = courses[slug]
              ? { ...courses[slug], lessons: { ...courses[slug].lessons } }
              : { lessons: {} };
            const existing = cp.lessons[lessonSlug] ?? {
              status: 'not_started' as LessonStatus,
            };
            cp.lessons[lessonSlug] = {
              ...existing,
              status: 'finished',
              sectionState: {
                ...(existing.sectionState ?? {}),
                ...patch.sectionState,
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
              status: patch.status,
              sectionState: patch.sectionState,
            }),
          }).catch(() => {
            // Optimistic local update already applied; persistence retry
            // would need an inline error UI we don't have yet.
          });
        }

        router.push(pathForAdvanceTarget(advanceTarget));
      }, 1500);
    },
    [advanceTarget, lessonSlug, router, slug],
  );

  const cancelAutoAdvance = useCallback(() => {
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setAutoAdvancePending(false);
    cancelledLessonsRef.current.add(lessonSlug);
  }, [lessonSlug]);

  // Auto-advance trigger: when every section in the current lesson becomes
  // done (across all completion sources), schedule a delayed navigation.
  // We only fire on the false→true transition so re-entering an already
  // completed lesson does not auto-advance immediately.
  const allSectionsDone = useMemo(() => {
    if (!lesson) return false;
    return areAllSectionsDone(lesson, {
      persistedSectionState:
        progress?.courses?.[slug]?.lessons?.[lessonSlug]?.sectionState,
      manuallyCompleted:
        progress?.courses?.[slug]?.lessons?.[lessonSlug]
          ?.manuallyCompletedSections,
      liveAutoDone: autoDone,
    });
  }, [lesson, progress, slug, lessonSlug, autoDone]);

  useEffect(() => {
    if (!lesson || !progress) return;
    if (!baselineSetRef.current) {
      // Capture the on-load completion state as the baseline. If the learner
      // is re-entering an already-finished lesson, this prevents an immediate
      // auto-advance on first paint.
      lastAllDoneRef.current = allSectionsDone;
      baselineSetRef.current = true;
      return;
    }
    if (allSectionsDone && !lastAllDoneRef.current) {
      scheduleAutoAdvance();
    }
    lastAllDoneRef.current = allSectionsDone;
  }, [lesson, progress, allSectionsDone, scheduleAutoAdvance]);

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

    // Mark Complete is an explicit user action, so it bypasses any prior
    // auto-advance cancellation for this lesson.
    scheduleAutoAdvance({ force: true });
  }, [slug, lessonSlug, scheduleAutoAdvance]);

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

  const handleToggleSectionManualComplete = useCallback(
    (sectionId: string, nextValue: boolean) => {
      // Optimistic local update so the checkbox + dimmed style flip immediately.
      setProgress((prev) => {
        const base: Progress = prev ?? { courses: {} };
        const courses = { ...base.courses };
        const cp = courses[slug]
          ? { ...courses[slug], lessons: { ...courses[slug].lessons } }
          : { lessons: {} };
        const existingLesson = cp.lessons[lessonSlug] ?? {
          status: 'not_started' as LessonStatus,
        };
        const merged: Record<string, boolean> = {
          ...(existingLesson.manuallyCompletedSections ?? {}),
        };
        if (nextValue) merged[sectionId] = true;
        else delete merged[sectionId];
        const nextLessonProgress = { ...existingLesson };
        if (Object.keys(merged).length > 0) {
          nextLessonProgress.manuallyCompletedSections = merged;
        } else {
          delete nextLessonProgress.manuallyCompletedSections;
        }
        cp.lessons[lessonSlug] = nextLessonProgress;
        courses[slug] = cp;
        return { ...base, courses };
      });

      void fetch('/api/progress', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseSlug: slug,
          lessonSlug,
          manuallyCompletedSections: { [sectionId]: nextValue },
        }),
      }).catch(() => {
        // Optimistic update already applied; no inline error UI yet.
      });
    },
    [slug, lessonSlug],
  );

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

  // Cache an auto-fetched video transcript into the lesson JSON so subsequent
  // renders use the cached value instead of re-fetching. Manual transcripts are
  // never overridden because the widget skips auto-fetch when one exists.
  // (lessonRef is shared with the auto-advance scheduler above.)
  const handleCacheVideoTranscript = useCallback(
    async (sectionId: string, segments: VideoTranscriptSegment[]) => {
      if (segments.length === 0) return;
      const cur = lessonRef.current;
      if (!cur) return;
      const target = cur.sections.find((s) => s.id === sectionId);
      if (!target || target.type !== 'video') return;
      if (target.data.transcript && target.data.transcript.length > 0) return;
      const next: Lesson = {
        ...cur,
        sections: cur.sections.map((s) =>
          s.id === sectionId && s.type === 'video'
            ? { ...s, data: { ...s.data, transcript: segments } }
            : s,
        ),
      };
      try {
        const saved = await persistLesson(next);
        setLesson(saved);
      } catch {
        // Best-effort cache; if PUT fails the in-memory lesson stays as-is and
        // the widget will retry on next mount.
      }
    },
    [persistLesson],
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
    },
    [lesson, persistLesson],
  );

  const handleOpenPanel = useCallback((sectionId: string) => {
    setPanelSectionId((cur) => (cur === sectionId ? null : sectionId));
  }, []);

  const handleClosePanel = useCallback(() => {
    setPanelSectionId(null);
  }, []);

  const handleToggleRegen = useCallback((sectionId: string) => {
    setRegenSectionId((cur) => (cur === sectionId ? null : sectionId));
  }, []);

  const handleCloseRegen = useCallback(() => {
    setRegenSectionId(null);
  }, []);

  // Status check for the full-lesson Undo banner (US-149). Run on mount and
  // after each lesson slug change. The snapshot persists across page reloads
  // until the user invokes Undo, so reopening a lesson where the snapshot
  // exists must surface the Undo affordance again.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/courses/${slug}/lessons/${lessonSlug}/regenerate/status`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { hasUndo?: boolean };
        if (cancelled) return;
        if (body.hasUndo) {
          setUndoBannerVisible(true);
          setUndoBannerFading(false);
          setUndoBannerError(null);
        } else {
          setUndoBannerVisible(false);
          setUndoBannerFading(false);
          setUndoBannerError(null);
        }
      } catch {
        // Best-effort — if status fails the banner just stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, lessonSlug]);

  // Cleanup any pending banner timers on unmount.
  useEffect(() => {
    return () => {
      if (undoBannerErrorTimerRef.current !== null) {
        window.clearTimeout(undoBannerErrorTimerRef.current);
        undoBannerErrorTimerRef.current = null;
      }
      if (undoBannerFadeTimerRef.current !== null) {
        window.clearTimeout(undoBannerFadeTimerRef.current);
        undoBannerFadeTimerRef.current = null;
      }
    };
  }, []);

  const handleOpenRegenLesson = useCallback(() => {
    setRegenLessonInstruction('');
    setRegenLessonError(null);
    setRegenLessonSubmitting(false);
    setRegenLessonDialogOpen(true);
  }, []);

  // US-153: Print to PDF — kicks off a native browser download by setting
  // window.location.href to the export endpoint. The puppeteer-driven
  // server route renders the print page and streams an application/pdf
  // body back, which the browser saves. The toast surfaces immediate
  // feedback; we auto-dismiss when the download begins (the browser fires
  // `visibilitychange`/`pagehide` once it hands off to the download UI) or
  // after a 30s timeout, whichever first.
  const handleExportLessonPdf = useCallback(() => {
    setPdfToast('Generating PDF…');
    if (pdfToastTimerRef.current !== null) {
      window.clearTimeout(pdfToastTimerRef.current);
    }
    pdfToastTimerRef.current = window.setTimeout(() => {
      setPdfToast(null);
      pdfToastTimerRef.current = null;
    }, 30000);
    window.location.href = `/api/courses/${encodeURIComponent(slug)}/lessons/${encodeURIComponent(lessonSlug)}/export/pdf`;
  }, [slug, lessonSlug]);

  useEffect(() => {
    if (!pdfToast) return;
    const dismiss = () => {
      setPdfToast(null);
      if (pdfToastTimerRef.current !== null) {
        window.clearTimeout(pdfToastTimerRef.current);
        pdfToastTimerRef.current = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') dismiss();
    };
    window.addEventListener('pagehide', dismiss);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', dismiss);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pdfToast]);

  const handleCloseRegenLesson = useCallback(() => {
    if (regenLessonSubmitting) return;
    setRegenLessonDialogOpen(false);
  }, [regenLessonSubmitting]);

  const handleSubmitRegenLesson = useCallback(async () => {
    const trimmed = regenLessonInstruction.trim();
    if (trimmed.length < 1 || trimmed.length > 2000 || regenLessonSubmitting) {
      return;
    }
    setRegenLessonError(null);
    setRegenLessonSubmitting(true);
    try {
      const res = await fetch(
        `/api/courses/${slug}/lessons/${lessonSlug}/regenerate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction: trimmed }),
        },
      );
      if (!res.ok) {
        let message = 'Server error — please try again.';
        if (res.status === 422) {
          message = 'Regeneration failed — try a different instruction.';
        } else if (res.status === 409) {
          message = 'Cannot regenerate while generation is active.';
        }
        setRegenLessonError(message);
        setRegenLessonSubmitting(false);
        return;
      }
      const body = (await res.json()) as { newLesson: Lesson };
      setLesson(body.newLesson);
      setRegenLessonSubmitting(false);
      setRegenLessonDialogOpen(false);
      setRegenLessonInstruction('');
      // Surface the banner. Cancel any pending error-timeout from a prior
      // failed Undo so a fresh regenerate gives the user a fresh affordance.
      if (undoBannerErrorTimerRef.current !== null) {
        window.clearTimeout(undoBannerErrorTimerRef.current);
        undoBannerErrorTimerRef.current = null;
      }
      if (undoBannerFadeTimerRef.current !== null) {
        window.clearTimeout(undoBannerFadeTimerRef.current);
        undoBannerFadeTimerRef.current = null;
      }
      setUndoBannerError(null);
      setUndoBannerFading(false);
      setUndoBannerVisible(true);
    } catch {
      setRegenLessonError('Server error — please try again.');
      setRegenLessonSubmitting(false);
    }
  }, [regenLessonInstruction, regenLessonSubmitting, slug, lessonSlug]);

  const handleUndoRegenLesson = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/courses/${slug}/lessons/${lessonSlug}/regenerate/undo`,
        { method: 'POST' },
      );
      if (res.status === 404) {
        setUndoBannerError('Undo unavailable.');
        if (undoBannerErrorTimerRef.current !== null) {
          window.clearTimeout(undoBannerErrorTimerRef.current);
        }
        undoBannerErrorTimerRef.current = window.setTimeout(() => {
          setUndoBannerVisible(false);
          setUndoBannerError(null);
          setUndoBannerFading(false);
          undoBannerErrorTimerRef.current = null;
        }, 3000);
        return;
      }
      if (!res.ok) {
        setUndoBannerError('Undo unavailable.');
        if (undoBannerErrorTimerRef.current !== null) {
          window.clearTimeout(undoBannerErrorTimerRef.current);
        }
        undoBannerErrorTimerRef.current = window.setTimeout(() => {
          setUndoBannerVisible(false);
          setUndoBannerError(null);
          setUndoBannerFading(false);
          undoBannerErrorTimerRef.current = null;
        }, 3000);
        return;
      }
      const body = (await res.json()) as { restoredLesson: Lesson };
      setLesson(body.restoredLesson);
      // Trigger fade then dismount.
      setUndoBannerFading(true);
      if (undoBannerFadeTimerRef.current !== null) {
        window.clearTimeout(undoBannerFadeTimerRef.current);
      }
      undoBannerFadeTimerRef.current = window.setTimeout(() => {
        setUndoBannerVisible(false);
        setUndoBannerFading(false);
        setUndoBannerError(null);
        undoBannerFadeTimerRef.current = null;
      }, 200);
    } catch {
      setUndoBannerError('Undo unavailable.');
      if (undoBannerErrorTimerRef.current !== null) {
        window.clearTimeout(undoBannerErrorTimerRef.current);
      }
      undoBannerErrorTimerRef.current = window.setTimeout(() => {
        setUndoBannerVisible(false);
        setUndoBannerError(null);
        setUndoBannerFading(false);
        undoBannerErrorTimerRef.current = null;
      }, 3000);
    }
  }, [slug, lessonSlug]);

  const handleDismissBanner = useCallback(() => {
    setUndoBannerVisible(false);
    setUndoBannerFading(false);
    setUndoBannerError(null);
    if (undoBannerErrorTimerRef.current !== null) {
      window.clearTimeout(undoBannerErrorTimerRef.current);
      undoBannerErrorTimerRef.current = null;
    }
    if (undoBannerFadeTimerRef.current !== null) {
      window.clearTimeout(undoBannerFadeTimerRef.current);
      undoBannerFadeTimerRef.current = null;
    }
  }, []);

  const handleAcceptRegen = useCallback(
    async (sectionId: string, newSection: Section) => {
      const cur = lessonRef.current;
      if (!cur) {
        throw new Error('Lesson not loaded');
      }
      const res = await fetch(
        `/api/courses/${slug}/lessons/${lessonSlug}/sections/${sectionId}/apply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newSection }),
        },
      );
      if (!res.ok) {
        let message = `Apply failed (${res.status})`;
        try {
          const detail = (await res.json()) as { error?: string };
          if (detail?.error) message = detail.error;
        } catch {
          // Fall through.
        }
        throw new Error(message);
      }
      const saved = (await res.json()) as Lesson;
      setLesson(saved);
      setRegenSectionId(null);
      setSessionToast('Section regenerated');
    },
    [slug, lessonSlug],
  );

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
        handler: () => toggleChat(),
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
      toggleChat,
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
        chatOpen={chatOpen}
        onToggleChat={toggleChat}
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
            regenSectionId={regenSectionId}
            onToggleRegen={handleToggleRegen}
            onCloseRegen={handleCloseRegen}
            onAcceptRegen={handleAcceptRegen}
            onOpenLessonSources={() => setLessonSourcesPanelOpen(true)}
            onOpenRegenLesson={handleOpenRegenLesson}
            onExportPdf={handleExportLessonPdf}
            undoBannerVisible={undoBannerVisible}
            undoBannerFading={undoBannerFading}
            undoBannerError={undoBannerError}
            onUndoRegenLesson={handleUndoRegenLesson}
            onDismissUndoBanner={handleDismissBanner}
            onToggleSectionManualComplete={handleToggleSectionManualComplete}
            autoDone={autoDone}
            onSectionAutoComplete={markSectionAutoDone}
            onCacheVideoTranscript={handleCacheVideoTranscript}
          />
        ) : null}
      </main>

      <LessonChat
        open={chatOpen}
        courseSlug={slug}
        lessonSlug={lessonSlug}
        onClose={closeChat}
        onToggle={toggleChat}
        chatWidth={chatWidth}
        minWidth={CHAT_MIN_WIDTH}
        maxWidth={CHAT_MAX_WIDTH}
        onResize={handleChatResize}
        onResizeStart={handleChatResizeStart}
        onResizeEnd={handleChatResizeEnd}
      />

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

      <RegenLessonDialog
        open={regenLessonDialogOpen}
        lessonTitle={lesson?.title ?? ''}
        instruction={regenLessonInstruction}
        onInstructionChange={setRegenLessonInstruction}
        submitting={regenLessonSubmitting}
        errorMessage={regenLessonError}
        onSubmit={handleSubmitRegenLesson}
        onCancel={handleCloseRegenLesson}
      />

      {sessionToast && <SessionToast message={sessionToast} />}
      {pdfToast && <PdfExportToast message={pdfToast} />}
      {autoAdvancePending && (
        <AutoAdvanceToast
          isLastLesson={advanceTarget?.kind === 'my-courses'}
          onCancel={cancelAutoAdvance}
        />
      )}
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

function PdfExportToast({ message }: { message: string }) {
  return (
    <div
      data-testid="pdf-export-toast"
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

function AutoAdvanceToast({
  isLastLesson,
  onCancel,
}: {
  isLastLesson: boolean;
  onCancel: () => void;
}) {
  const message = isLastLesson
    ? 'Going to My Courses…'
    : 'Going to next lesson…';
  return (
    <div
      data-testid="auto-advance-toast"
      data-last-lesson={isLastLesson ? 'true' : 'false'}
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: BOTTOM_H + 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-strong)',
        color: 'var(--text)',
        fontSize: 'var(--fs-sm)',
        padding: '8px 12px 8px 14px',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md, 0 8px 24px rgba(0, 0, 0, 0.18))',
      }}
    >
      <span>{message}</span>
      <button
        type="button"
        data-testid="auto-advance-cancel"
        onClick={onCancel}
        style={{
          background: 'transparent',
          border: '1px solid var(--border-strong)',
          color: 'var(--text)',
          fontSize: 'var(--fs-sm)',
          fontWeight: 600,
          padding: '4px 10px',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
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
      {section?.type === 'dataTable' && (
        <DataTableEditor
          key={section.id}
          initial={section.data}
          initialSources={section.sources}
          onCancel={onClose}
          onSave={(next, sources) => onSave(section.id, next, sources)}
        />
      )}
      {section?.type === 'video' && (
        <VideoEditor
          key={section.id}
          initial={section.data}
          initialSources={section.sources}
          onCancel={onClose}
          onSave={(next, sources) => onSave(section.id, next, sources)}
        />
      )}
      {section?.type === 'audioPlayer' && (
        <AudioPlayerEditor
          key={section.id}
          initial={section.data}
          initialSources={section.sources}
          onCancel={onClose}
          onSave={(next, sources) => onSave(section.id, next, sources)}
        />
      )}
      {section?.type === 'transcriptCloze' && (
        <TranscriptClozeEditor
          key={section.id}
          initial={section.data}
          initialSources={section.sources}
          onCancel={onClose}
          onSave={(next, sources) => onSave(section.id, next, sources)}
        />
      )}
      {section?.type === 'sttDemo' && (
        <SttDemoEditor
          key={section.id}
          initial={section.data}
          initialSources={section.sources}
          onCancel={onClose}
          onSave={(next, sources) => onSave(section.id, next, sources)}
        />
      )}
      {section?.type === 'ttsDemo' && (
        <TtsDemoEditor
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
  const [editing, setEditing] = useState(false);
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

  // When the side panel closes, reset edit mode so the next open starts in
  // readonly view (per AC: "opens the panel in readonly mode by default").
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditing(false);
      setSaveError(null);
    }
  }, [open]);

  const dirty = JSON.stringify(draft ?? null) !== initialKey;

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      await onSave(draft);
      setSaving(false);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }, [draft, onSave, saving]);

  const handleCloseEdit = useCallback(() => {
    setDraft(sources);
    setSaveError(null);
    setEditing(false);
  }, [sources]);

  const handleEnterEdit = useCallback(() => {
    setSaveError(null);
    setEditing(true);
  }, []);

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Lesson sources"
      testId="lesson-sources-edit-panel"
    >
      <div
        data-testid="lesson-sources-editor"
        data-mode={editing ? 'edit' : 'readonly'}
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <div style={formBodyStyle}>
          <LessonSourcesBox
            sources={sources}
            editing={editing}
            draft={draft}
            onDraftChange={setDraft}
            saving={saving}
            saveDisabled={!dirty}
            saveError={saveError}
            onEnterEdit={handleEnterEdit}
            onSave={() => void handleSave()}
            onCloseEdit={handleCloseEdit}
          />
        </div>
      </div>
    </SidePanel>
  );
}

interface LessonSourcesBoxProps {
  sources: Source[] | undefined;
  editing: boolean;
  draft: Source[] | undefined;
  onDraftChange: (next: Source[] | undefined) => void;
  saving: boolean;
  saveDisabled: boolean;
  saveError: string | null;
  onEnterEdit: () => void;
  onSave: () => void;
  onCloseEdit: () => void;
}

function LessonSourcesBox({
  sources,
  editing,
  draft,
  onDraftChange,
  saving,
  saveDisabled,
  saveError,
  onEnterEdit,
  onSave,
  onCloseEdit,
}: LessonSourcesBoxProps) {
  const list = sources ?? [];
  return (
    <section
      data-testid="lesson-sources-box"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: 'var(--fs-sm)',
            fontWeight: 600,
            color: 'var(--text)',
          }}
        >
          Lesson sources
        </span>
        <span
          style={{
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {list.length}
        </span>
        {!editing && (
          <button
            type="button"
            data-testid="lesson-sources-edit-toggle"
            onClick={onEnterEdit}
            aria-label="Edit lesson sources"
            style={{
              width: 28,
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Pencil size={13} aria-hidden />
          </button>
        )}
      </div>
      {editing ? (
        <div
          data-testid="lesson-sources-edit-body"
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: 'var(--space-4)',
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
            }}
          >
            <SourcesField
              sources={draft}
              onChange={onDraftChange}
              label="Lesson-level sources"
              testId="lesson-sources-field"
            />
          </div>
          {saveError && (
            <div
              data-testid="lesson-sources-save-error"
              style={{
                padding: '0 var(--space-4) var(--space-3)',
                flexShrink: 0,
              }}
            >
              <Callout tone="danger" title="Save failed">
                {saveError}
              </Callout>
            </div>
          )}
          <div
            data-testid="lesson-sources-edit-footer"
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              borderTop: '1px solid var(--border)',
              background: 'var(--bg-subtle)',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              data-testid="lesson-sources-cancel"
              onClick={onCloseEdit}
              disabled={saving}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 32,
                padding: '0 var(--space-4)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--fs-sm)',
                fontWeight: 500,
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid transparent',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
              aria-label="Close edit mode"
            >
              Close
            </button>
            <button
              type="button"
              data-testid="lesson-sources-save"
              onClick={onSave}
              disabled={saveDisabled || saving}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 32,
                padding: '0 var(--space-4)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--fs-sm)',
                fontWeight: 500,
                background:
                  saveDisabled || saving ? 'var(--bg-active)' : 'var(--accent)',
                color:
                  saveDisabled || saving
                    ? 'var(--text-tertiary)'
                    : 'var(--text-on-accent)',
                border: '1px solid transparent',
                cursor: saveDisabled || saving ? 'not-allowed' : 'pointer',
                opacity: saveDisabled || saving ? 0.7 : 1,
              }}
              aria-label="Save changes"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : list.length === 0 ? (
        <div
          data-testid="lesson-sources-empty"
          style={{
            padding: 'var(--space-4)',
            fontSize: 'var(--fs-sm)',
            color: 'var(--text-tertiary)',
          }}
        >
          No sources yet.
        </div>
      ) : (
        <div
          data-testid="lesson-sources-readonly-list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-4) var(--space-4)',
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
          }}
        >
          {list.map((source, i) => (
            <SourceCard
              key={`${source.url}-${i}`}
              source={source}
              testId="lesson-sources-readonly-card"
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface ToolbarProps {
  course: Course | null;
  lesson: Lesson | null;
  moduleTitle: string;
  slug: string;
  sectionTotals: { total: number; done: number };
  onResetSession: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}

function Toolbar({
  course,
  lesson,
  moduleTitle,
  slug,
  sectionTotals,
  onResetSession,
  chatOpen,
  onToggleChat,
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

      <SettingsMenu
        courseSlug={slug}
        courseDefaultAccent={course?.accentColor}
      />

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

      <TutorToolbarButton
        chatOpen={chatOpen}
        onToggleChat={onToggleChat}
      />

      <AvatarMenu />
    </header>
  );
}

function TutorToolbarButton({
  chatOpen,
  onToggleChat,
}: {
  chatOpen: boolean;
  onToggleChat: () => void;
}) {
  const isMac = useIsMacPlatform();
  return (
    <ToolbarIconBtn
      testId="tutor-btn"
      ariaLabel={chatOpen ? 'Close AI tutor' : 'Open AI tutor'}
      onClick={onToggleChat}
      active={chatOpen}
    >
      <span
        data-testid="tutor-btn-shortcut"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.02em',
        }}
      >
        {keyLabel('ctrl', isMac)}
        {isMac ? 'Q' : '+Q'}
      </span>
    </ToolbarIconBtn>
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
        role="status"
        aria-live="polite"
        aria-label={`${done} of ${total} completed`}
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
  active,
  onClick,
}: {
  children: React.ReactNode;
  testId: string;
  ariaLabel: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  let color: string;
  let background: string;
  let borderColor: string;
  if (disabled) {
    color = 'var(--text-quaternary)';
    background = 'transparent';
    borderColor = 'transparent';
  } else if (active) {
    color = 'var(--accent-text)';
    background = 'var(--accent-subtle)';
    borderColor = 'var(--accent-subtle)';
  } else {
    color = 'var(--text-secondary)';
    background = 'transparent';
    borderColor = 'transparent';
  }
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      aria-pressed={active ? true : undefined}
      data-active={active ? 'true' : undefined}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--radius-md)',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor,
        background,
        color,
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
  regenSectionId: string | null;
  onToggleRegen: (sectionId: string) => void;
  onCloseRegen: () => void;
  onAcceptRegen: (sectionId: string, newSection: Section) => Promise<void>;
  onOpenLessonSources: () => void;
  onOpenRegenLesson: () => void;
  onExportPdf: () => void;
  undoBannerVisible: boolean;
  undoBannerFading: boolean;
  undoBannerError: string | null;
  onUndoRegenLesson: () => void;
  onDismissUndoBanner: () => void;
  onToggleSectionManualComplete: (sectionId: string, nextValue: boolean) => void;
  autoDone: Record<string, boolean>;
  onSectionAutoComplete: (sectionId: string) => void;
  onCacheVideoTranscript: (sectionId: string, segments: VideoTranscriptSegment[]) => Promise<void>;
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
  regenSectionId,
  onToggleRegen,
  onCloseRegen,
  onAcceptRegen,
  onOpenLessonSources,
  onOpenRegenLesson,
  onExportPdf,
  undoBannerVisible,
  undoBannerFading,
  undoBannerError,
  onUndoRegenLesson,
  onDismissUndoBanner,
  onToggleSectionManualComplete,
  autoDone,
  onSectionAutoComplete,
  onCacheVideoTranscript,
}: LessonStreamProps) {
  const sectionState =
    progress?.courses?.[slug]?.lessons?.[lessonSlug]?.sectionState ?? {};
  const manuallyCompleted =
    progress?.courses?.[slug]?.lessons?.[lessonSlug]
      ?.manuallyCompletedSections ?? {};

  // `autoDone` and `onSectionAutoComplete` are owned by the parent so the
  // page can compute lesson-level completion for the US-067 auto-advance.
  const markSectionDone = onSectionAutoComplete;

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
        width: '100%',
        margin: '0 auto',
        paddingLeft: 'calc(var(--space-8) * 2)',
        paddingRight: 'calc(var(--space-8) * 2)',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-section)',
      }}
    >
      {undoBannerVisible && (
        <UndoRegenBanner
          fading={undoBannerFading}
          errorMessage={undoBannerError}
          onUndo={onUndoRegenLesson}
          onDismiss={onDismissUndoBanner}
        />
      )}
      <LessonHeader
        moduleN={moduleN}
        lessonM={lessonM}
        title={lesson.title}
        description={lesson.description}
        sourcesCount={lesson.sources?.length ?? 0}
        onOpenLessonSources={onOpenLessonSources}
        onOpenRegenLesson={onOpenRegenLesson}
        onExportPdf={onExportPdf}
      />
      {lesson.sections.map((section, idx) => {
        const persistedDone = sectionState[section.id]?.done === true;
        const live = autoDone[section.id] === true;
        const manuallyDone = manuallyCompleted[section.id] === true;
        const status: WidgetStatus =
          persistedDone || live || manuallyDone ? 'done' : 'todo';
        return (
          <SectionRenderer
            key={section.id}
            section={section}
            sectionNumber={idx + 1}
            status={status}
            alreadyCompleted={persistedDone}
            manuallyCompleted={manuallyDone}
            initialUserCode={sectionState[section.id]?.userCode}
            courseSlug={slug}
            lessonSlug={lessonSlug}
            onComplete={() => markSectionDone(section.id)}
            onToggleManualComplete={(next) =>
              onToggleSectionManualComplete(section.id, next)
            }
            editing={editingSections[section.id] === true}
            onToggleEdit={onToggleEdit}
            onSaveTheory={onSaveTheory}
            panelOpen={panelSectionId === section.id}
            onOpenPanel={onOpenPanel}
            regenOpen={regenSectionId === section.id}
            onToggleRegen={onToggleRegen}
            onCloseRegen={onCloseRegen}
            onAcceptRegen={onAcceptRegen}
            onCacheVideoTranscript={onCacheVideoTranscript}
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
  onOpenRegenLesson,
  onExportPdf,
}: {
  moduleN: number;
  lessonM: number;
  title: string;
  description: string;
  sourcesCount: number;
  onOpenLessonSources: () => void;
  onOpenRegenLesson: () => void;
  onExportPdf: () => void;
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
        <button
          type="button"
          data-testid="regen-lesson-btn"
          onClick={onOpenRegenLesson}
          aria-label="Regenerate lesson"
          title="Regenerate lesson"
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
          <Sparkles size={14} aria-hidden />
          Regenerate lesson
        </button>
        <button
          type="button"
          data-testid="export-lesson-pdf-btn"
          onClick={onExportPdf}
          aria-label="Print to PDF"
          title="Print to PDF"
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
          <Printer size={14} aria-hidden />
          Print to PDF
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
  /** True if the section was already done before this mount (suppresses confetti). */
  alreadyCompleted: boolean;
  /** True if the learner manually marked this section complete via the header checkbox (US-065). */
  manuallyCompleted: boolean;
  initialUserCode?: string;
  courseSlug: string;
  lessonSlug: string;
  onComplete: () => void;
  onToggleManualComplete: (nextValue: boolean) => void;
  editing: boolean;
  onToggleEdit: (sectionId: string) => void;
  onSaveTheory: (sectionId: string, nextMarkdown: string) => Promise<void>;
  panelOpen: boolean;
  onOpenPanel: (sectionId: string) => void;
  regenOpen: boolean;
  onToggleRegen: (sectionId: string) => void;
  onCloseRegen: () => void;
  onAcceptRegen: (sectionId: string, newSection: Section) => Promise<void>;
  onCacheVideoTranscript: (sectionId: string, segments: VideoTranscriptSegment[]) => Promise<void>;
}

function SectionRenderer({
  section,
  sectionNumber,
  status,
  alreadyCompleted,
  manuallyCompleted,
  initialUserCode,
  courseSlug,
  lessonSlug,
  onComplete,
  onToggleManualComplete,
  editing,
  onToggleEdit,
  onSaveTheory,
  panelOpen,
  onOpenPanel,
  regenOpen,
  onToggleRegen,
  onCloseRegen,
  onAcceptRegen,
  onCacheVideoTranscript,
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
    body = (
      <QuizWidget
        data={section.data}
        onCorrect={onComplete}
        alreadyCompleted={alreadyCompleted}
        progressKey={progressKey}
      />
    );
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
        alreadyCompleted={alreadyCompleted}
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
  } else if (section.type === 'dataTable') {
    const Body = widgetRegistry.dataTable.component;
    body = <Body data={section.data} />;
    pencilNode = pencilButton(
      panelOpen,
      panelOpen ? 'Close edit' : 'Edit data table',
      () => onOpenPanel(section.id),
      'data-table-edit-btn',
    );
  } else if (section.type === 'video') {
    body = (
      <VideoWidget
        data={section.data}
        onTranscriptFetched={(segments) =>
          void onCacheVideoTranscript(section.id, segments)
        }
      />
    );
    pencilNode = pencilButton(
      panelOpen,
      panelOpen ? 'Close edit' : 'Edit video',
      () => onOpenPanel(section.id),
      'video-edit-btn',
    );
  } else if (section.type === 'audioPlayer') {
    body = <AudioPlayerWidget data={section.data} courseSlug={courseSlug} />;
    pencilNode = pencilButton(
      panelOpen,
      panelOpen ? 'Close edit' : 'Edit audio player',
      () => onOpenPanel(section.id),
      'audio-player-edit-btn',
    );
  } else if (section.type === 'transcriptCloze') {
    body = (
      <TranscriptClozeWidget
        data={section.data}
        courseSlug={courseSlug}
        progressKey={progressKey}
        onComplete={onComplete}
      />
    );
    pencilNode = pencilButton(
      panelOpen,
      panelOpen ? 'Close edit' : 'Edit transcript cloze',
      () => onOpenPanel(section.id),
      'transcript-cloze-edit-btn',
    );
  } else if (section.type === 'sttDemo') {
    body = <SttDemoWidget data={section.data} />;
    pencilNode = pencilButton(
      panelOpen,
      panelOpen ? 'Close edit' : 'Edit STT demo',
      () => onOpenPanel(section.id),
      'stt-demo-edit-btn',
    );
  } else if (section.type === 'ttsDemo') {
    body = <TtsDemoWidget data={section.data} />;
    pencilNode = pencilButton(
      panelOpen,
      panelOpen ? 'Close edit' : 'Edit TTS demo',
      () => onOpenPanel(section.id),
      'tts-demo-edit-btn',
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

  const regenNode: ReactNode = (
    <SectionRegenAnchor
      section={section}
      open={regenOpen}
      courseSlug={courseSlug}
      lessonSlug={lessonSlug}
      onToggle={() => onToggleRegen(section.id)}
      onClose={onCloseRegen}
      onAccept={(newSection) => onAcceptRegen(section.id, newSection)}
    />
  );

  const headerActions: ReactNode = (
    <>
      {sourcesNode}
      {regenNode}
      {pencilNode}
    </>
  );

  return (
    <div
      id={`section-${section.id}`}
      data-section-id={section.id}
      data-section-type={section.type}
      data-section-editing={editing || panelOpen ? 'true' : 'false'}
      data-section-regen-open={regenOpen ? 'true' : 'false'}
      data-section-manually-completed={manuallyCompleted ? 'true' : 'false'}
      style={
        manuallyCompleted
          ? { opacity: 0.65, transition: 'opacity 0.15s ease-out' }
          : { transition: 'opacity 0.15s ease-out' }
      }
    >
      <Widget
        type={section.type as WidgetType}
        sectionNumber={sectionNumber}
        title={section.title}
        description={section.description}
        status={status}
        headerActions={headerActions}
        checkbox={{
          completed: status === 'done',
          onToggle: onToggleManualComplete,
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

interface SectionRegenAnchorProps {
  section: Section;
  open: boolean;
  courseSlug: string;
  lessonSlug: string;
  onToggle: () => void;
  onClose: () => void;
  onAccept: (newSection: Section) => Promise<void>;
}

function SectionRegenAnchor({
  section,
  open,
  courseSlug,
  lessonSlug,
  onToggle,
  onClose,
  onAccept,
}: SectionRegenAnchorProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const testId = `regen-section-btn-${section.id}`;
  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative', display: 'inline-flex' }}
    >
      <button
        type="button"
        data-testid={testId}
        aria-label={open ? 'Close regenerate' : 'Regenerate section'}
        aria-pressed={open}
        onClick={onToggle}
        title="Regenerate section"
        style={{
          width: 28,
          height: 28,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid transparent',
          background: open ? 'var(--bg-active)' : 'transparent',
          color: open ? 'var(--text)' : 'var(--text-tertiary)',
          cursor: 'pointer',
        }}
      >
        <Sparkles size={14} strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <SectionRegenPopover
          section={section}
          courseSlug={courseSlug}
          lessonSlug={lessonSlug}
          onClose={onClose}
          onAccept={onAccept}
        />
      )}
    </div>
  );
}

interface SectionRegenPopoverProps {
  section: Section;
  courseSlug: string;
  lessonSlug: string;
  onClose: () => void;
  onAccept: (newSection: Section) => Promise<void>;
}

const QUICK_PICKS: ReadonlyArray<string> = [
  'More code-focused',
  'Shorter',
  'Add a comparison',
];

function statusToErrorMessage(status: number): string {
  if (status === 422) return 'Regeneration failed — try a different instruction.';
  if (status === 409) return 'Cannot regenerate while generation is active.';
  return 'Server error — please try again.';
}

function SectionRegenPopover({
  section,
  courseSlug,
  lessonSlug,
  onClose,
  onAccept,
}: SectionRegenPopoverProps) {
  const [instruction, setInstruction] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Section | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    const trimmed = instruction.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/courses/${courseSlug}/lessons/${lessonSlug}/sections/${section.id}/regenerate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction: trimmed }),
        },
      );
      if (!res.ok) {
        setErrorMessage(statusToErrorMessage(res.status));
        setSubmitting(false);
        return;
      }
      const body = (await res.json()) as { newSection: Section };
      setProposal(body.newSection);
      setSubmitting(false);
    } catch {
      setErrorMessage('Server error — please try again.');
      setSubmitting(false);
    }
  }, [instruction, submitting, courseSlug, lessonSlug, section.id]);

  const handleAccept = useCallback(async () => {
    if (!proposal || accepting) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      await onAccept(proposal);
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : String(err));
      setAccepting(false);
    }
  }, [proposal, accepting, onAccept]);

  const handleReject = useCallback(() => {
    setProposal(null);
    onClose();
  }, [onClose]);

  return (
    <div
      data-testid={`regen-popover-${section.id}`}
      role="dialog"
      aria-label={`Regenerate "${section.title}"`}
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: 6,
        width: 480,
        maxHeight: '70vh',
        overflowY: 'auto',
        zIndex: 30,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md, 0 12px 32px rgba(0,0,0,0.18))',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {!proposal ? (
        <>
          <div
            style={{
              fontSize: 'var(--fs-sm)',
              fontWeight: 600,
              color: 'var(--text)',
            }}
          >
            Regenerate this section
          </div>
          <label
            htmlFor={`regen-textarea-${section.id}`}
            style={{
              fontSize: 'var(--fs-xs)',
              color: 'var(--text-secondary)',
            }}
          >
            How should this section change?
          </label>
          <textarea
            id={`regen-textarea-${section.id}`}
            data-testid={`regen-textarea-${section.id}`}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={submitting}
            rows={4}
            placeholder="e.g. add a comparison with linear regression"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 10px',
              fontSize: 'var(--fs-sm)',
              fontFamily: 'var(--font-sans)',
              color: 'var(--text)',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              resize: 'vertical',
            }}
          />
          <div
            data-testid="regen-quick-picks"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
          >
            {QUICK_PICKS.map((label) => (
              <button
                key={label}
                type="button"
                data-testid={`regen-chip-${label.toLowerCase().replace(/\s+/g, '-')}`}
                onClick={() => setInstruction(label)}
                disabled={submitting}
                style={{
                  fontSize: 'var(--fs-xs)',
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-subtle)',
                  color: 'var(--text-secondary)',
                  cursor: submitting ? 'default' : 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {errorMessage && (
            <div
              data-testid="regen-error"
              role="alert"
              style={{
                fontSize: 'var(--fs-xs)',
                color: 'var(--danger-text, #b91c1c)',
                background: 'var(--danger-soft, rgba(239, 68, 68, 0.08))',
                border: '1px solid var(--danger-border, rgba(239, 68, 68, 0.3))',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {errorMessage}
            </div>
          )}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--space-2)',
            }}
          >
            <button
              type="button"
              data-testid="regen-cancel-btn"
              onClick={onClose}
              disabled={submitting}
              style={{
                fontSize: 'var(--fs-sm)',
                padding: '6px 12px',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
                cursor: submitting ? 'default' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="regen-submit-btn"
              onClick={() => void handleSubmit()}
              disabled={submitting || instruction.trim().length === 0}
              style={{
                fontSize: 'var(--fs-sm)',
                padding: '6px 12px',
                background: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--accent-on)',
                cursor:
                  submitting || instruction.trim().length === 0
                    ? 'default'
                    : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                opacity:
                  submitting || instruction.trim().length === 0 ? 0.7 : 1,
              }}
            >
              {submitting ? (
                <>
                  <Loader2
                    size={14}
                    aria-hidden
                    data-testid="regen-spinner"
                    style={{ animation: 'spin 1s linear infinite' }}
                  />
                  Regenerating…
                </>
              ) : (
                'Submit'
              )}
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              fontSize: 'var(--fs-sm)',
              fontWeight: 600,
              color: 'var(--text)',
            }}
          >
            Preview — additions highlighted
          </div>
          <div
            data-testid={`regen-preview-${section.id}`}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-3)',
              background: 'var(--bg)',
              fontSize: 'var(--fs-sm)',
              color: 'var(--text)',
              maxHeight: '40vh',
              overflowY: 'auto',
            }}
          >
            <SectionDiffPreview oldSection={section} newSection={proposal} />
          </div>
          {acceptError && (
            <div
              data-testid="regen-accept-error"
              role="alert"
              style={{
                fontSize: 'var(--fs-xs)',
                color: 'var(--danger-text, #b91c1c)',
                background: 'var(--danger-soft, rgba(239, 68, 68, 0.08))',
                border: '1px solid var(--danger-border, rgba(239, 68, 68, 0.3))',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {acceptError}
            </div>
          )}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--space-2)',
            }}
          >
            <button
              type="button"
              data-testid="regen-reject-btn"
              onClick={handleReject}
              disabled={accepting}
              style={{
                fontSize: 'var(--fs-sm)',
                padding: '6px 12px',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
                cursor: accepting ? 'default' : 'pointer',
              }}
            >
              Reject
            </button>
            <button
              type="button"
              data-testid="regen-accept-btn"
              onClick={() => void handleAccept()}
              disabled={accepting}
              style={{
                fontSize: 'var(--fs-sm)',
                padding: '6px 12px',
                background: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--accent-on)',
                cursor: accepting ? 'default' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                opacity: accepting ? 0.7 : 1,
              }}
            >
              {accepting ? (
                <>
                  <Loader2
                    size={14}
                    aria-hidden
                    style={{ animation: 'spin 1s linear infinite' }}
                  />
                  Applying…
                </>
              ) : (
                'Accept'
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const REGEN_MARK_STYLE: CSSProperties = {
  background: 'var(--accent-soft, var(--accent-subtle))',
  borderBottom: '2px solid var(--accent)',
  padding: '0 1px',
  borderRadius: 2,
  color: 'var(--text)',
};

function renderDiffParts(parts: DiffPart[]): ReactNode {
  return parts.map((p, i) => {
    if (p.type === 'removed') return null;
    if (p.type === 'added') {
      return (
        <mark
          key={i}
          data-regen-added
          style={REGEN_MARK_STYLE}
        >
          {p.text}
        </mark>
      );
    }
    return <span key={i}>{p.text}</span>;
  });
}

interface SectionDiffPreviewProps {
  oldSection: Section;
  newSection: Section;
}

function SectionDiffPreview({ oldSection, newSection }: SectionDiffPreviewProps) {
  const titleParts = useMemo(
    () => diffWords(oldSection.title, newSection.title),
    [oldSection.title, newSection.title],
  );
  const descParts = useMemo(
    () =>
      diffWords(oldSection.description ?? '', newSection.description ?? ''),
    [oldSection.description, newSection.description],
  );
  return (
    <div
      data-testid="regen-section-preview"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
    >
      <div
        style={{
          fontSize: 'var(--fs-md)',
          fontWeight: 600,
          color: 'var(--text)',
          lineHeight: 1.3,
        }}
      >
        {renderDiffParts(titleParts)}
      </div>
      {newSection.description ? (
        <div
          style={{
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}
        >
          {renderDiffParts(descParts)}
        </div>
      ) : null}
      <SectionDiffBody oldSection={oldSection} newSection={newSection} />
    </div>
  );
}

function SectionDiffBody({
  oldSection,
  newSection,
}: SectionDiffPreviewProps) {
  if (newSection.type === 'theory' && oldSection.type === 'theory') {
    return <TheoryDiffBody oldText={oldSection.data.markdown} newText={newSection.data.markdown} />;
  }
  if (newSection.type === 'quiz' && oldSection.type === 'quiz') {
    return <QuizDiffBody oldData={oldSection.data} newData={newSection.data} />;
  }
  if (newSection.type === 'code' && oldSection.type === 'code') {
    return (
      <CodeDiffBody
        oldDescription={oldSection.data.taskMarkdown ?? ''}
        newDescription={newSection.data.taskMarkdown ?? ''}
        oldStarter={oldSection.data.starterCode ?? ''}
        newStarter={newSection.data.starterCode ?? ''}
      />
    );
  }
  return <GenericDiffBody oldSection={oldSection} newSection={newSection} />;
}

function TheoryDiffBody({
  oldText,
  newText,
}: {
  oldText: string;
  newText: string;
}) {
  const parts = useMemo(() => diffWords(oldText, newText), [oldText, newText]);
  return (
    <div
      data-testid="regen-preview-theory"
      style={{
        whiteSpace: 'pre-wrap',
        fontSize: 'var(--fs-sm)',
        lineHeight: 1.6,
        color: 'var(--text)',
        fontFamily: 'var(--font-prose, var(--font-sans))',
      }}
    >
      {renderDiffParts(parts)}
    </div>
  );
}

interface QuizDiffData {
  question: string;
  options: string[];
}

function QuizDiffBody({
  oldData,
  newData,
}: {
  oldData: QuizDiffData;
  newData: QuizDiffData;
}) {
  const questionParts = useMemo(
    () => diffWords(oldData.question, newData.question),
    [oldData.question, newData.question],
  );
  const oldOptions = oldData.options;
  const newOptions = newData.options;
  return (
    <div
      data-testid="regen-preview-quiz"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 500 }}>
        {renderDiffParts(questionParts)}
      </div>
      <ol
        style={{
          margin: 0,
          paddingLeft: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {newOptions.map((opt, idx) => {
          const oldOpt = oldOptions[idx];
          const isAdded = oldOpt === undefined;
          const isChanged = !isAdded && oldOpt !== opt;
          const optParts = diffWords(oldOpt ?? '', opt);
          return (
            <li
              key={idx}
              data-testid={`regen-preview-quiz-option-${idx}`}
              data-regen-state={isAdded ? 'added' : isChanged ? 'changed' : 'same'}
              style={{
                fontSize: 'var(--fs-sm)',
                lineHeight: 1.5,
                ...(isAdded
                  ? {
                      background: 'var(--accent-soft, var(--accent-subtle))',
                      borderRadius: 4,
                      padding: '2px 6px',
                    }
                  : isChanged
                    ? {
                        borderLeft: '2px solid var(--accent)',
                        paddingLeft: 6,
                      }
                    : null),
              }}
            >
              {isAdded ? opt : renderDiffParts(optParts)}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CodeDiffBody({
  oldDescription,
  newDescription,
  oldStarter,
  newStarter,
}: {
  oldDescription: string;
  newDescription: string;
  oldStarter: string;
  newStarter: string;
}) {
  const descParts = useMemo(
    () => diffWords(oldDescription, newDescription),
    [oldDescription, newDescription],
  );
  const starterParts = useMemo(
    () => diffWords(oldStarter, newStarter),
    [oldStarter, newStarter],
  );
  return (
    <div
      data-testid="regen-preview-code"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {newDescription && (
        <div
          style={{
            fontSize: 'var(--fs-sm)',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}
        >
          {renderDiffParts(descParts)}
        </div>
      )}
      {newStarter && (
        <pre
          style={{
            margin: 0,
            padding: 8,
            background: 'var(--bg-subtle)',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-xs)',
            whiteSpace: 'pre-wrap',
            overflowX: 'auto',
          }}
        >
          {renderDiffParts(starterParts)}
        </pre>
      )}
    </div>
  );
}

function GenericDiffBody({
  oldSection,
  newSection,
}: {
  oldSection: Section;
  newSection: Section;
}) {
  const oldText = useMemo(
    () => JSON.stringify(oldSection.data ?? {}, null, 2),
    [oldSection],
  );
  const newText = useMemo(
    () => JSON.stringify(newSection.data ?? {}, null, 2),
    [newSection],
  );
  const parts = useMemo(() => diffWords(oldText, newText), [oldText, newText]);
  return (
    <pre
      data-testid="regen-preview-generic"
      style={{
        margin: 0,
        padding: 8,
        background: 'var(--bg-subtle)',
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-xs)',
        whiteSpace: 'pre-wrap',
        overflowX: 'auto',
      }}
    >
      {renderDiffParts(parts)}
    </pre>
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

interface RegenLessonDialogProps {
  open: boolean;
  lessonTitle: string;
  instruction: string;
  onInstructionChange: (next: string) => void;
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}

function RegenLessonDialog({
  open,
  lessonTitle,
  instruction,
  onInstructionChange,
  submitting,
  errorMessage,
  onSubmit,
  onCancel,
}: RegenLessonDialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onCancel]);

  if (!open) return null;

  const trimmedLen = instruction.trim().length;
  const submitDisabled = submitting || trimmedLen < 1 || trimmedLen > 2000;

  return (
    <div
      data-testid="regen-lesson-dialog-backdrop"
      role="presentation"
      onClick={() => {
        if (!submitting) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        paddingLeft: 16,
        paddingRight: 16,
        zIndex: 1000,
      }}
    >
      <div
        data-testid="regen-lesson-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="regen-lesson-dialog-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 520,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
          color: 'var(--text)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <h2
            id="regen-lesson-dialog-title"
            style={{
              margin: 0,
              fontSize: 'var(--fs-md)',
              fontWeight: 600,
              letterSpacing: '-0.005em',
              color: 'var(--text)',
            }}
          >
            Regenerate &quot;{lessonTitle}&quot;
          </h2>
        </header>
        <div
          style={{
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <p
            data-testid="regen-lesson-dialog-body"
            style={{
              margin: 0,
              fontSize: 'var(--fs-sm)',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}
          >
            This replaces the entire lesson with a freshly generated version. The
            previous version is kept as a one-step Undo while you stay on this
            page.
          </p>
          <label
            htmlFor="regen-lesson-instruction"
            style={{
              fontSize: 'var(--fs-sm)',
              fontWeight: 500,
              color: 'var(--text)',
            }}
          >
            How should this lesson change?
          </label>
          <textarea
            id="regen-lesson-instruction"
            data-testid="regen-lesson-instruction"
            value={instruction}
            onChange={(e) => onInstructionChange(e.target.value)}
            disabled={submitting}
            rows={5}
            maxLength={2000}
            style={{
              width: '100%',
              minHeight: 96,
              maxHeight: 240,
              resize: 'vertical',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-sm)',
              lineHeight: 1.5,
              color: 'var(--text)',
              background: 'var(--bg)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-md)',
              padding: '8px 12px',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
          {errorMessage && (
            <div
              data-testid="regen-lesson-error"
              role="alert"
              style={{
                fontSize: 'var(--fs-sm)',
                color: 'var(--danger-text, var(--danger))',
                background: 'var(--danger-subtle, transparent)',
                border: '1px solid var(--danger, var(--border-strong))',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 10px',
              }}
            >
              {errorMessage}
            </div>
          )}
        </div>
        <footer
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-subtle)',
          }}
        >
          <button
            type="button"
            data-testid="regen-lesson-cancel"
            onClick={onCancel}
            disabled={submitting}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 32,
              padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-sm)',
              fontWeight: 500,
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid transparent',
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="regen-lesson-submit"
            onClick={onSubmit}
            disabled={submitDisabled}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 32,
              padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-sm)',
              fontWeight: 500,
              background: submitDisabled ? 'var(--bg-active)' : 'var(--accent)',
              color: submitDisabled
                ? 'var(--text-tertiary)'
                : 'var(--text-on-accent)',
              border: '1px solid transparent',
              cursor: submitDisabled ? 'not-allowed' : 'pointer',
              opacity: submitDisabled ? 0.7 : 1,
            }}
          >
            {submitting && (
              <Loader2
                size={14}
                aria-hidden
                style={{ animation: 'spin 1s linear infinite' }}
              />
            )}
            {submitting ? 'Regenerating…' : 'Submit'}
          </button>
        </footer>
      </div>
    </div>
  );
}

interface UndoRegenBannerProps {
  fading: boolean;
  errorMessage: string | null;
  onUndo: () => void;
  onDismiss: () => void;
}

function UndoRegenBanner({
  fading,
  errorMessage,
  onUndo,
  onDismiss,
}: UndoRegenBannerProps) {
  return (
    <div
      data-testid="undo-regen-lesson-banner"
      data-fading={fading ? 'true' : 'false'}
      role="status"
      aria-live="polite"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: '8px 14px',
        background: 'var(--accent-subtle, var(--bg-elevated))',
        border: '1px solid var(--accent, var(--border-strong))',
        borderRadius: 'var(--radius-md)',
        color: 'var(--text)',
        fontSize: 'var(--fs-sm)',
        opacity: fading ? 0 : 1,
        transition: 'opacity 200ms ease',
      }}
    >
      <span style={{ flex: 1 }}>
        {errorMessage ?? 'Lesson regenerated.'}
      </span>
      {!errorMessage && (
        <button
          type="button"
          data-testid="undo-regen-lesson-btn"
          onClick={onUndo}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 28,
            padding: '0 12px',
            background: 'var(--accent)',
            color: 'var(--text-on-accent)',
            border: '1px solid transparent',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-sm)',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Undo
        </button>
      )}
      <button
        type="button"
        data-testid="undo-regen-lesson-dismiss"
        aria-label="Dismiss banner"
        onClick={onDismiss}
        style={{
          width: 24,
          height: 24,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  );
}
