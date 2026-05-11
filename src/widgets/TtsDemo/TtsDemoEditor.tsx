'use client';

import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import type { z } from 'zod';

import {
  EditorFormFooter,
  EditorFormSaveError,
  errorTextStyle,
  fieldStyle,
  formBodyStyle,
  inputStyle,
  labelStyle,
  textareaStyle,
  type FieldErrors,
} from '@/components/EditorForm';
import { SourcesField } from '@/components/Sources';
import type { Source } from '@/lib/schemas/lesson';

import { TtsDemoDataSchema, type TtsDemoData } from './schema';

export interface TtsDemoEditorProps {
  initial: TtsDemoData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: TtsDemoData, sources?: Source[]) => Promise<void>;
}

function flattenIssues(error: z.ZodError<unknown>): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

const helpTextStyle: CSSProperties = {
  marginTop: 4,
  fontSize: '11.5px',
  color: 'var(--text-tertiary)',
  lineHeight: 1.4,
};

export function TtsDemoEditor({
  initial,
  initialSources,
  onCancel,
  onSave,
}: TtsDemoEditorProps) {
  const [defaultText, setDefaultText] = useState(initial.defaultText ?? '');
  const [placeholderText, setPlaceholderText] = useState(initial.placeholderText ?? '');
  const [sources, setSources] = useState<Source[] | undefined>(initialSources);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const current: TtsDemoData = useMemo(() => {
    const out: TtsDemoData = {};
    if (defaultText.length > 0) out.defaultText = defaultText;
    if (placeholderText.length > 0) out.placeholderText = placeholderText;
    return out;
  }, [defaultText, placeholderText]);

  const dirty = useMemo(() => {
    if (JSON.stringify(current) !== JSON.stringify(initial)) return true;
    return JSON.stringify(sources ?? null) !== JSON.stringify(initialSources ?? null);
  }, [current, initial, sources, initialSources]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    const result = TtsDemoDataSchema.safeParse(current);
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
  }, [current, onSave, saving, sources]);

  return (
    <div
      data-testid="tts-demo-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div style={formBodyStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Default text (optional)</span>
          <textarea
            data-testid="tts-demo-edit-default-text"
            value={defaultText}
            onChange={(e) => setDefaultText(e.target.value)}
            maxLength={2000}
            placeholder="Pre-seed the textarea with a sample phrase."
            style={{
              ...textareaStyle,
              minHeight: 120,
              borderColor: errors.defaultText ? 'var(--danger-border)' : undefined,
            }}
          />
          <div style={helpTextStyle}>
            Pre-fills the widget&apos;s textarea on first load. Max 2000 characters.
          </div>
          {errors.defaultText && (
            <div data-testid="tts-demo-edit-default-text-error" style={errorTextStyle}>
              {errors.defaultText}
            </div>
          )}
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Placeholder text (optional)</span>
          <input
            type="text"
            data-testid="tts-demo-edit-placeholder-text"
            value={placeholderText}
            onChange={(e) => setPlaceholderText(e.target.value)}
            placeholder="Type a phrase to hear it spoken…"
            style={inputStyle}
          />
          <div style={helpTextStyle}>
            Shown inside the textarea when it&apos;s empty.
          </div>
        </label>

        <SourcesField sources={sources} onChange={setSources} />

        {errors._root && <div style={errorTextStyle}>{errors._root}</div>}
      </div>

      <EditorFormSaveError message={saveError} />
      <EditorFormFooter
        saving={saving}
        saveDisabled={!dirty}
        onCancel={onCancel}
        onSave={() => void handleSave()}
        cancelTestId="tts-demo-edit-cancel"
        saveTestId="tts-demo-edit-save"
      />
    </div>
  );
}
