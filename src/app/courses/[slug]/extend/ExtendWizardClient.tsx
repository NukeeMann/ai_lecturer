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
import { ArrowLeft, Plus, RotateCcw, Sparkles, X } from 'lucide-react';

import { AppLogoLink } from '@/components/AppLogo';
import { SettingsMenu } from '@/components/SettingsMenu';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { Course } from '@/lib/schemas/course';
import type {
  ExtendNewLesson,
  ExtendResponse,
} from '@/lib/schemas/extend';

type DialogState =
  | { kind: 'module' }
  | { kind: 'lesson'; moduleId: string; moduleTitle: string };

type Additions = {
  newModuleIds: string[];
  newLessonIds: ExtendNewLesson[];
};

function buildInstruction(
  dialog: DialogState,
  text: string,
): string {
  if (dialog.kind === 'module') {
    return `Add a new module: ${text}`;
  }
  return `Add a new lesson under module "${dialog.moduleTitle}" (id: ${dialog.moduleId}): ${text}`;
}

function mergeAdditions(prev: Additions, incoming: Additions): Additions {
  const mergedModuleIds = Array.from(
    new Set([...prev.newModuleIds, ...incoming.newModuleIds]),
  );
  const seen = new Set<string>();
  const mergedLessons: ExtendNewLesson[] = [];
  for (const l of [...prev.newLessonIds, ...incoming.newLessonIds]) {
    if (seen.has(l.lessonSlug)) continue;
    seen.add(l.lessonSlug);
    mergedLessons.push(l);
  }
  return { newModuleIds: mergedModuleIds, newLessonIds: mergedLessons };
}

export default function ExtendWizardClient({ course }: { course: Course }) {
  const [currentProposed, setCurrentProposed] = useState<Course>(course);
  const [additions, setAdditions] = useState<Additions>({
    newModuleIds: [],
    newLessonIds: [],
  });
  const [instructions, setInstructions] = useState<string[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [instructionDraft, setInstructionDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
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

  const openModuleDialog = useCallback(() => {
    if (loading) return;
    setInstructionDraft('');
    setDialog({ kind: 'module' });
  }, [loading]);

  const openLessonDialog = useCallback(
    (moduleId: string, moduleTitle: string) => {
      if (loading) return;
      setInstructionDraft('');
      setDialog({ kind: 'lesson', moduleId, moduleTitle });
    },
    [loading],
  );

  // Cancel button — also used by the Esc key + backdrop click. When a request
  // is in flight, we abort it; the abort handler in handleAdd resets loading.
  const closeDialog = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setDialog(null);
    setInstructionDraft('');
    setLoading(false);
  }, []);

  const handleAdd = useCallback(async () => {
    const trimmed = instructionDraft.trim();
    if (!trimmed) return;
    if (!dialog) return;
    if (loading) return;
    const fullInstruction = buildInstruction(dialog, trimmed);
    // Latest instruction goes into `instruction`; everything before it is
    // chronological refinement history (US-143 contract).
    const refinements = instructions.map((content) => ({
      role: 'user' as const,
      content,
    }));
    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.slug)}/extend`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            instruction: fullInstruction,
            ...(refinements.length > 0 ? { refinements } : {}),
          }),
          signal: ctrl.signal,
        },
      );
      if (ctrl.signal.aborted) return;
      if (!res.ok) {
        if (res.status === 422) {
          showToast("Couldn't add — please rephrase.");
        } else if (res.status === 409) {
          showToast('Cannot extend while generation is active.');
          setDialog(null);
          setInstructionDraft('');
        } else {
          showToast('Server error — please try again.');
        }
        return;
      }
      const data = (await res.json()) as ExtendResponse;
      if (ctrl.signal.aborted) return;
      setCurrentProposed(data.proposedSchema);
      setAdditions((prev) =>
        mergeAdditions(prev, {
          newModuleIds: data.additions.newModuleIds,
          newLessonIds: data.additions.newLessonIds,
        }),
      );
      setInstructions((prev) => [...prev, fullInstruction]);
      setDialog(null);
      setInstructionDraft('');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      showToast('Server error — please try again.');
    } finally {
      if (!ctrl.signal.aborted) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }, [
    course.slug,
    dialog,
    instructionDraft,
    instructions,
    loading,
    showToast,
  ]);

  const handleReset = useCallback(() => {
    if (loading) return;
    if (hasAdditions) {
      const ok = window.confirm(
        'Discard all pending additions and reset the proposed schema?',
      );
      if (!ok) return;
    }
    setCurrentProposed(course);
    setAdditions({ newModuleIds: [], newLessonIds: [] });
    setInstructions([]);
  }, [course, hasAdditions, loading]);

  // Esc closes dialog. While loading, Cancel/Esc abort the in-flight request.
  useEffect(() => {
    if (!dialog) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, closeDialog]);

  // Autofocus the textarea when dialog opens.
  useEffect(() => {
    if (!dialog) return;
    const t = textareaRef.current;
    if (t) t.focus();
  }, [dialog]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

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
            Add new modules or lessons to this course. Each addition is
            proposed by the agent and reflected in the schema tree below.
          </p>

          <div
            data-testid="extend-tree"
            data-loading={loading ? 'true' : undefined}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
              opacity: loading ? 0.6 : 1,
              pointerEvents: loading ? 'none' : undefined,
              transition: 'opacity 120ms ease',
            }}
          >
            {currentProposed.modules.map((m) => {
              const moduleIsNew = newModuleIdSet.has(m.id);
              const moduleMinutes = m.lessons.reduce(
                (ms, l) => ms + l.estimatedMinutes,
                0,
              );
              return (
                <div
                  key={m.id}
                  data-testid={`extend-module-${m.id}`}
                  data-new={moduleIsNew ? 'true' : undefined}
                  style={moduleIsNew ? newModuleCardStyle : moduleCardStyle}
                >
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
                  <ul style={lessonListStyle}>
                    {m.lessons.map((l) => {
                      const lessonIsNew = newLessonSlugSet.has(l.slug);
                      return (
                        <li
                          key={l.slug}
                          data-testid={`extend-lesson-${l.slug}`}
                          data-new={lessonIsNew ? 'true' : undefined}
                          style={
                            lessonIsNew ? newLessonRowStyle : lessonRowStyle
                          }
                        >
                          <span style={lessonTitleStyle}>{l.title}</span>
                          <span style={lessonMetaStyle}>
                            {l.estimatedMinutes} min
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <button
                    type="button"
                    data-testid={`extend-add-lesson-${m.id}`}
                    onClick={() => openLessonDialog(m.id, m.title)}
                    disabled={loading}
                    style={addInlineBtnStyle}
                  >
                    <Plus size={14} strokeWidth={2} />
                    <span>{`+ Add lesson to ${m.title}`}</span>
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              data-testid="extend-add-module"
              onClick={openModuleDialog}
              disabled={loading}
              style={addBlockBtnStyle}
            >
              <Plus size={16} strokeWidth={2} />
              <span>+ Add module</span>
            </button>
          </div>
        </div>
      </main>

      <div style={bottomBarStyle}>
        <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-xs)' }}>
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
            disabled={loading || (!hasAdditions && instructions.length === 0)}
            style={ghostBtnStyle}
          >
            <RotateCcw size={14} strokeWidth={2} />
            <span>Reset proposal</span>
          </button>
          <button
            type="button"
            data-testid="extend-generate"
            disabled
            title="Wire-up coming in next iteration"
            aria-label="Generate additions (disabled)"
            style={primaryBtnStyle(true)}
          >
            <Sparkles size={14} strokeWidth={2} />
            <span>Generate additions</span>
          </button>
        </div>
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
            aria-labelledby="extend-dialog-title"
            style={dialogStyle}
          >
            <header style={dialogHeaderStyle}>
              <h2 id="extend-dialog-title" style={dialogTitleStyle}>
                {dialog.kind === 'module'
                  ? `Add a module to "${course.title}"`
                  : `Add a lesson to "${dialog.moduleTitle}"`}
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
                htmlFor="extend-dialog-textarea"
                style={dialogLabelStyle}
              >
                {dialog.kind === 'module'
                  ? 'What should this module cover?'
                  : 'What should this lesson cover?'}
              </label>
              <textarea
                id="extend-dialog-textarea"
                data-testid="extend-dialog-textarea"
                ref={textareaRef}
                value={instructionDraft}
                onChange={(e) => setInstructionDraft(e.target.value)}
                disabled={loading}
                placeholder={
                  dialog.kind === 'module'
                    ? 'e.g., "a new module on advanced indexing with three lessons"'
                    : 'e.g., "a deep dive on the autograd engine with two practice exercises"'
                }
                rows={4}
                style={dialogTextareaStyle}
              />
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
                onClick={() => void handleAdd()}
                disabled={loading || instructionDraft.trim().length === 0}
                style={primaryBtnStyle(
                  loading || instructionDraft.trim().length === 0,
                )}
              >
                {loading ? (
                  <>
                    <span
                      data-testid="extend-dialog-add-spinner"
                      aria-hidden
                      style={spinnerStyle}
                    />
                    <span>Adding…</span>
                  </>
                ) : (
                  'Add'
                )}
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
  // Longhand only — combining shorthand `border` with a separate
  // `borderLeftWidth` lets the shorthand stomp the 3px accent rail (this
  // pattern is taken from page.tsx ExtendPreview).
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
  alignItems: 'baseline',
  justifyContent: 'space-between',
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
  gap: 'var(--space-3)',
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

const dialogTextareaStyle: CSSProperties = {
  width: '100%',
  resize: 'vertical',
  minHeight: 90,
  padding: '10px 12px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.5,
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
