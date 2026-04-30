'use client';

import type { CSSProperties } from 'react';

import { Callout } from './Callout';

const buttonBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 var(--space-4)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background-color 120ms, border-color 120ms, color 120ms',
};

const ghostButtonStyle: CSSProperties = {
  ...buttonBase,
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid transparent',
};

function primaryButtonStyle(disabled: boolean): CSSProperties {
  return {
    ...buttonBase,
    background: disabled ? 'var(--bg-active)' : 'var(--accent)',
    color: disabled ? 'var(--text-tertiary)' : 'var(--text-on-accent)',
    border: '1px solid transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
  };
}

export interface EditorFormFooterProps {
  saving: boolean;
  saveDisabled: boolean;
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
  cancelTestId?: string;
  saveTestId?: string;
}

export function EditorFormFooter({
  saving,
  saveDisabled,
  onCancel,
  onSave,
  saveLabel = 'Save',
  cancelTestId = 'editor-cancel',
  saveTestId = 'editor-save',
}: EditorFormFooterProps) {
  return (
    <div
      data-editor-form-footer
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-5)',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        data-testid={cancelTestId}
        onClick={onCancel}
        disabled={saving}
        style={{
          ...ghostButtonStyle,
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.7 : 1,
        }}
        aria-label="Cancel edit"
      >
        Cancel
      </button>
      <button
        type="button"
        data-testid={saveTestId}
        onClick={onSave}
        disabled={saveDisabled || saving}
        style={primaryButtonStyle(saveDisabled || saving)}
        aria-label="Save changes"
      >
        {saving ? 'Saving…' : saveLabel}
      </button>
    </div>
  );
}

export interface EditorFormSaveErrorProps {
  message: string | null;
}

export function EditorFormSaveError({ message }: EditorFormSaveErrorProps) {
  if (!message) return null;
  return (
    <div
      data-testid="editor-save-error"
      style={{
        padding: 'var(--space-3) var(--space-5) 0',
        background: 'var(--bg-elevated)',
        flexShrink: 0,
      }}
    >
      <Callout tone="danger" title="Save failed">
        {message}
      </Callout>
    </div>
  );
}

export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
  marginBottom: 6,
};

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  color: 'var(--text)',
  background: 'var(--bg)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  outline: 'none',
  boxSizing: 'border-box',
};

export const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 80,
  resize: 'vertical',
  fontFamily: 'inherit',
  lineHeight: 1.5,
};

export const errorTextStyle: CSSProperties = {
  marginTop: 4,
  fontSize: '11.5px',
  color: 'var(--danger)',
  lineHeight: 1.35,
};

export const fieldStyle: CSSProperties = {
  display: 'block',
  marginBottom: 'var(--space-4)',
};

export const sectionTitleStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
  marginBottom: 6,
};

export const formBodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: 'var(--space-4) var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
};

export interface FieldErrors {
  [path: string]: string | undefined;
}

export function pickFieldError(
  errors: FieldErrors,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    if (errors[k]) return errors[k];
  }
  return undefined;
}
