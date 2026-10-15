'use client';

// Generic editor for the EEG widgets: their data (answer keys in normalised
// coordinates, simulation specs, montage lists) is too structured for a
// field-per-property form, so the section is edited as JSON and validated
// against the widget's Zod schema before saving. Each widget's
// `<Name>Editor.tsx` is a thin wrapper that passes its schema + title.

import { useMemo, useState, type CSSProperties } from 'react';
import type { ZodType, ZodTypeDef } from 'zod';

import {
  EditorFormFooter,
  EditorFormSaveError,
  errorTextStyle,
  fieldStyle,
  formBodyStyle,
  labelStyle,
  textareaStyle,
} from '@/components/EditorForm';
import { SourcesField } from '@/components/Sources';
import type { Source } from '@/lib/schemas/lesson';

import { describeDataError } from './dataError';

export interface EegJsonEditorProps<T> {
  /** Shown above the textarea, e.g. "EEG viewer data (JSON)". */
  title: string;
  /** One-line help under the title. */
  hint?: string;
  schema: ZodType<T, ZodTypeDef, unknown>;
  initial: T;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: T, sources?: Source[]) => Promise<void>;
  /** data-testid prefix. */
  testId?: string;
}

const jsonAreaStyle: CSSProperties = {
  ...textareaStyle,
  minHeight: 320,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-xs)',
  lineHeight: 1.5,
  whiteSpace: 'pre',
  overflowX: 'auto',
  tabSize: 2,
};

type Validation<T> = { ok: true; value: T } | { ok: false; lines: string[] };

/** Parse + validate the JSON text against the widget schema (pure; exported for tests). */
export function validateEegJson<T>(schema: ZodType<T, ZodTypeDef, unknown>, text: string): Validation<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, lines: [`JSON syntax error: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const r = schema.safeParse(raw);
  return r.success ? { ok: true, value: r.data } : { ok: false, lines: describeDataError(r.error) };
}

export function EegJsonEditor<T>({
  title,
  hint,
  schema,
  initial,
  initialSources,
  onCancel,
  onSave,
  testId = 'eeg-json-editor',
}: EegJsonEditorProps<T>) {
  const initialText = useMemo(() => JSON.stringify(initial, null, 2), [initial]);
  const [text, setText] = useState(initialText);
  const [sources, setSources] = useState<Source[] | undefined>(initialSources);
  const [sourcesDirty, setSourcesDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const validation = useMemo(() => validateEegJson(schema, text), [schema, text]);
  const dirty = text !== initialText || sourcesDirty;

  const save = async () => {
    if (!validation.ok) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(validation.value, sources);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={formBodyStyle} data-testid={testId}>
      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor={`${testId}-json`}>
          {title}
        </label>
        {hint ? <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)' }}>{hint}</span> : null}
        <textarea
          id={`${testId}-json`}
          data-testid={`${testId}-json`}
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          style={jsonAreaStyle}
        />
        {!validation.ok ? (
          <ul style={{ ...errorTextStyle, margin: 0, paddingLeft: 18 }} data-testid={`${testId}-errors`}>
            {validation.lines.slice(0, 8).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div style={fieldStyle}>
        <SourcesField
          sources={sources}
          onChange={(next) => {
            setSources(next);
            setSourcesDirty(true);
          }}
        />
      </div>
      <EditorFormSaveError message={saveError} />
      <EditorFormFooter
        saving={saving}
        saveDisabled={!dirty || !validation.ok}
        onCancel={onCancel}
        onSave={() => void save()}
      />
    </div>
  );
}

export default EegJsonEditor;
