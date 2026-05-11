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

import { SttDemoDataSchema, type SttDemoData } from './schema';

export interface SttDemoEditorProps {
  initial: SttDemoData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: SttDemoData, sources?: Source[]) => Promise<void>;
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

const MIN_SECONDS = 1;
const MAX_SECONDS = 60;

function clampSeconds(n: number): number {
  if (!Number.isFinite(n)) return 10;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(n)));
}

export function SttDemoEditor({
  initial,
  initialSources,
  onCancel,
  onSave,
}: SttDemoEditorProps) {
  const [maxDurationSeconds, setMaxDurationSeconds] = useState<number>(
    initial.maxDurationSeconds,
  );
  const [prompt, setPrompt] = useState<string>(initial.prompt ?? '');
  const [sources, setSources] = useState<Source[] | undefined>(initialSources);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const current: SttDemoData = useMemo(() => {
    const out: SttDemoData = {
      maxDurationSeconds: clampSeconds(maxDurationSeconds),
    };
    if (prompt.trim()) out.prompt = prompt.trim();
    return out;
  }, [maxDurationSeconds, prompt]);

  const dirty = useMemo(() => {
    if (JSON.stringify(current) !== JSON.stringify(initial)) return true;
    return JSON.stringify(sources ?? null) !== JSON.stringify(initialSources ?? null);
  }, [current, initial, sources, initialSources]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    const result = SttDemoDataSchema.safeParse(current);
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
      data-testid="stt-demo-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div style={formBodyStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Max recording length (seconds)</span>
          <input
            type="number"
            data-testid="stt-demo-edit-max-duration"
            value={String(maxDurationSeconds)}
            min={MIN_SECONDS}
            max={MAX_SECONDS}
            step={1}
            onChange={(e) => {
              const n = Number(e.target.value);
              setMaxDurationSeconds(
                Number.isFinite(n) ? clampSeconds(n) : MIN_SECONDS,
              );
            }}
            style={{
              ...inputStyle,
              fontFamily: 'var(--font-mono)',
              borderColor: errors.maxDurationSeconds ? 'var(--danger-border)' : undefined,
            }}
          />
          <div style={helpTextStyle}>
            Clamped to {MIN_SECONDS}–{MAX_SECONDS} seconds. The widget
            auto-stops the microphone when this limit is reached.
          </div>
          {errors.maxDurationSeconds && (
            <div
              data-testid="stt-demo-edit-max-duration-error"
              style={errorTextStyle}
            >
              {errors.maxDurationSeconds}
            </div>
          )}
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Prompt (optional)</span>
          <textarea
            data-testid="stt-demo-edit-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='Optional instruction shown above the controls, e.g. "Say a short sentence in English."'
            style={{ ...textareaStyle, minHeight: 80 }}
          />
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
        cancelTestId="stt-demo-edit-cancel"
        saveTestId="stt-demo-edit-save"
      />
    </div>
  );
}
