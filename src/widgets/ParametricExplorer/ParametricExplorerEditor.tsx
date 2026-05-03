'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
import {
  ParametricExplorerDataSchema,
  type ParametricExplorerData,
  type ParametricExplorerParam,
} from './schema';

export interface ParametricExplorerEditorProps {
  initial: ParametricExplorerData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: ParametricExplorerData, sources?: Source[]) => Promise<void>;
}

function flattenIssues(error: z.ZodError<unknown>): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
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

const paramCardStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  background: 'var(--bg-elevated)',
};

const paramRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'var(--space-2)',
};

const smallLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: '11px',
  color: 'var(--text-tertiary)',
  marginBottom: 4,
};

const smallButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-xs)',
  cursor: 'pointer',
};

interface PythonEditorProps {
  initial: string;
  onChange: (value: string) => void;
  testId: string;
}

function PythonEditor({ initial, onChange, testId }: PythonEditorProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!parentRef.current) return;
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });
    const view = new EditorView({
      parent: parentRef.current,
      state: EditorState.create({
        doc: initial,
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
    // Mount once with the given initial doc; parent re-keys to remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={parentRef} data-testid={testId} style={cmContainerStyle} />;
}

function defaultForType(type: ParametricExplorerParam['type']): ParametricExplorerParam {
  if (type === 'slider') {
    return { name: 'x', label: 'X', type: 'slider', min: 0, max: 10, step: 1, default: 0 };
  }
  if (type === 'select') {
    return {
      name: 'mode',
      label: 'Mode',
      type: 'select',
      options: ['a', 'b'],
      default: 'a',
    };
  }
  return { name: 'flag', label: 'Flag', type: 'toggle', default: false };
}

export function ParametricExplorerEditor({
  initial,
  initialSources,
  onCancel,
  onSave,
}: ParametricExplorerEditorProps) {
  const [setupCode, setSetupCode] = useState(initial.setupCode);
  const [renderCode, setRenderCode] = useState(initial.renderCode);
  const [params, setParams] = useState<ParametricExplorerParam[]>(initial.params);
  const [outputType, setOutputType] = useState<'plot' | 'value' | 'both'>(
    initial.outputType,
  );
  const [debounceMs, setDebounceMs] = useState<string>(
    initial.debounceMs !== undefined ? String(initial.debounceMs) : '',
  );
  const [sources, setSources] = useState<Source[] | undefined>(initialSources);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const current: ParametricExplorerData = useMemo(() => {
    const obj: ParametricExplorerData = {
      setupCode,
      renderCode,
      params,
      outputType,
    };
    const dbn = Number(debounceMs);
    if (debounceMs.trim() !== '' && Number.isFinite(dbn) && dbn > 0) {
      obj.debounceMs = Math.floor(dbn);
    }
    return obj;
  }, [setupCode, renderCode, params, outputType, debounceMs]);

  const dirty = useMemo(() => {
    if (JSON.stringify(current) !== JSON.stringify(initial)) return true;
    return JSON.stringify(sources ?? null) !== JSON.stringify(initialSources ?? null);
  }, [current, initial, sources, initialSources]);

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    const result = ParametricExplorerDataSchema.safeParse(current);
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

  const updateParam = useCallback(
    (index: number, patch: Partial<ParametricExplorerParam>) => {
      setParams((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], ...patch } as ParametricExplorerParam;
        return next;
      });
    },
    [],
  );

  const removeParam = useCallback((index: number) => {
    setParams((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addParam = useCallback((type: ParametricExplorerParam['type']) => {
    setParams((prev) => [...prev, defaultForType(type)]);
  }, []);

  return (
    <div
      data-testid="parametric-explorer-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div style={formBodyStyle}>
        <div style={fieldStyle}>
          <span style={labelStyle}>Output type</span>
          <div style={{ display: 'inline-flex', gap: 4 }}>
            {(['plot', 'value', 'both'] as const).map((t) => (
              <button
                key={t}
                type="button"
                data-testid={`pexp-edit-output-${t}`}
                onClick={() => setOutputType(t)}
                style={{
                  ...smallButtonStyle,
                  background:
                    outputType === t ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
                  color:
                    outputType === t ? 'var(--accent-text)' : 'var(--text-secondary)',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <label style={fieldStyle}>
          <span style={labelStyle}>Debounce (ms, default 150)</span>
          <input
            type="number"
            data-testid="pexp-edit-debounce"
            value={debounceMs}
            onChange={(e) => setDebounceMs(e.target.value)}
            style={inputStyle}
            placeholder="150"
          />
          {errors.debounceMs && (
            <div style={errorTextStyle}>{errors.debounceMs}</div>
          )}
        </label>

        <div style={fieldStyle}>
          <span style={labelStyle}>Setup code (Python — runs once per session)</span>
          <PythonEditor
            initial={setupCode}
            onChange={setSetupCode}
            testId="pexp-edit-setup-code"
          />
        </div>

        <div style={fieldStyle}>
          <span style={labelStyle}>Render code (Python — runs on each param change)</span>
          <PythonEditor
            initial={renderCode}
            onChange={setRenderCode}
            testId="pexp-edit-render-code"
          />
        </div>

        <div style={fieldStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}
          >
            <span style={{ ...labelStyle, marginBottom: 0 }}>Parameters</span>
            <div style={{ display: 'inline-flex', gap: 4 }}>
              <button
                type="button"
                data-testid="pexp-edit-add-slider"
                onClick={() => addParam('slider')}
                style={smallButtonStyle}
              >
                <Plus size={12} aria-hidden /> slider
              </button>
              <button
                type="button"
                data-testid="pexp-edit-add-select"
                onClick={() => addParam('select')}
                style={smallButtonStyle}
              >
                <Plus size={12} aria-hidden /> select
              </button>
              <button
                type="button"
                data-testid="pexp-edit-add-toggle"
                onClick={() => addParam('toggle')}
                style={smallButtonStyle}
              >
                <Plus size={12} aria-hidden /> toggle
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {params.map((p, idx) => (
              <div key={idx} style={paramCardStyle}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span
                    style={{
                      fontSize: 'var(--fs-xs)',
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {p.type}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeParam(idx)}
                    aria-label="Remove param"
                    data-testid={`pexp-edit-remove-${idx}`}
                    style={{
                      ...smallButtonStyle,
                      borderColor: 'transparent',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    <Trash2 size={12} aria-hidden />
                  </button>
                </div>
                <div style={paramRowStyle}>
                  <label>
                    <span style={smallLabelStyle}>Name</span>
                    <input
                      type="text"
                      data-testid={`pexp-edit-name-${idx}`}
                      value={p.name}
                      onChange={(e) => updateParam(idx, { name: e.target.value })}
                      style={inputStyle}
                    />
                  </label>
                  <label>
                    <span style={smallLabelStyle}>Label</span>
                    <input
                      type="text"
                      data-testid={`pexp-edit-label-${idx}`}
                      value={p.label}
                      onChange={(e) => updateParam(idx, { label: e.target.value })}
                      style={inputStyle}
                    />
                  </label>
                </div>

                {p.type === 'slider' && (
                  <>
                    <div style={paramRowStyle}>
                      <label>
                        <span style={smallLabelStyle}>Min</span>
                        <input
                          type="number"
                          step="any"
                          data-testid={`pexp-edit-min-${idx}`}
                          value={p.min ?? ''}
                          onChange={(e) =>
                            updateParam(idx, { min: Number(e.target.value) })
                          }
                          style={inputStyle}
                        />
                      </label>
                      <label>
                        <span style={smallLabelStyle}>Max</span>
                        <input
                          type="number"
                          step="any"
                          data-testid={`pexp-edit-max-${idx}`}
                          value={p.max ?? ''}
                          onChange={(e) =>
                            updateParam(idx, { max: Number(e.target.value) })
                          }
                          style={inputStyle}
                        />
                      </label>
                    </div>
                    <div style={paramRowStyle}>
                      <label>
                        <span style={smallLabelStyle}>Step</span>
                        <input
                          type="number"
                          step="any"
                          data-testid={`pexp-edit-step-${idx}`}
                          value={p.step ?? ''}
                          onChange={(e) =>
                            updateParam(idx, { step: Number(e.target.value) })
                          }
                          style={inputStyle}
                        />
                      </label>
                      <label>
                        <span style={smallLabelStyle}>Default</span>
                        <input
                          type="number"
                          step="any"
                          data-testid={`pexp-edit-default-${idx}`}
                          value={typeof p.default === 'number' ? p.default : 0}
                          onChange={(e) =>
                            updateParam(idx, { default: Number(e.target.value) })
                          }
                          style={inputStyle}
                        />
                      </label>
                    </div>
                  </>
                )}

                {p.type === 'select' && (
                  <>
                    <label>
                      <span style={smallLabelStyle}>
                        Options (comma-separated)
                      </span>
                      <input
                        type="text"
                        data-testid={`pexp-edit-options-${idx}`}
                        value={(p.options ?? []).join(',')}
                        onChange={(e) =>
                          updateParam(idx, {
                            options: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter((s) => s.length > 0),
                          })
                        }
                        style={inputStyle}
                      />
                    </label>
                    <label>
                      <span style={smallLabelStyle}>Default</span>
                      <input
                        type="text"
                        data-testid={`pexp-edit-default-${idx}`}
                        value={typeof p.default === 'string' ? p.default : ''}
                        onChange={(e) =>
                          updateParam(idx, { default: e.target.value })
                        }
                        style={inputStyle}
                      />
                    </label>
                  </>
                )}

                {p.type === 'toggle' && (
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <input
                      type="checkbox"
                      data-testid={`pexp-edit-default-${idx}`}
                      checked={Boolean(p.default)}
                      onChange={(e) =>
                        updateParam(idx, { default: e.target.checked })
                      }
                    />
                    <span
                      style={{
                        fontSize: 'var(--fs-sm)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Default on
                    </span>
                  </label>
                )}
              </div>
            ))}
          </div>
        </div>

        <SourcesField sources={sources} onChange={setSources} />
      </div>

      <EditorFormSaveError message={saveError} />
      <EditorFormFooter
        saving={saving}
        saveDisabled={!dirty}
        onCancel={onCancel}
        onSave={() => void handleSave()}
        cancelTestId="pexp-edit-cancel"
        saveTestId="pexp-edit-save"
      />
    </div>
  );
}
