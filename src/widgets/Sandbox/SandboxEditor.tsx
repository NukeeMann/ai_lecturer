'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import type { z } from 'zod';

import {
  EditorFormFooter,
  EditorFormSaveError,
  errorTextStyle,
  fieldStyle,
  formBodyStyle,
  inputStyle,
  labelStyle,
  type FieldErrors,
} from '@/components/EditorForm';
import { SourcesField } from '@/components/Sources';
import type { Source } from '@/lib/schemas/lesson';

import {
  codeRunnerEditorTheme,
  codeRunnerHighlightStyle,
} from '../Code/CodeRunner';
import { SandboxDataSchema, type SandboxData } from './schema';

export interface SandboxEditorProps {
  initial: SandboxData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: SandboxData, sources?: Source[]) => Promise<void>;
}

function flattenIssues(error: z.ZodError<unknown>): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

const cmContainerStyle: CSSProperties = {
  background: 'var(--code-bg)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
};

export function SandboxEditor({ initial, initialSources, onCancel, onSave }: SandboxEditorProps) {
  const [starterCode, setStarterCode] = useState(initial.starterCode);
  const [encouragement, setEncouragement] = useState(initial.encouragement);
  const [sources, setSources] = useState<Source[] | undefined>(initialSources);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const setStarterRef = useRef(setStarterCode);
  useEffect(() => {
    setStarterRef.current = setStarterCode;
  }, []);

  useEffect(() => {
    if (!parentRef.current) return;
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        setStarterRef.current(update.state.doc.toString());
      }
    });
    const view = new EditorView({
      parent: parentRef.current,
      state: EditorState.create({
        doc: initial.starterCode,
        extensions: [
          lineNumbers(),
          history(),
          indentOnInput(),
          bracketMatching(),
          python(),
          syntaxHighlighting(codeRunnerHighlightStyle),
          codeRunnerEditorTheme,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          updateListener,
        ],
      }),
    });
    return () => {
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current: SandboxData = useMemo(
    () => ({ starterCode, encouragement }),
    [starterCode, encouragement],
  );

  const dirty = useMemo(() => {
    if (JSON.stringify(current) !== JSON.stringify(initial)) return true;
    return JSON.stringify(sources ?? null) !== JSON.stringify(initialSources ?? null);
  }, [current, initial, sources, initialSources]);

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    const result = SandboxDataSchema.safeParse(current);
    if (!result.success) {
      setErrors(flattenIssues(result.error));
      return;
    }
    setErrors({});
    setSaveError(null);
    setSaving(true);
    try {
      await onSave(result.data, sources);
      setSaving(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }, [current, dirty, onSave, saving, sources]);

  const starterError = errors.starterCode;
  const encouragementError = errors.encouragement;

  return (
    <div
      data-testid="sandbox-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div style={formBodyStyle}>
        <div style={fieldStyle}>
          <span style={labelStyle}>Starter code</span>
          <div ref={parentRef} data-testid="sandbox-edit-starter" style={cmContainerStyle} />
          {starterError && (
            <div data-testid="sandbox-edit-starter-error" style={errorTextStyle}>
              {starterError}
            </div>
          )}
        </div>

        <label style={fieldStyle}>
          <span style={labelStyle}>Encouragement</span>
          <input
            type="text"
            data-testid="sandbox-edit-encouragement"
            value={encouragement}
            onChange={(e) => setEncouragement(e.target.value)}
            style={{
              ...inputStyle,
              borderColor: encouragementError ? 'var(--danger-border)' : undefined,
            }}
          />
          {encouragementError && (
            <div data-testid="sandbox-edit-encouragement-error" style={errorTextStyle}>
              {encouragementError}
            </div>
          )}
        </label>

        <SourcesField sources={sources} onChange={setSources} />
      </div>

      <EditorFormSaveError message={saveError} />
      <EditorFormFooter
        saving={saving}
        saveDisabled={!dirty}
        onCancel={onCancel}
        onSave={() => void handleSave()}
        cancelTestId="sandbox-edit-cancel"
        saveTestId="sandbox-edit-save"
      />
    </div>
  );
}
