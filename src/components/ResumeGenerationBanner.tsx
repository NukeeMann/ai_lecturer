'use client';

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { AlertTriangle, ArrowRight, Sparkles, X } from 'lucide-react';

import { strings } from '@/lib/i18n/strings';

// US-106 / US-107 — shape of GET /api/courses/active-run. Queue context was
// added in US-107 so the resume banner can show "X in queue" alongside the
// active run. US-140 adds an optional per-lesson `progress` block when
// `.generation-state.json` (US-136) is on disk.
export interface QueueEntry {
  slug: string;
  name: string;
  position: number;
}

export interface ActiveRunProgressLessonResp {
  slug: string;
  title: string;
  status: 'pending' | 'inflight' | 'done' | 'failed';
}

export interface ActiveRunProgressResp {
  initStatus: 'pending' | 'done' | 'failed';
  lessonsDone: number;
  lessonsTotal: number;
  currentLessonSlug: string | null;
  lessons: ActiveRunProgressLessonResp[];
}

// Mirrors `ResumableRunEntry` from generation.ts — surfaced when the server
// finds a leftover `.generation-state.json` whose run is no longer live
// (session-limit failure, crash, power-off). The UI offers a one-click POST
// to /api/courses/<slug>/resume.
export interface ResumableRunResp {
  slug: string;
  name: string;
  lessonsDone: number;
  lessonsTotal: number;
  initStatus: 'pending' | 'done' | 'failed';
  lastUpdatedAt: string;
}

export type ActiveRunResponse =
  | { active: false; queue: QueueEntry[]; resumable?: ResumableRunResp[] }
  | {
      active: true;
      slug: string;
      name: string;
      stage: string;
      queue: QueueEntry[];
      progress?: ActiveRunProgressResp;
      resumable?: ResumableRunResp[];
    };

export interface ActiveRun {
  slug: string;
  name: string;
  stage: string;
  queueLength: number;
  progress?: ActiveRunProgressResp;
}

// US-195 — shared probe of /api/courses/active-run. Returns null while the
// initial fetch is in flight (so the host can render nothing and avoid any
// layout-shift), then populates with whatever the server reported.
export function useResumeRunData(): {
  activeRun: ActiveRun | null;
  resumableRuns: ResumableRunResp[];
  loaded: boolean;
  setActiveRun: Dispatch<SetStateAction<ActiveRun | null>>;
  setResumableRuns: Dispatch<SetStateAction<ResumableRunResp[]>>;
} {
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [resumableRuns, setResumableRuns] = useState<ResumableRunResp[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/courses/active-run', { cache: 'no-store' });
        if (cancelled || !res.ok) {
          if (!cancelled) setLoaded(true);
          return;
        }
        const body = (await res.json()) as ActiveRunResponse;
        if (cancelled) return;
        if (body && body.active === true) {
          const ql = Array.isArray(body.queue) ? body.queue.length : 0;
          setActiveRun({
            slug: body.slug,
            name: body.name,
            stage: body.stage,
            queueLength: ql,
            progress: body.progress,
          });
        } else {
          setActiveRun(null);
        }
        setResumableRuns(Array.isArray(body?.resumable) ? body.resumable! : []);
      } catch {
        /* best-effort — banner is a UX nicety */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { activeRun, resumableRuns, loaded, setActiveRun, setResumableRuns };
}

function bannerContainerStyle(sticky: boolean, kind: 'active' | 'paused'): CSSProperties {
  const base: CSSProperties = {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1)',
    padding: '10px var(--space-6)',
    fontSize: 'var(--fs-sm)',
  };
  if (kind === 'active') {
    base.background = 'var(--accent-subtle)';
    base.color = 'var(--accent-text)';
    base.borderBottom = '1px solid var(--accent)';
  } else {
    base.background = 'var(--warning-subtle, rgba(217, 119, 6, 0.08))';
    base.color = 'var(--warning-text, var(--text))';
    base.borderBottom = '1px solid var(--warning, #f59e0b)';
  }
  if (sticky) {
    base.position = 'sticky';
    base.top = 0;
    base.zIndex = kind === 'active' ? 20 : 19;
  }
  return base;
}

// US-106 / US-140 — sticky top banner shown when a generation run is
// detected on mount. Surfaces concrete per-lesson progress (US-140) when
// `.generation-state.json` from US-136 is on disk; lets the user resume the
// live run, or wipe the partial run + restart from scratch.
export function ResumeBanner({
  activeRun,
  sticky = true,
  onNavigateToGeneration,
  onClearActive,
  onDismiss,
}: {
  activeRun: ActiveRun;
  sticky?: boolean;
  onNavigateToGeneration: (slug: string) => void;
  onClearActive: () => void;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Set when /resume returns 409 `busy`: a different course is mid-flight,
  // so the resume button is disabled with an explanatory tooltip until the
  // page reloads / activeRun changes.
  const [busyConflict, setBusyConflict] = useState(false);

  const showToast = useCallback((message: string) => {
    setErrorMessage(message);
    setTimeout(() => setErrorMessage((curr) => (curr === message ? null : curr)), 4500);
  }, []);

  const postFreshGenerate = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/courses/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: activeRun.slug }),
      });
      if (!res.ok) {
        let message = `Server returned ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body && typeof body.error === 'string') message = body.error;
        } catch {
          /* non-JSON body */
        }
        showToast(message);
        return false;
      }
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [activeRun.slug, showToast]);

  const handleResume = useCallback(async () => {
    if (busy || busyConflict) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const hasProgress = !!activeRun.progress;
      if (hasProgress) {
        const res = await fetch(
          `/api/courses/${encodeURIComponent(activeRun.slug)}/resume`,
          { method: 'POST' },
        );
        if (res.ok) {
          onNavigateToGeneration(activeRun.slug);
          return;
        }
        if (res.status === 409) {
          let code: string | undefined;
          try {
            const body = (await res.json()) as { error?: string };
            if (body && typeof body.error === 'string') code = body.error;
          } catch {
            /* non-JSON */
          }
          if (code === 'no-resumable-state') {
            // Race: state file vanished between the active-run summary and
            // this click. Brief delay so any in-flight cleanup finishes,
            // then fall through to a fresh /generate.
            await new Promise((r) => setTimeout(r, 250));
            const ok = await postFreshGenerate();
            if (ok) onNavigateToGeneration(activeRun.slug);
            return;
          }
          if (code === 'busy') {
            setBusyConflict(true);
            showToast('Another course generation is in flight — try again once it finishes.');
            return;
          }
        }
        let message = `Server returned ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body && typeof body.error === 'string') message = body.error;
        } catch {
          /* non-JSON */
        }
        showToast(message);
        return;
      }
      // No progress on disk → server has no resumable state. Just kick off
      // a fresh /generate (idempotent for the same slug per US-105).
      const ok = await postFreshGenerate();
      if (ok) onNavigateToGeneration(activeRun.slug);
    } finally {
      setBusy(false);
    }
  }, [activeRun.progress, activeRun.slug, busy, busyConflict, onNavigateToGeneration, postFreshGenerate, showToast]);

  const handleCancelAndRestart = useCallback(async () => {
    if (busy) return;
    const ok = window.confirm(
      `This will delete the partial generation and any lessons already produced for ${activeRun.name}. Continue?`,
    );
    if (!ok) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const del = await fetch(
        `/api/courses/${encodeURIComponent(activeRun.slug)}/generation-state`,
        { method: 'DELETE' },
      );
      if (del.status !== 204) {
        let message = `Server returned ${del.status}`;
        try {
          const body = (await del.json()) as { error?: string };
          if (body && typeof body.error === 'string') message = body.error;
        } catch {
          /* non-JSON */
        }
        showToast(message);
        return;
      }
      // Fresh run for the same slug.
      const started = await postFreshGenerate();
      if (started) {
        onNavigateToGeneration(activeRun.slug);
      } else {
        // DELETE succeeded but POST failed — clear the local active run
        // so the banner doesn't stick around pointing at deleted state.
        onClearActive();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeRun.name, activeRun.slug, busy, onClearActive, onNavigateToGeneration, postFreshGenerate, showToast]);

  const progress = activeRun.progress;
  const resumeTitle = busyConflict
    ? 'Another course is currently being generated; try again once it finishes.'
    : undefined;

  return (
    <div
      data-testid="resume-banner"
      data-resume-slug={activeRun.slug}
      data-resume-stage={activeRun.stage}
      style={bannerContainerStyle(sticky, 'active')}
    >
      <style>{`
        @keyframes resumeBannerDotPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.45; transform: scale(0.85); }
        }
        @media (prefers-reduced-motion: reduce) {
          .resume-banner-dot--inflight {
            animation: none !important;
          }
        }
      `}</style>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
        }}
      >
        <Sparkles size={14} strokeWidth={2} />
        <span data-testid="resume-banner-text" style={{ flex: 1 }}>
          {strings.resumeBanner.generatingPrefix}{' '}
          <strong data-testid="resume-banner-name">{activeRun.name}</strong>
          {' — '}
          <span data-testid="resume-banner-stage" style={{ fontFamily: 'var(--font-mono)' }}>
            {activeRun.stage}
          </span>
          {activeRun.queueLength > 0 && (
            <>
              {' · '}
              <span data-testid="resume-banner-queue">
                {activeRun.queueLength} {strings.resumeBanner.inQueueSuffix}
              </span>
            </>
          )}
        </span>
        <button
          type="button"
          data-testid="resume-banner-resume"
          onClick={() => void handleResume()}
          disabled={busy || busyConflict}
          title={resumeTitle}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 30,
            padding: '0 14px',
            background: 'var(--accent)',
            color: 'var(--text-on-accent)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--fs-sm)',
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: busy || busyConflict ? 'not-allowed' : 'pointer',
            opacity: busy || busyConflict ? 0.55 : 1,
          }}
        >
          {strings.resumeBanner.resumeCta}
          <ArrowRight size={12} strokeWidth={2} />
        </button>
        <button
          type="button"
          data-testid="cancel-and-restart-btn"
          onClick={() => void handleCancelAndRestart()}
          disabled={busy}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 30,
            padding: '0 12px',
            background: 'transparent',
            color: 'var(--accent-text)',
            border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--fs-sm)',
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.55 : 1,
          }}
        >
          Cancel and restart
        </button>
        <button
          type="button"
          data-testid="resume-banner-dismiss"
          aria-label="Dismiss"
          onClick={onDismiss}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--accent-text)',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 'var(--radius-sm)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      {progress && (
        <div
          data-testid="resume-banner-progress"
          style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}
        >
          <span
            data-testid="resume-banner-progress-text"
            style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' }}
          >
            {progress.lessonsDone} of {progress.lessonsTotal} lessons ·{' '}
            {progress.currentLessonSlug ?? '—'}
          </span>
          <div
            data-testid="resume-banner-dots"
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            {progress.lessons.map((lesson) => {
              const color =
                lesson.status === 'done'
                  ? 'var(--success)'
                  : lesson.status === 'failed'
                    ? 'var(--danger)'
                    : lesson.status === 'inflight'
                      ? 'var(--accent)'
                      : 'var(--text-tertiary)';
              const isDone = lesson.status === 'done';
              const inflight = lesson.status === 'inflight';
              const dotProps: {
                title: string;
                'data-testid': string;
                'data-status': string;
                'data-lesson-slug': string;
                style: CSSProperties;
                className?: string;
              } = {
                title: lesson.title,
                'data-testid': 'resume-banner-dot',
                'data-status': lesson.status,
                'data-lesson-slug': lesson.slug,
                style: {
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: color,
                  flexShrink: 0,
                  ...(inflight
                    ? {
                        animation: 'resumeBannerDotPulse 1.4s linear infinite',
                      }
                    : {}),
                },
                ...(inflight ? { className: 'resume-banner-dot--inflight' } : {}),
              };
              if (isDone) {
                return (
                  <a
                    key={lesson.slug}
                    href={`/courses/${encodeURIComponent(activeRun.slug)}/lessons/${encodeURIComponent(lesson.slug)}`}
                    target="_blank"
                    rel="noopener"
                    aria-label={lesson.title}
                    {...dotProps}
                  />
                );
              }
              return <span key={lesson.slug} {...dotProps} />;
            })}
          </div>
        </div>
      )}
      {errorMessage && (
        <div
          data-testid="resume-banner-toast"
          role="status"
          style={{
            marginTop: 6,
            padding: '6px 10px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--danger)',
            color: 'var(--text-on-accent)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
}

// Sticky banner shown when the server reports a leftover `.generation-state.json`
// for a course whose run is no longer live (Claude session limit, crash, power
// off). Resume hits POST /api/courses/<slug>/resume; Discard wipes via DELETE
// /api/courses/<slug>/generation-state. Rendered once per resumable entry —
// stacked under the live ResumeBanner when both are present.
export function ResumableRunBanner({
  entry,
  sticky = true,
  onNavigateToGeneration,
  onClear,
  onDismiss,
}: {
  entry: ResumableRunResp;
  sticky?: boolean;
  onNavigateToGeneration: (slug: string) => void;
  onClear: (slug: string) => void;
  onDismiss: (slug: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setErrorMessage(message);
    setTimeout(() => setErrorMessage((curr) => (curr === message ? null : curr)), 4500);
  }, []);

  const handleResume = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(entry.slug)}/resume`,
        { method: 'POST' },
      );
      if (res.ok) {
        onNavigateToGeneration(entry.slug);
        return;
      }
      let code: string | undefined;
      let message = `Server returned ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body && typeof body.error === 'string') {
          code = body.error;
          message = body.error;
        }
      } catch {
        /* non-JSON */
      }
      if (res.status === 409 && code === 'busy') {
        showToast('Another course generation is in flight — try again once it finishes.');
        return;
      }
      if (res.status === 409 && code === 'no-resumable-state') {
        // State file vanished between the active-run summary and this click
        // (concurrent discard from another tab). Drop the entry locally.
        onClear(entry.slug);
        return;
      }
      if (res.status === 409 && code === 'recently-cancelled') {
        showToast('This course was cancelled recently — wait a few seconds and try again.');
        return;
      }
      showToast(message);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, entry.slug, onClear, onNavigateToGeneration, showToast]);

  const handleDiscard = useCallback(async () => {
    if (busy) return;
    const ok = window.confirm(
      `Discard the partial generation for ${entry.name}? Lessons already produced will be deleted; init artifacts (research, sources, course outline) are kept.`,
    );
    if (!ok) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(entry.slug)}/generation-state`,
        { method: 'DELETE' },
      );
      if (res.status === 204) {
        onClear(entry.slug);
        return;
      }
      let message = `Server returned ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body && typeof body.error === 'string') message = body.error;
      } catch {
        /* non-JSON */
      }
      showToast(message);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, entry.name, entry.slug, onClear, showToast]);

  const summary =
    entry.initStatus === 'failed'
      ? 'Init stage failed — resume will retry it'
      : entry.lessonsTotal === 0
        ? entry.initStatus === 'done'
          ? 'Course outline ready — resume to generate lessons'
          : 'Course outline not yet finished'
        : `${entry.lessonsDone} of ${entry.lessonsTotal} lessons completed`;

  return (
    <div
      data-testid="resumable-run-banner"
      data-resumable-slug={entry.slug}
      style={bannerContainerStyle(sticky, 'paused')}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
        }}
      >
        <AlertTriangle size={14} strokeWidth={2} />
        <span data-testid="resumable-run-banner-text" style={{ flex: 1 }}>
          Previous generation paused for{' '}
          <strong data-testid="resumable-run-banner-name">{entry.name}</strong>
          {' — '}
          <span style={{ color: 'var(--text-secondary)' }}>{summary}</span>
        </span>
        <button
          type="button"
          data-testid="resumable-run-banner-resume"
          onClick={() => void handleResume()}
          disabled={busy}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 30,
            padding: '0 14px',
            background: 'var(--accent)',
            color: 'var(--text-on-accent)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--fs-sm)',
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.55 : 1,
          }}
        >
          Resume
          <ArrowRight size={12} strokeWidth={2} />
        </button>
        <button
          type="button"
          data-testid="resumable-run-banner-discard"
          onClick={() => void handleDiscard()}
          disabled={busy}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 30,
            padding: '0 12px',
            background: 'transparent',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--fs-sm)',
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.55 : 1,
          }}
        >
          Discard
        </button>
        <button
          type="button"
          data-testid="resumable-run-banner-dismiss"
          aria-label="Dismiss"
          onClick={() => onDismiss(entry.slug)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 'var(--radius-sm)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      {errorMessage && (
        <div
          data-testid="resumable-run-banner-toast"
          role="status"
          style={{
            marginTop: 6,
            padding: '6px 10px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--danger)',
            color: 'var(--text-on-accent)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
}

// US-195 — combined banner host. Mounts the live ResumeBanner + any
// ResumableRunBanner rows when their data is present. Renders nothing (no
// container, no whitespace) when there's no active run AND no resumable
// runs, so callers can safely embed it without worrying about layout shift.
//
// `hideForSlug` lets a host suppress the banner pointing at the slug
// currently rendered locally (e.g. /create Stage 6 — a banner that links
// back to itself is noise).
export function ResumeGenerationBanners({
  sticky = true,
  hideForSlug,
  onNavigateToGeneration,
}: {
  sticky?: boolean;
  hideForSlug?: string | null;
  onNavigateToGeneration: (slug: string) => void;
}) {
  const { activeRun, resumableRuns, setActiveRun, setResumableRuns } = useResumeRunData();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [resumableDismissed, setResumableDismissed] = useState<Set<string>>(
    () => new Set(),
  );

  const showActive =
    activeRun !== null && !bannerDismissed && activeRun.slug !== hideForSlug;
  const visibleResumable = resumableRuns.filter((r) => {
    if (resumableDismissed.has(r.slug)) return false;
    if (hideForSlug && r.slug === hideForSlug) return false;
    return true;
  });

  if (!showActive && visibleResumable.length === 0) return null;

  return (
    <div
      data-testid="resume-generation-banners"
      data-active-slug={activeRun?.slug ?? ''}
      data-resumable-count={visibleResumable.length}
      style={{ display: 'contents' }}
    >
      {showActive && activeRun && (
        <ResumeBanner
          activeRun={activeRun}
          sticky={sticky}
          onNavigateToGeneration={onNavigateToGeneration}
          onClearActive={() => setActiveRun(null)}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}
      {visibleResumable.map((entry) => (
        <ResumableRunBanner
          key={entry.slug}
          entry={entry}
          sticky={sticky}
          onNavigateToGeneration={onNavigateToGeneration}
          onClear={(slug) =>
            setResumableRuns((prev) => prev.filter((r) => r.slug !== slug))
          }
          onDismiss={(slug) =>
            setResumableDismissed((prev) => {
              const next = new Set(prev);
              next.add(slug);
              return next;
            })
          }
        />
      ))}
    </div>
  );
}
