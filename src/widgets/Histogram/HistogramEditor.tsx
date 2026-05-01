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
  type FieldErrors,
} from '@/components/EditorForm';
import { SourcesField } from '@/components/Sources';
import type { Source } from '@/lib/schemas/lesson';

import { HistogramDataSchema, type HistogramData } from './schema';

export interface HistogramEditorProps {
  initial: HistogramData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: HistogramData, sources?: Source[]) => Promise<void>;
}

function flattenIssues(error: z.ZodError<unknown>): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

function formatList(values: number[]): string {
  return values.join(', ');
}

function parseList(text: string): { values: number[]; error: string | null } {
  const trimmed = text.trim();
  if (trimmed === '') return { values: [], error: 'Provide at least one number' };
  const parts = trimmed.split(/\s*,\s*/);
  const values: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '') return { values: [], error: `Empty value at position ${i + 1}` };
    const n = Number(part);
    if (!Number.isFinite(n)) return { values: [], error: `"${part}" is not a number` };
    values.push(n);
  }
  return { values, error: null };
}

const helpTextStyle: CSSProperties = {
  marginTop: 4,
  fontSize: '11.5px',
  color: 'var(--text-tertiary)',
  lineHeight: 1.4,
};

export function HistogramEditor({ initial, initialSources, onCancel, onSave }: HistogramEditorProps) {
  const [edgesText, setEdgesText] = useState(formatList(initial.binEdges));
  const [countsText, setCountsText] = useState(formatList(initial.counts));
  const [sources, setSources] = useState<Source[] | undefined>(initialSources);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    const edges = parseList(edgesText);
    const counts = parseList(countsText);
    return { edges, counts };
  }, [edgesText, countsText]);

  const dirty = useMemo(() => {
    if (parsed.edges.error || parsed.counts.error) return true;
    const next = JSON.stringify({ binEdges: parsed.edges.values, counts: parsed.counts.values });
    const prev = JSON.stringify({ binEdges: initial.binEdges, counts: initial.counts });
    if (next !== prev) return true;
    return JSON.stringify(sources ?? null) !== JSON.stringify(initialSources ?? null);
  }, [initial.binEdges, initial.counts, parsed, sources, initialSources]);

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    if (parsed.edges.error) {
      setErrors({ binEdges: parsed.edges.error });
      return;
    }
    if (parsed.counts.error) {
      setErrors({ counts: parsed.counts.error });
      return;
    }
    const candidate: HistogramData = {
      binEdges: parsed.edges.values,
      counts: parsed.counts.values,
    };
    const result = HistogramDataSchema.safeParse(candidate);
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
  }, [dirty, onSave, parsed, saving, sources]);

  const edgesError = errors.binEdges || parsed.edges.error || undefined;
  const countsError = errors.counts || parsed.counts.error || undefined;

  return (
    <div
      data-testid="histogram-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div style={formBodyStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Bin edges (comma-separated)</span>
          <input
            type="text"
            data-testid="histogram-edit-bin-edges"
            value={edgesText}
            onChange={(e) => setEdgesText(e.target.value)}
            style={{
              ...inputStyle,
              fontFamily: 'var(--font-mono)',
              borderColor: edgesError ? 'var(--danger-border)' : undefined,
            }}
            spellCheck={false}
          />
          <div style={helpTextStyle}>
            Sorted numbers separated by commas. Length must be one more than counts.
          </div>
          {edgesError && (
            <div data-testid="histogram-edit-bin-edges-error" style={errorTextStyle}>
              {edgesError}
            </div>
          )}
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Counts (comma-separated)</span>
          <input
            type="text"
            data-testid="histogram-edit-counts"
            value={countsText}
            onChange={(e) => setCountsText(e.target.value)}
            style={{
              ...inputStyle,
              fontFamily: 'var(--font-mono)',
              borderColor: countsError ? 'var(--danger-border)' : undefined,
            }}
            spellCheck={false}
          />
          <div style={helpTextStyle}>
            One non-negative number per bin.
          </div>
          {countsError && (
            <div data-testid="histogram-edit-counts-error" style={errorTextStyle}>
              {countsError}
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
        cancelTestId="histogram-edit-cancel"
        saveTestId="histogram-edit-save"
      />
    </div>
  );
}
