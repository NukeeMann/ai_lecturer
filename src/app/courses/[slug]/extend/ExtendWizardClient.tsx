'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Sparkles, X } from 'lucide-react';

import { AppLogoLink } from '@/components/AppLogo';
import { SettingsMenu } from '@/components/SettingsMenu';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { Course } from '@/lib/schemas/course';

export type PendingAddition =
  | { kind: 'module'; instruction: string }
  | { kind: 'lesson'; moduleId: string; instruction: string };

type DialogState =
  | { kind: 'module' }
  | { kind: 'lesson'; moduleId: string; moduleTitle: string };

const PENDING_TRUNCATE = 80;

function truncate(text: string, max = PENDING_TRUNCATE): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

export default function ExtendWizardClient({ course }: { course: Course }) {
  const [pendingAdditions, setPendingAdditions] = useState<PendingAddition[]>(
    [],
  );
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [instructionDraft, setInstructionDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const openModuleDialog = useCallback(() => {
    setInstructionDraft('');
    setDialog({ kind: 'module' });
  }, []);

  const openLessonDialog = useCallback(
    (moduleId: string, moduleTitle: string) => {
      setInstructionDraft('');
      setDialog({ kind: 'lesson', moduleId, moduleTitle });
    },
    [],
  );

  const closeDialog = useCallback(() => {
    setDialog(null);
    setInstructionDraft('');
  }, []);

  const handleAdd = useCallback(() => {
    const trimmed = instructionDraft.trim();
    if (!trimmed) return;
    if (!dialog) return;
    setPendingAdditions((prev) =>
      dialog.kind === 'module'
        ? [...prev, { kind: 'module', instruction: trimmed }]
        : [
            ...prev,
            { kind: 'lesson', moduleId: dialog.moduleId, instruction: trimmed },
          ],
    );
    setDialog(null);
    setInstructionDraft('');
  }, [dialog, instructionDraft]);

  const discardAt = useCallback((index: number) => {
    setPendingAdditions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Esc closes dialog; click on backdrop also closes.
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
            Add new modules or lessons to this course. Each item you add stays
            here as a pending placeholder until you generate.
          </p>

          <div
            data-testid="extend-tree"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
            }}
          >
            {course.modules.map((m) => {
              const pendingLessons = pendingAdditions
                .map((p, idx) => ({ p, idx }))
                .filter(
                  (e) => e.p.kind === 'lesson' && e.p.moduleId === m.id,
                );
              const moduleMinutes = m.lessons.reduce(
                (ms, l) => ms + l.estimatedMinutes,
                0,
              );
              return (
                <div
                  key={m.id}
                  data-testid={`extend-module-${m.id}`}
                  style={moduleCardStyle}
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
                    {m.lessons.map((l) => (
                      <li
                        key={l.slug}
                        data-testid={`extend-lesson-${l.slug}`}
                        style={lessonRowStyle}
                      >
                        <span style={lessonTitleStyle}>{l.title}</span>
                        <span style={lessonMetaStyle}>
                          {l.estimatedMinutes} min
                        </span>
                      </li>
                    ))}
                    {pendingLessons.map(({ p, idx }) => (
                      <li
                        key={`pending-lesson-${idx}`}
                        data-testid="extend-pending-lesson"
                        data-pending-index={idx}
                        data-module-id={m.id}
                        style={pendingRowStyle}
                      >
                        <span style={pendingLabelStyle}>
                          (pending) {truncate(p.instruction)}
                        </span>
                        <button
                          type="button"
                          data-testid="extend-discard"
                          data-pending-index={idx}
                          onClick={() => discardAt(idx)}
                          style={discardBtnStyle}
                        >
                          Discard
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    data-testid={`extend-add-lesson-${m.id}`}
                    onClick={() => openLessonDialog(m.id, m.title)}
                    style={addInlineBtnStyle}
                  >
                    <Plus size={14} strokeWidth={2} />
                    <span>{`+ Add lesson to ${m.title}`}</span>
                  </button>
                </div>
              );
            })}

            {pendingAdditions
              .map((p, idx) => ({ p, idx }))
              .filter((e) => e.p.kind === 'module')
              .map(({ p, idx }) => (
                <div
                  key={`pending-module-${idx}`}
                  data-testid="extend-pending-module"
                  data-pending-index={idx}
                  style={pendingModuleCardStyle}
                >
                  <div style={pendingModuleHeaderStyle}>
                    <span style={pendingLabelStyle}>
                      (pending) {truncate(p.instruction)}
                    </span>
                    <button
                      type="button"
                      data-testid="extend-discard"
                      data-pending-index={idx}
                      onClick={() => discardAt(idx)}
                      style={discardBtnStyle}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              ))}

            <button
              type="button"
              data-testid="extend-add-module"
              onClick={openModuleDialog}
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
          {pendingAdditions.length === 0
            ? 'Nothing pending yet.'
            : `${pendingAdditions.length} pending ${
                pendingAdditions.length === 1 ? 'addition' : 'additions'
              }`}
        </div>
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
                onClick={handleAdd}
                disabled={instructionDraft.trim().length === 0}
                style={primaryBtnStyle(instructionDraft.trim().length === 0)}
              >
                Add
              </button>
            </div>
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
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
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
  border: '1px solid var(--border)',
  gap: 'var(--space-3)',
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

const pendingRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 10px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent-soft, var(--accent-subtle))',
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: 'var(--accent)',
  gap: 'var(--space-3)',
};

const pendingModuleCardStyle: CSSProperties = {
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: 'var(--accent)',
  background: 'var(--accent-soft, var(--accent-subtle))',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4)',
};

const pendingModuleHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
};

const pendingLabelStyle: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  color: 'var(--accent-text)',
};

const discardBtnStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--accent-text)',
  fontSize: 'var(--fs-xs)',
  fontWeight: 500,
  cursor: 'pointer',
  padding: '2px 6px',
  textDecoration: 'underline',
  fontFamily: 'inherit',
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
