'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';

import { Callout } from '@/components/Callout';

import { TheoryWidget } from './TheoryWidget';

export type TheoryEditorMode = 'write' | 'preview';

export interface TheoryEditorProps {
  initialMarkdown: string;
  onCancel: () => void;
  onSave: (nextMarkdown: string) => Promise<void>;
}

const FONT_SIZE = '13px';
const LINE_HEIGHT = 1.55;

const editorTheme = EditorView.theme({
  '&': {
    background: 'var(--code-bg)',
    color: 'var(--code-text)',
    fontFamily: 'var(--font-mono)',
    fontSize: FONT_SIZE,
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    fontSize: FONT_SIZE,
    lineHeight: String(LINE_HEIGHT),
    padding: 'var(--space-3) 0',
    caretColor: 'var(--accent)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: String(LINE_HEIGHT),
  },
  '.cm-gutters': {
    background: 'var(--code-bg)',
    color: 'var(--text-quaternary)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    color: 'var(--text-quaternary)',
    minWidth: '2ch',
    padding: '0 var(--space-3)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent)',
  },
  '.cm-selectionBackground, & .cm-content ::selection': {
    background: 'var(--accent-subtle) !important',
  },
});

const markdownHighlightStyle = HighlightStyle.define([
  {
    tag: [t.heading, t.heading1, t.heading2, t.heading3],
    color: 'var(--code-keyword)',
    fontWeight: '600',
  },
  { tag: t.strong, fontWeight: '600', color: 'var(--text)' },
  { tag: t.emphasis, fontStyle: 'italic', color: 'var(--text)' },
  { tag: t.link, color: 'var(--accent-text)' },
  { tag: t.url, color: 'var(--accent-text)' },
  {
    tag: [t.monospace, t.contentSeparator],
    color: 'var(--code-string)',
    fontFamily: 'var(--font-mono)',
  },
  { tag: t.quote, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--code-fn)' },
  { tag: t.meta, color: 'var(--code-comment)' },
]);

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

function segmentStyle(active: boolean): CSSProperties {
  return {
    appearance: 'none',
    border: 'none',
    background: active ? 'var(--bg-elevated)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-secondary)',
    fontSize: 'var(--fs-sm)',
    fontWeight: 500,
    padding: '4px 10px',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    boxShadow: active ? 'var(--shadow-xs)' : 'none',
    lineHeight: 1.2,
  };
}

export function TheoryEditor({
  initialMarkdown,
  onCancel,
  onSave,
}: TheoryEditorProps) {
  const [mode, setMode] = useState<TheoryEditorMode>('write');
  const [current, setCurrent] = useState<string>(initialMarkdown);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editorParentRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!editorParentRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        setCurrent(update.state.doc.toString());
      }
    });

    const view = new EditorView({
      parent: editorParentRef.current,
      state: EditorState.create({
        doc: initialMarkdown,
        extensions: [
          lineNumbers(),
          history(),
          indentOnInput(),
          bracketMatching(),
          markdown(),
          syntaxHighlighting(markdownHighlightStyle),
          editorTheme,
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          updateListener,
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount-once: doc updates flow via setCurrent + dispatch elsewhere if needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = current !== initialMarkdown;

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    setError(null);
    setSaving(true);
    try {
      await onSave(current);
      // Parent will unmount us on success; setSaving(false) is unnecessary but
      // keeps state consistent if parent decides to keep us mounted.
      setSaving(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }, [current, dirty, saving, onSave]);

  return (
    <div data-theory-editor>
      <div
        data-theory-editor-toolbar
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-3) var(--space-5)',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-subtle)',
        }}
      >
        <div
          role="tablist"
          aria-label="Edit mode"
          style={{
            display: 'inline-flex',
            gap: 2,
            background: 'var(--bg-active)',
            padding: 2,
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'write'}
            data-testid="theory-edit-write"
            data-active={mode === 'write' ? 'true' : 'false'}
            onClick={() => setMode('write')}
            style={segmentStyle(mode === 'write')}
          >
            Write
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'preview'}
            data-testid="theory-edit-preview"
            data-active={mode === 'preview' ? 'true' : 'false'}
            onClick={() => setMode('preview')}
            style={segmentStyle(mode === 'preview')}
          >
            Preview
          </button>
        </div>
      </div>

      <div
        data-theory-editor-body
        style={{ background: 'var(--code-bg)' }}
      >
        <div
          ref={editorParentRef}
          data-theory-editor-cm
          style={{
            display: mode === 'write' ? 'block' : 'none',
            background: 'var(--code-bg)',
          }}
        />
        {mode === 'preview' && (
          <div data-testid="theory-edit-preview-body">
            <TheoryWidget data={{ markdown: current }} />
          </div>
        )}
      </div>

      {error && (
        <div
          data-theory-editor-error
          style={{
            padding: 'var(--space-3) var(--space-5) 0',
            background: 'var(--bg-elevated)',
          }}
        >
          <Callout tone="danger" title="Save failed">
            {error}
          </Callout>
        </div>
      )}

      <div
        data-theory-editor-footer
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-5)',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
        }}
      >
        <button
          type="button"
          data-testid="theory-edit-cancel"
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
          data-testid="theory-edit-save"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          style={primaryButtonStyle(!dirty || saving)}
          aria-label="Save changes"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
