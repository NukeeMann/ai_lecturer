'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Plus, RotateCcw, Sparkles, X } from 'lucide-react';

import { AppLogoLink } from '@/components/AppLogo';
import { SettingsMenu } from '@/components/SettingsMenu';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { Course, LessonRef, Module } from '@/lib/schemas/course';
import { slugify } from '@/lib/slugify';

type DialogState =
  | { kind: 'module' }
  | { kind: 'lesson'; moduleId: string; moduleTitle: string };

// US-180 — the agent roundtrip is gone, so the additions list is owned
// fully by this component. `lessonSlug` is preserved so `firstNewLessonSlug`
// (Done — open course link) keeps working.
type NewLessonAddition = {
  moduleId: string;
  lessonSlug: string;
  title: string;
  estimatedMinutes: number;
};

type Additions = {
  newModuleIds: string[];
  newLessonIds: NewLessonAddition[];
};

// US-172 — two top-level view modes inside the wizard shell. The progress
// view replaces the schema tree once `Generate additions` has been clicked
// and /apply returned the enqueued lesson slugs. We deliberately don't
// route away so the breadcrumb/header stays continuous.
type View = 'edit' | 'progress';

type LessonProgressStatus = 'pending' | 'inflight' | 'done' | 'failed';

interface ActiveRunProgressLessonResp {
  slug: string;
  title: string;
  status: LessonProgressStatus;
}

interface ActiveRunProgressResp {
  initStatus: 'pending' | 'done' | 'failed';
  lessonsDone: number;
  lessonsTotal: number;
  currentLessonSlug: string | null;
  lessons: ActiveRunProgressLessonResp[];
}

type ActiveRunResponse =
  | { active: false; queue: unknown[] }
  | {
      active: true;
      slug: string;
      name: string;
      stage: string;
      queue: unknown[];
      progress?: ActiveRunProgressResp;
    };

export default function ExtendWizardClient({
  course,
  initialGenerationActive = false,
}: {
  course: Course;
  initialGenerationActive?: boolean;
}) {
  const [currentProposed, setCurrentProposed] = useState<Course>(course);
  const [additions, setAdditions] = useState<Additions>({
    newModuleIds: [],
    newLessonIds: [],
  });
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [summaryDraft, setSummaryDraft] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<View>('edit');
  const [applying, setApplying] = useState(false);
  const [enqueuedLessonSlugs, setEnqueuedLessonSlugs] = useState<string[]>([]);
  const [lessonStatuses, setLessonStatuses] = useState<
    Record<string, LessonProgressStatus>
  >({});
  const [genId, setGenId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const summaryTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 4500);
  }, []);

  const newModuleIdSet = useMemo(
    () => new Set(additions.newModuleIds),
    [additions.newModuleIds],
  );
  const newLessonSlugSet = useMemo(
    () => new Set(additions.newLessonIds.map((l) => l.lessonSlug)),
    [additions.newLessonIds],
  );

  const hasAdditions =
    additions.newModuleIds.length > 0 || additions.newLessonIds.length > 0;

  const readOnly = initialGenerationActive && view === 'edit';

  const openModuleDialog = useCallback(() => {
    if (readOnly) return;
    setTitleDraft('');
    setSummaryDraft('');
    setDialogError(null);
    setDialog({ kind: 'module' });
  }, [readOnly]);

  const openLessonDialog = useCallback(
    (moduleId: string, moduleTitle: string) => {
      if (readOnly) return;
      setTitleDraft('');
      setSummaryDraft('');
      setDialogError(null);
      setDialog({ kind: 'lesson', moduleId, moduleTitle });
    },
    [readOnly],
  );

  const closeDialog = useCallback(() => {
    setDialog(null);
    setTitleDraft('');
    setSummaryDraft('');
    setDialogError(null);
  }, []);

  // US-180 — direct-add to currentProposed. No fetch; the form values are
  // appended locally and the dialog closes synchronously. Collisions surface
  // inline rather than via toast.
  const handleAdd = useCallback(() => {
    if (!dialog) return;
    const title = titleDraft.trim();
    if (title.length === 0) return;
    const summary = summaryDraft.trim();

    if (dialog.kind === 'module') {
      const id = slugify(title);
      const collision = currentProposed.modules.some((m) => m.id === id);
      if (collision) {
        setDialogError('A module with this id already exists.');
        return;
      }
      // ModuleSchema requires `summary: string`. We store '' when empty —
      // rendering already treats empty/missing identically, and /apply
      // accepts an empty string.
      const newModule: Module = {
        id,
        title,
        summary,
        lessons: [],
      };
      setCurrentProposed((prev) => ({
        ...prev,
        modules: [...prev.modules, newModule],
      }));
      setAdditions((prev) => ({
        newModuleIds: [...prev.newModuleIds, id],
        newLessonIds: prev.newLessonIds,
      }));
      closeDialog();
      return;
    }

    // Lesson branch.
    const slug = slugify(title);
    const parent = currentProposed.modules.find(
      (m) => m.id === dialog.moduleId,
    );
    if (parent && parent.lessons.some((l) => l.slug === slug)) {
      setDialogError('A lesson with this slug already exists in this module.');
      return;
    }
    // LessonRef.summary is optional — omit when empty.
    const newLesson: LessonRef = {
      slug,
      title,
      estimatedMinutes: 15,
      ...(summary.length > 0 ? { summary } : {}),
    };
    const moduleId = dialog.moduleId;
    setCurrentProposed((prev) => ({
      ...prev,
      modules: prev.modules.map((m) =>
        m.id === moduleId
          ? { ...m, lessons: [...m.lessons, newLesson] }
          : m,
      ),
    }));
    setAdditions((prev) => ({
      newModuleIds: prev.newModuleIds,
      newLessonIds: [
        ...prev.newLessonIds,
        { moduleId, lessonSlug: slug, title, estimatedMinutes: 15 },
      ],
    }));
    closeDialog();
  }, [closeDialog, currentProposed, dialog, summaryDraft, titleDraft]);

  const handleReset = useCallback(() => {
    if (readOnly) return;
    if (hasAdditions) {
      const ok = window.confirm(
        'Discard all pending additions and reset the proposed schema?',
      );
      if (!ok) return;
    }
    setCurrentProposed(course);
    setAdditions({ newModuleIds: [], newLessonIds: [] });
  }, [course, hasAdditions, readOnly]);

  // US-172 — Generate additions. POST the accumulated proposedSchema to the
  // existing US-144 apply endpoint, then flip into the progress view with
  // the enqueued lesson slugs that came back.
  const handleGenerate = useCallback(async () => {
    if (applying) return;
    if (!hasAdditions) return;
    setApplying(true);
    setProgressError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.slug)}/extend/apply`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ proposedSchema: currentProposed }),
        },
      );
      if (!res.ok) {
        if (res.status === 409) {
          showToast('Cannot extend while generation is active.');
        } else {
          let detail = `Server returned ${res.status}`;
          try {
            const json = (await res.json()) as {
              error?: string;
              message?: string;
            };
            if (json.message) detail = json.message;
            else if (json.error) detail = json.error;
          } catch {
            /* non-JSON body */
          }
          showToast(detail);
        }
        return;
      }
      const data = (await res.json()) as { enqueuedLessonSlugs: string[] };
      const slugs = Array.isArray(data.enqueuedLessonSlugs)
        ? data.enqueuedLessonSlugs
        : [];
      setEnqueuedLessonSlugs(slugs);
      const initial: Record<string, LessonProgressStatus> = {};
      for (const s of slugs) initial[s] = 'pending';
      setLessonStatuses(initial);
      setView('progress');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Server error — please try again.',
      );
    } finally {
      setApplying(false);
    }
  }, [applying, course.slug, currentProposed, hasAdditions, showToast]);

  const allEnqueuedComplete = useMemo(() => {
    if (enqueuedLessonSlugs.length === 0) return false;
    return enqueuedLessonSlugs.every((s) => lessonStatuses[s] === 'done');
  }, [enqueuedLessonSlugs, lessonStatuses]);

  useEffect(() => {
    if (view !== 'progress') return;
    if (enqueuedLessonSlugs.length === 0) return;
    let cancelledLocal = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const attach = async () => {
      try {
        const res = await fetch('/api/courses/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug: course.slug }),
        });
        if (cancelledLocal || !res.ok) return;
        const body = (await res.json()) as
          | { id?: string; slug?: string }
          | { queued?: true; slug?: string };
        if ('id' in body && typeof body.id === 'string') {
          setGenId(body.id);
        }
      } catch {
        /* best-effort */
      }
    };

    const poll = async () => {
      try {
        const res = await fetch('/api/courses/active-run', { cache: 'no-store' });
        if (cancelledLocal || !res.ok) return;
        const body = (await res.json()) as ActiveRunResponse;
        if (cancelledLocal) return;
        if (!body.active || body.slug !== course.slug) {
          setLessonStatuses((prev) => {
            const next = { ...prev };
            for (const slug of enqueuedLessonSlugs) {
              if (next[slug] !== 'failed') next[slug] = 'done';
            }
            return next;
          });
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          return;
        }
        const lessons = body.progress?.lessons ?? [];
        if (lessons.length === 0) return;
        const wanted = new Set(enqueuedLessonSlugs);
        setLessonStatuses((prev) => {
          const next = { ...prev };
          for (const l of lessons) {
            if (!wanted.has(l.slug)) continue;
            next[l.slug] = l.status;
          }
          return next;
        });
      } catch {
        /* transient — try again next tick */
      }
    };

    void attach();
    void poll();
    timer = setInterval(() => void poll(), 1500);

    return () => {
      cancelledLocal = true;
      if (timer) clearInterval(timer);
    };
  }, [view, enqueuedLessonSlugs, course.slug]);

  const handleCancelGeneration = useCallback(async () => {
    if (cancelling || cancelled) return;
    setCancelling(true);
    try {
      if (genId) {
        await fetch(
          `/api/courses/generate?id=${encodeURIComponent(genId)}`,
          { method: 'DELETE' },
        );
      }
      setCancelled(true);
    } catch (err) {
      setProgressError(
        err instanceof Error ? err.message : 'Failed to cancel — try again.',
      );
    } finally {
      setCancelling(false);
    }
  }, [cancelled, cancelling, genId]);

  // Esc closes dialog. Cmd/Ctrl+Enter from anywhere in the dialog triggers
  // Add when title is non-empty (US-180 UX polish).
  useEffect(() => {
    if (!dialog) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (titleDraft.trim().length > 0) handleAdd();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, closeDialog, handleAdd, titleDraft]);

  // Autofocus the Title input when dialog opens (US-180 UX polish).
  useEffect(() => {
    if (!dialog) return;
    const t = titleInputRef.current;
    if (t) t.focus();
  }, [dialog]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const firstNewLessonSlug =
    additions.newLessonIds[0]?.lessonSlug ?? enqueuedLessonSlugs[0] ?? null;
  const doneHref = firstNewLessonSlug
    ? `/courses/${encodeURIComponent(course.slug)}/lessons/${encodeURIComponent(firstNewLessonSlug)}`
    : `/courses/${encodeURIComponent(course.slug)}`;

  const showDoneButton = cancelled || allEnqueuedComplete;

  const dialogIsLesson = dialog?.kind === 'lesson';
  const titleLabel = dialogIsLesson ? 'Lesson title' : 'Module title';
  const detailsLabel = 'Share more details:';

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div style={headerSlotStyle}>
          <AppLogoLink />
        </div>
        <div style={headerCenterStyle}>
          <Link
            href="/"
            data-testid="extend-breadcrumb"
            style={breadcrumbStyle}
          >
            <ArrowLeft size={14} strokeWidth={2} />
            <span>Back to dashboard</span>
          </Link>
        </div>
        <div style={headerRightStyle}>
          <SettingsMenu />
          <ThemeToggle />
        </div>
      </header>

      <main style={mainStyle}>
        <div style={contentWrapStyle}>
          <div
            style={{
              fontSize: 10.5,
              color: 'var(--accent-text)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            Extend course
          </div>
          <h1
            data-testid="extend-page-title"
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-2xl)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            {`Extend "${course.title}"`}
          </h1>
          <p
            style={{
              marginTop: 6,
              color: 'var(--text-secondary)',
              fontSize: 'var(--fs-sm)',
              lineHeight: 1.55,
              marginBottom: 'var(--space-6)',
            }}
          >
            {view === 'progress'
              ? 'Generation in progress. Stream of stages for the newly added lessons appears below.'
              : 'Add new modules or lessons to this course. Each addition is reflected in the schema tree below.'}
          </p>

          {readOnly && view === 'edit' && (
            <div
              data-testid="extend-readonly-banner"
              role="status"
              style={readOnlyBannerStyle}
            >
              Cannot extend while generation is active
            </div>
          )}

          {view === 'edit' ? (
            <div
              data-testid="extend-tree"
              data-readonly={readOnly ? 'true' : undefined}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-4)',
              }}
            >
              {currentProposed.modules.map((m) => {
                const moduleIsNew = newModuleIdSet.has(m.id);
                const moduleMinutes = m.lessons.reduce(
                  (ms, l) => ms + l.estimatedMinutes,
                  0,
                );
                const moduleSummary =
                  typeof m.summary === 'string' && m.summary.trim() !== ''
                    ? m.summary
                    : null;
                return (
                  <div
                    key={m.id}
                    data-testid={`extend-module-${m.id}`}
                    data-new={moduleIsNew ? 'true' : undefined}
                    style={moduleIsNew ? newModuleCardStyle : moduleCardStyle}
                  >
                    <div style={moduleHeaderSectionStyle}>
                      <div style={moduleHeaderStyle}>
                        <div
                          data-testid={`extend-module-title-${m.id}`}
                          style={moduleTitleStyle}
                        >
                          {m.title}
                        </div>
                        <span style={moduleMetaStyle}>
                          {m.lessons.length} lessons · ~{moduleMinutes} min
                        </span>
                      </div>
                      {moduleSummary && (
                        <p
                          data-testid={`extend-module-summary-${m.id}`}
                          style={summaryStyle}
                        >
                          {moduleSummary}
                        </p>
                      )}
                    </div>
                    <ul style={lessonListStyle}>
                      {m.lessons.map((l) => {
                        const lessonIsNew = newLessonSlugSet.has(l.slug);
                        const lessonSummary =
                          typeof l.summary === 'string' &&
                          l.summary.trim() !== ''
                            ? l.summary
                            : null;
                        return (
                          <li
                            key={l.slug}
                            data-testid={`extend-lesson-${l.slug}`}
                            data-new={lessonIsNew ? 'true' : undefined}
                            style={
                              lessonIsNew ? newLessonRowStyle : lessonRowStyle
                            }
                          >
                            <div style={lessonRowTopStyle}>
                              <span style={lessonTitleStyle}>{l.title}</span>
                              <span style={lessonMetaStyle}>
                                {l.estimatedMinutes} min
                              </span>
                            </div>
                            {lessonSummary && (
                              <p
                                data-testid={`extend-lesson-summary-${l.slug}`}
                                style={summaryStyle}
                              >
                                {lessonSummary}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {!readOnly && (
                      <button
                        type="button"
                        data-testid={`extend-add-lesson-${m.id}`}
                        onClick={() => openLessonDialog(m.id, m.title)}
                        style={addInlineBtnStyle}
                      >
                        <Plus size={14} strokeWidth={2} />
                        <span>{`Add lesson to ${m.title}`}</span>
                      </button>
                    )}
                  </div>
                );
              })}

              {!readOnly && (
                <button
                  type="button"
                  data-testid="extend-add-module"
                  onClick={openModuleDialog}
                  style={addBlockBtnStyle}
                >
                  <Plus size={16} strokeWidth={2} />
                  <span>Add module</span>
                </button>
              )}
            </div>
          ) : (
            <div
              data-testid="extend-progress"
              data-all-done={allEnqueuedComplete ? 'true' : undefined}
              data-cancelled={cancelled ? 'true' : undefined}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-3)',
              }}
            >
              <div style={progressHeaderStyle}>
                <span
                  data-testid="extend-progress-count"
                  style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}
                >
                  {Object.values(lessonStatuses).filter((s) => s === 'done').length}
                  {' / '}
                  {enqueuedLessonSlugs.length} lessons complete
                </span>
                {cancelled && (
                  <span
                    data-testid="extend-progress-cancelled-msg"
                    style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}
                  >
                    Cancelled — partial additions remain
                  </span>
                )}
              </div>
              <ul style={lessonListStyle}>
                {enqueuedLessonSlugs.map((slug) => {
                  const status = lessonStatuses[slug] ?? 'pending';
                  return (
                    <li
                      key={slug}
                      data-testid={`extend-progress-lesson-${slug}`}
                      data-status={status}
                      style={progressRowStyle}
                    >
                      <span style={progressIconSlotStyle}>
                        {status === 'done' ? (
                          <Check size={14} strokeWidth={2} aria-hidden />
                        ) : status === 'inflight' ? (
                          <span
                            aria-hidden
                            data-testid={`extend-progress-spinner-${slug}`}
                            style={spinnerStyle}
                          />
                        ) : status === 'failed' ? (
                          <X size={14} strokeWidth={2} aria-hidden />
                        ) : (
                          <span style={progressDotStyle} aria-hidden />
                        )}
                      </span>
                      <span style={lessonTitleStyle}>{slug}</span>
                      <span style={lessonMetaStyle}>{status}</span>
                    </li>
                  );
                })}
              </ul>
              {progressError && (
                <div
                  data-testid="extend-progress-error"
                  role="alert"
                  style={progressErrorStyle}
                >
                  {progressError}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <div style={bottomBarStyle}>
        {view === 'edit' ? (
          <>
            <div
              style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-xs)' }}
            >
              {hasAdditions
                ? `${additions.newModuleIds.length + additions.newLessonIds.length} pending ${
                    additions.newModuleIds.length + additions.newLessonIds.length === 1
                      ? 'addition'
                      : 'additions'
                  }`
                : 'Nothing pending yet.'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                data-testid="extend-reset"
                onClick={handleReset}
                disabled={readOnly || !hasAdditions}
                style={ghostBtnStyle}
              >
                <RotateCcw size={14} strokeWidth={2} />
                <span>Reset proposal</span>
              </button>
              <button
                type="button"
                data-testid="extend-generate"
                onClick={() => void handleGenerate()}
                disabled={applying || readOnly || !hasAdditions}
                title={
                  readOnly
                    ? 'Cannot extend while generation is active'
                    : !hasAdditions
                      ? 'Add at least one module or lesson first'
                      : undefined
                }
                aria-label={
                  applying ? 'Generating additions' : 'Generate additions'
                }
                style={primaryBtnStyle(applying || readOnly || !hasAdditions)}
              >
                {applying ? (
                  <>
                    <span
                      data-testid="extend-generate-spinner"
                      aria-hidden
                      style={spinnerStyle}
                    />
                    <span>Generating…</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} strokeWidth={2} />
                    <span>Generate additions</span>
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-xs)' }}
            >
              {cancelled
                ? 'Cancelled — partial additions remain'
                : allEnqueuedComplete
                  ? 'All new lessons generated.'
                  : 'Generation in progress…'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!cancelled && !allEnqueuedComplete && (
                <button
                  type="button"
                  data-testid="extend-progress-cancel"
                  onClick={() => void handleCancelGeneration()}
                  disabled={cancelling}
                  style={ghostBtnStyle}
                >
                  {cancelling ? 'Cancelling…' : 'Cancel'}
                </button>
              )}
              {showDoneButton && (
                <Link
                  href={doneHref}
                  data-testid="extend-progress-done"
                  style={{ ...primaryBtnStyle(false), textDecoration: 'none' }}
                >
                  <Check size={14} strokeWidth={2} />
                  <span>Done — open course</span>
                </Link>
              )}
            </div>
          </>
        )}
      </div>

      {toast && (
        <div
          data-testid="extend-toast"
          role="status"
          aria-live="polite"
          style={toastStyle}
        >
          {toast}
        </div>
      )}

      {dialog && (
        <div
          data-testid="extend-dialog-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDialog();
          }}
          style={backdropStyle}
        >
          <div
            data-testid="extend-dialog"
            data-kind={dialog.kind}
            role="dialog"
            aria-modal="true"
            aria-labelledby="extend-dialog-heading"
            style={dialogStyle}
          >
            <header style={dialogHeaderStyle}>
              <h2 id="extend-dialog-heading" style={dialogTitleStyle}>
                {dialog.kind === 'module'
                  ? `Add a module to "${course.title}"`
                  : `Add a lesson under "${dialog.moduleTitle}"`}
              </h2>
              <button
                type="button"
                data-testid="extend-dialog-close"
                aria-label="Close dialog"
                onClick={closeDialog}
                style={dialogCloseBtnStyle}
              >
                <X size={14} strokeWidth={2} />
              </button>
            </header>
            <div style={dialogBodyStyle}>
              <label
                htmlFor="extend-dialog-title"
                style={dialogLabelStyle}
              >
                {titleLabel}
              </label>
              <input
                id="extend-dialog-title"
                data-testid="extend-dialog-title"
                ref={titleInputRef}
                type="text"
                value={titleDraft}
                onChange={(e) => {
                  setTitleDraft(e.target.value);
                  if (dialogError) setDialogError(null);
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.metaKey &&
                    !e.ctrlKey &&
                    !e.shiftKey &&
                    !e.altKey
                  ) {
                    e.preventDefault();
                    summaryTextareaRef.current?.focus();
                  }
                }}
                placeholder='e.g., "Advanced indexing patterns"'
                maxLength={120}
                style={dialogInputStyle}
              />
              <label
                htmlFor="extend-dialog-summary"
                style={dialogLabelStyle}
              >
                {detailsLabel}
              </label>
              <textarea
                id="extend-dialog-summary"
                data-testid="extend-dialog-summary"
                ref={summaryTextareaRef}
                value={summaryDraft}
                onChange={(e) => setSummaryDraft(e.target.value)}
                placeholder="Mention topics, examples, angles, or which widgets/structure to include…"
                rows={3}
                maxLength={300}
                style={dialogTextareaStyle}
              />
              {dialogError && (
                <p
                  data-testid="extend-dialog-error"
                  role="alert"
                  style={dialogErrorStyle}
                >
                  {dialogError}
                </p>
              )}
            </div>
            <div style={dialogFooterStyle}>
              <button
                type="button"
                data-testid="extend-dialog-cancel"
                onClick={closeDialog}
                style={ghostBtnStyle}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="extend-dialog-add"
                onClick={handleAdd}
                disabled={titleDraft.trim().length === 0}
                style={primaryBtnStyle(titleDraft.trim().length === 0)}
              >
                Add
              </button>
            </div>
            <style>{`@keyframes extend-spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'var(--font-sans)',
};

const headerStyle: CSSProperties = {
  height: 64,
  flexShrink: 0,
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
  gap: 'var(--space-4)',
  padding: '0 var(--space-6)',
};

const headerSlotStyle: CSSProperties = { minWidth: 0 };

const headerCenterStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 0,
};

const headerRightStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 6,
};

const breadcrumbStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
  textDecoration: 'none',
};

const mainStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  padding: 'var(--space-7) var(--space-6)',
  overflowY: 'auto',
};

const contentWrapStyle: CSSProperties = {
  width: '100%',
  maxWidth: 720,
  marginInline: 'auto',
};

const moduleCardStyle: CSSProperties = {
  borderTopWidth: 1,
  borderRightWidth: 1,
  borderBottomWidth: 1,
  borderLeftWidth: 1,
  borderStyle: 'solid',
  borderTopColor: 'var(--border)',
  borderRightColor: 'var(--border)',
  borderBottomColor: 'var(--border)',
  borderLeftColor: 'var(--border)',
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const newModuleCardStyle: CSSProperties = {
  ...moduleCardStyle,
  background: 'var(--accent-soft, var(--accent-subtle))',
  borderLeftWidth: 3,
  borderLeftColor: 'var(--accent)',
};

const moduleHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
};

const moduleTitleStyle: CSSProperties = {
  fontSize: 'var(--fs-md)',
  fontWeight: 600,
  color: 'var(--text)',
};

const moduleMetaStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  color: 'var(--text-tertiary)',
  fontFamily: 'var(--font-mono)',
};

const lessonListStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const lessonRowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  padding: '8px 10px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  borderTopWidth: 1,
  borderRightWidth: 1,
  borderBottomWidth: 1,
  borderLeftWidth: 1,
  borderStyle: 'solid',
  borderTopColor: 'var(--border)',
  borderRightColor: 'var(--border)',
  borderBottomColor: 'var(--border)',
  borderLeftColor: 'var(--border)',
};

const lessonRowTopStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
};

const moduleHeaderSectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const summaryStyle: CSSProperties = {
  margin: '4px 0 0',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
  lineHeight: 1.4,
};

const newLessonRowStyle: CSSProperties = {
  ...lessonRowStyle,
  background: 'var(--accent-soft, var(--accent-subtle))',
  borderLeftWidth: 3,
  borderLeftColor: 'var(--accent)',
};

const lessonTitleStyle: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  color: 'var(--text)',
};

const lessonMetaStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: 'var(--fs-xs)',
  color: 'var(--text-tertiary)',
  fontFamily: 'var(--font-mono)',
};

const addInlineBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  gap: 6,
  height: 34,
  background: 'transparent',
  border: '1px dashed var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const addBlockBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  gap: 6,
  height: 44,
  background: 'transparent',
  border: '1px dashed var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const bottomBarStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  padding: 'var(--space-4) var(--space-6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const ghostBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 36,
  padding: '0 14px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  fontFamily: 'inherit',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

function primaryBtnStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: 36,
    padding: '0 18px',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    background: disabled ? 'var(--bg-active)' : 'var(--accent)',
    color: disabled ? 'var(--text-tertiary)' : 'var(--text-on-accent)',
    fontSize: 'var(--fs-sm)',
    fontWeight: 500,
    fontFamily: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
  };
}

const backdropStyle: CSSProperties = {
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
};

const dialogStyle: CSSProperties = {
  width: '100%',
  maxWidth: 520,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-xl)',
  boxShadow: 'var(--shadow-lg)',
  color: 'var(--text)',
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '76vh',
  overflow: 'hidden',
};

const dialogHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 20px',
  borderBottom: '1px solid var(--border)',
  gap: 'var(--space-3)',
};

const dialogTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-md)',
  fontWeight: 600,
  letterSpacing: '-0.005em',
  color: 'var(--text)',
};

const dialogCloseBtnStyle: CSSProperties = {
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
};

const dialogBodyStyle: CSSProperties = {
  padding: '14px 20px 4px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const dialogLabelStyle: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  color: 'var(--text-secondary)',
};

const dialogInputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.5,
};

const dialogTextareaStyle: CSSProperties = {
  width: '100%',
  resize: 'vertical',
  minHeight: 72,
  padding: '10px 12px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.5,
};

const dialogErrorStyle: CSSProperties = {
  margin: '4px 0 0',
  fontSize: 'var(--fs-sm)',
  color: 'var(--danger, var(--text))',
};

const dialogFooterStyle: CSSProperties = {
  padding: '14px 20px 20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
};

const spinnerStyle: CSSProperties = {
  width: 12,
  height: 12,
  border: '2px solid currentColor',
  borderTopColor: 'transparent',
  borderRadius: '50%',
  animation: 'extend-spin 0.8s linear infinite',
  display: 'inline-block',
};

const toastStyle: CSSProperties = {
  position: 'fixed',
  bottom: 'var(--space-6)',
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '10px 16px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--danger-subtle, var(--bg-elevated))',
  border: '1px solid var(--danger-border, var(--border))',
  color: 'var(--danger, var(--text))',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  boxShadow: 'var(--shadow-md)',
  zIndex: 1100,
  maxWidth: 480,
  textAlign: 'center',
};

const readOnlyBannerStyle: CSSProperties = {
  padding: '10px 14px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--accent-soft, var(--accent-subtle))',
  borderTopWidth: 1,
  borderRightWidth: 1,
  borderBottomWidth: 1,
  borderLeftWidth: 3,
  borderStyle: 'solid',
  borderTopColor: 'var(--border)',
  borderRightColor: 'var(--border)',
  borderBottomColor: 'var(--border)',
  borderLeftColor: 'var(--accent)',
  color: 'var(--accent-text, var(--text))',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  marginBottom: 'var(--space-5)',
};

const progressHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
};

const progressRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  padding: '10px 12px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
};

const progressIconSlotStyle: CSSProperties = {
  width: 18,
  height: 18,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-secondary)',
  flexShrink: 0,
};

const progressDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'var(--border-strong)',
};

const progressErrorStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--danger-subtle, var(--bg-elevated))',
  border: '1px solid var(--danger-border, var(--border))',
  color: 'var(--danger, var(--text))',
  fontSize: 'var(--fs-sm)',
};
