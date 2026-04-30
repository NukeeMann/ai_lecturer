'use client';

import {
  useCallback,
  useEffect,
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

import { DemoDataSchema, type DemoData } from './schema';

export interface DemoEditorProps {
  initial: DemoData;
  onCancel: () => void;
  onSave: (next: DemoData) => Promise<void>;
}

function flattenIssues(error: z.ZodError<unknown>): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

const selectStyle: CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
  appearance: 'auto',
};

const numberRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 'var(--space-2)',
};

export function DemoEditor({ initial, onCancel, onSave }: DemoEditorProps) {
  const [imageSrc, setImageSrc] = useState(initial.imageSrc);
  const [sigmaMin, setSigmaMin] = useState(String(initial.params.sigmaMin));
  const [sigmaMax, setSigmaMax] = useState(String(initial.params.sigmaMax));
  const [sigmaDefault, setSigmaDefault] = useState(
    String(initial.params.sigmaDefault),
  );
  const [images, setImages] = useState<string[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/demo-images', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { images?: string[] };
        if (cancelled) return;
        setImages(Array.isArray(body.images) ? body.images : []);
      } catch {
        // Network failure → dropdown shows just the current value.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dropdownOptions = useMemo(() => {
    if (!imageSrc) return images;
    if (images.includes(imageSrc)) return images;
    return [imageSrc, ...images];
  }, [images, imageSrc]);

  const current: DemoData = useMemo(() => {
    return {
      demoType: initial.demoType,
      imageSrc,
      params: {
        sigmaMin: Number(sigmaMin),
        sigmaMax: Number(sigmaMax),
        sigmaDefault: Number(sigmaDefault),
      },
    };
  }, [initial.demoType, imageSrc, sigmaMin, sigmaMax, sigmaDefault]);

  const dirty = useMemo(
    () => JSON.stringify(current) !== JSON.stringify(initial),
    [current, initial],
  );

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    const result = DemoDataSchema.safeParse(current);
    if (!result.success) {
      setErrors(flattenIssues(result.error));
      return;
    }
    // Cross-field guard: min ≤ default ≤ max.
    const { sigmaMin: lo, sigmaMax: hi, sigmaDefault: def } = result.data.params;
    if (lo > hi) {
      setErrors({ 'params.sigmaMin': 'sigmaMin must be ≤ sigmaMax' });
      return;
    }
    if (def < lo || def > hi) {
      setErrors({ 'params.sigmaDefault': 'sigmaDefault must be within [sigmaMin, sigmaMax]' });
      return;
    }
    setErrors({});
    setSaveError(null);
    setSaving(true);
    try {
      await onSave(result.data);
      setSaving(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }, [current, dirty, onSave, saving]);

  const imageError = errors.imageSrc;
  const minError = errors['params.sigmaMin'];
  const maxError = errors['params.sigmaMax'];
  const defError = errors['params.sigmaDefault'];

  return (
    <div
      data-testid="demo-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div style={formBodyStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Image source</span>
          <select
            data-testid="demo-edit-image-src"
            value={imageSrc}
            onChange={(e) => setImageSrc(e.target.value)}
            style={{
              ...selectStyle,
              borderColor: imageError ? 'var(--danger-border)' : undefined,
            }}
          >
            {dropdownOptions.length === 0 && <option value="">(none)</option>}
            {dropdownOptions.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>
          {imageError && (
            <div data-testid="demo-edit-image-error" style={errorTextStyle}>
              {imageError}
            </div>
          )}
        </label>

        <div style={fieldStyle}>
          <span style={labelStyle}>Sigma range</span>
          <div style={numberRowStyle}>
            <label>
              <span
                style={{
                  display: 'block',
                  fontSize: '11px',
                  color: 'var(--text-tertiary)',
                  marginBottom: 4,
                }}
              >
                Min
              </span>
              <input
                type="number"
                step="0.1"
                data-testid="demo-edit-sigma-min"
                value={sigmaMin}
                onChange={(e) => setSigmaMin(e.target.value)}
                style={{
                  ...inputStyle,
                  borderColor: minError ? 'var(--danger-border)' : undefined,
                }}
              />
            </label>
            <label>
              <span
                style={{
                  display: 'block',
                  fontSize: '11px',
                  color: 'var(--text-tertiary)',
                  marginBottom: 4,
                }}
              >
                Max
              </span>
              <input
                type="number"
                step="0.1"
                data-testid="demo-edit-sigma-max"
                value={sigmaMax}
                onChange={(e) => setSigmaMax(e.target.value)}
                style={{
                  ...inputStyle,
                  borderColor: maxError ? 'var(--danger-border)' : undefined,
                }}
              />
            </label>
            <label>
              <span
                style={{
                  display: 'block',
                  fontSize: '11px',
                  color: 'var(--text-tertiary)',
                  marginBottom: 4,
                }}
              >
                Default
              </span>
              <input
                type="number"
                step="0.1"
                data-testid="demo-edit-sigma-default"
                value={sigmaDefault}
                onChange={(e) => setSigmaDefault(e.target.value)}
                style={{
                  ...inputStyle,
                  borderColor: defError ? 'var(--danger-border)' : undefined,
                }}
              />
            </label>
          </div>
          {minError && (
            <div data-testid="demo-edit-min-error" style={errorTextStyle}>
              {minError}
            </div>
          )}
          {maxError && (
            <div data-testid="demo-edit-max-error" style={errorTextStyle}>
              {maxError}
            </div>
          )}
          {defError && (
            <div data-testid="demo-edit-default-error" style={errorTextStyle}>
              {defError}
            </div>
          )}
        </div>
      </div>

      <EditorFormSaveError message={saveError} />
      <EditorFormFooter
        saving={saving}
        saveDisabled={!dirty}
        onCancel={onCancel}
        onSave={() => void handleSave()}
        cancelTestId="demo-edit-cancel"
        saveTestId="demo-edit-save"
      />
    </div>
  );
}
