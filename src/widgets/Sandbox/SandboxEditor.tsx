'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties } from 'react';
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
import type { CodeInput, CodeOutputMedia } from '../Code/schema';
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

const rowHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 6,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  marginBottom: 6,
};

const rowBodyStyle: CSSProperties = {
  padding: 'var(--space-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  marginBottom: 'var(--space-3)',
  background: 'var(--bg-subtle)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
};

const removeButtonStyle: CSSProperties = {
  width: 24,
  height: 24,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
  flexShrink: 0,
};

const addButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'transparent',
  border: '1px dashed var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-xs)',
  fontWeight: 500,
  padding: '6px 10px',
  cursor: 'pointer',
  marginTop: 4,
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  padding: '6px 8px',
  width: 'auto',
  flexShrink: 0,
};

const subLabelStyle: CSSProperties = {
  ...labelStyle,
  marginBottom: 4,
  textTransform: 'none',
  letterSpacing: 0,
  fontSize: '11.5px',
};

type InputRow = CodeInput & { rowId: string };

function makeRowId(): string {
  return `i-${Math.random().toString(36).slice(2, 9)}`;
}

function inputsToRows(inputs: CodeInput[] | undefined): InputRow[] {
  return (inputs ?? []).map((i) => ({ ...i, rowId: makeRowId() }));
}

function rowsToInputs(rows: InputRow[]): CodeInput[] {
  return rows.map((row) => {
    const { rowId, ...rest } = row;
    void rowId;
    return rest as CodeInput;
  });
}

function blankInputForKind(kind: CodeInput['kind']): CodeInput {
  switch (kind) {
    case 'image':
      return { kind: 'image', src: '' };
    case 'video':
      return { kind: 'video', src: '' };
    case 'file':
      return { kind: 'file', src: '', filename: '' };
    case 'text':
      return { kind: 'text', content: '' };
  }
}

function blankOutputForKind(kind: CodeOutputMedia['kind']): CodeOutputMedia {
  switch (kind) {
    case 'image':
      return { kind: 'image', src: '' };
    case 'video':
      return { kind: 'video', src: '' };
  }
}

interface InputRowEditorProps {
  index: number;
  row: InputRow;
  onChange: (next: InputRow) => void;
  onRemove: () => void;
  errors: FieldErrors;
}

function InputRowEditor({ index, row, onChange, onRemove, errors }: InputRowEditorProps) {
  const srcError = errors[`inputs.${index}.src`];
  const filenameError = errors[`inputs.${index}.filename`];
  const contentError = errors[`inputs.${index}.content`];
  return (
    <div data-testid="sandbox-edit-input-row" data-input-index={index}>
      <div style={rowHeaderStyle}>
        <select
          data-testid="sandbox-edit-input-kind"
          data-input-index={index}
          value={row.kind}
          onChange={(e) =>
            onChange({
              rowId: row.rowId,
              ...blankInputForKind(e.target.value as CodeInput['kind']),
            })
          }
          style={selectStyle}
        >
          <option value="image">image</option>
          <option value="video">video</option>
          <option value="file">file</option>
          <option value="text">text</option>
        </select>
        <span style={{ flex: 1, fontSize: '12px', color: 'var(--text-tertiary)' }}>
          Input #{index + 1}
        </span>
        <button
          type="button"
          data-testid="sandbox-edit-input-remove"
          data-input-index={index}
          onClick={onRemove}
          aria-label={`Remove input ${index + 1}`}
          style={removeButtonStyle}
        >
          <Trash2 size={13} aria-hidden />
        </button>
      </div>
      <div style={rowBodyStyle}>
        {row.kind === 'text' ? (
          <>
            <label>
              <span style={subLabelStyle}>Label (optional)</span>
              <input
                type="text"
                data-testid="sandbox-edit-input-label"
                data-input-index={index}
                value={row.label ?? ''}
                onChange={(e) =>
                  onChange({ ...row, label: e.target.value || undefined })
                }
                style={inputStyle}
              />
            </label>
            <label>
              <span style={subLabelStyle}>Content</span>
              <textarea
                data-testid="sandbox-edit-input-content"
                data-input-index={index}
                value={row.content}
                onChange={(e) => onChange({ ...row, content: e.target.value })}
                style={{
                  ...inputStyle,
                  minHeight: 70,
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12.5px',
                  resize: 'vertical',
                  borderColor: contentError ? 'var(--danger-border)' : undefined,
                }}
              />
              {contentError && <div style={errorTextStyle}>{contentError}</div>}
            </label>
          </>
        ) : (
          <>
            <label>
              <span style={subLabelStyle}>src (URL or /path)</span>
              <input
                type="text"
                data-testid="sandbox-edit-input-src"
                data-input-index={index}
                value={row.src}
                onChange={(e) => onChange({ ...row, src: e.target.value })}
                style={{
                  ...inputStyle,
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12.5px',
                  borderColor: srcError ? 'var(--danger-border)' : undefined,
                }}
              />
              {srcError && <div style={errorTextStyle}>{srcError}</div>}
            </label>
            {row.kind === 'file' ? (
              <label>
                <span style={subLabelStyle}>filename (mounted at /inputs/&lt;filename&gt;)</span>
                <input
                  type="text"
                  data-testid="sandbox-edit-input-filename"
                  data-input-index={index}
                  value={row.filename}
                  onChange={(e) => onChange({ ...row, filename: e.target.value })}
                  style={{
                    ...inputStyle,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12.5px',
                    borderColor: filenameError ? 'var(--danger-border)' : undefined,
                  }}
                />
                {filenameError && <div style={errorTextStyle}>{filenameError}</div>}
              </label>
            ) : (
              <label>
                <span style={subLabelStyle}>filename override (optional)</span>
                <input
                  type="text"
                  data-testid="sandbox-edit-input-filename"
                  data-input-index={index}
                  value={row.filename ?? ''}
                  onChange={(e) =>
                    onChange({ ...row, filename: e.target.value || undefined })
                  }
                  style={{
                    ...inputStyle,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12.5px',
                  }}
                />
              </label>
            )}
            {row.kind === 'image' && (
              <label>
                <span style={subLabelStyle}>alt (optional)</span>
                <input
                  type="text"
                  data-testid="sandbox-edit-input-alt"
                  data-input-index={index}
                  value={row.alt ?? ''}
                  onChange={(e) =>
                    onChange({ ...row, alt: e.target.value || undefined })
                  }
                  style={inputStyle}
                />
              </label>
            )}
            <label>
              <span style={subLabelStyle}>caption (optional)</span>
              <input
                type="text"
                data-testid="sandbox-edit-input-caption"
                data-input-index={index}
                value={row.caption ?? ''}
                onChange={(e) =>
                  onChange({ ...row, caption: e.target.value || undefined })
                }
                style={inputStyle}
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
}

interface OutputMediaEditorProps {
  value: CodeOutputMedia | undefined;
  onChange: (next: CodeOutputMedia | undefined) => void;
  errors: FieldErrors;
}

function OutputMediaEditor({ value, onChange, errors }: OutputMediaEditorProps) {
  const srcError = errors['outputMedia.src'];
  return (
    <div data-testid="sandbox-edit-output-media">
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 'var(--space-3)',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          data-testid="sandbox-edit-output-enabled"
          checked={Boolean(value)}
          onChange={(e) =>
            onChange(e.target.checked ? blankOutputForKind('image') : undefined)
          }
        />
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>
          Show output media
        </span>
      </label>
      {value && (
        <div style={rowBodyStyle}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <select
              data-testid="sandbox-edit-output-kind"
              value={value.kind}
              onChange={(e) =>
                onChange(blankOutputForKind(e.target.value as CodeOutputMedia['kind']))
              }
              style={selectStyle}
            >
              <option value="image">image</option>
              <option value="video">video</option>
            </select>
            {value.kind === 'image' && (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  data-testid="sandbox-edit-output-live"
                  checked={Boolean(value.live)}
                  onChange={(e) =>
                    onChange({ ...value, live: e.target.checked || undefined })
                  }
                />
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>
                  Live (swap with matplotlib figure on Run)
                </span>
              </label>
            )}
          </div>
          <label>
            <span style={subLabelStyle}>src (URL or /path)</span>
            <input
              type="text"
              data-testid="sandbox-edit-output-src"
              value={value.src}
              onChange={(e) => onChange({ ...value, src: e.target.value })}
              style={{
                ...inputStyle,
                fontFamily: 'var(--font-mono)',
                fontSize: '12.5px',
                borderColor: srcError ? 'var(--danger-border)' : undefined,
              }}
            />
            {srcError && <div style={errorTextStyle}>{srcError}</div>}
          </label>
          {value.kind === 'image' && (
            <label>
              <span style={subLabelStyle}>alt (optional)</span>
              <input
                type="text"
                data-testid="sandbox-edit-output-alt"
                value={value.alt ?? ''}
                onChange={(e) =>
                  onChange({ ...value, alt: e.target.value || undefined })
                }
                style={inputStyle}
              />
            </label>
          )}
          <label>
            <span style={subLabelStyle}>caption (optional)</span>
            <input
              type="text"
              data-testid="sandbox-edit-output-caption"
              value={value.caption ?? ''}
              onChange={(e) =>
                onChange({ ...value, caption: e.target.value || undefined })
              }
              style={inputStyle}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function SandboxEditor({ initial, initialSources, onCancel, onSave }: SandboxEditorProps) {
  const [starterCode, setStarterCode] = useState(initial.starterCode);
  const [encouragement, setEncouragement] = useState(initial.encouragement);
  const [inputRows, setInputRows] = useState<InputRow[]>(() => inputsToRows(initial.inputs));
  const [outputMedia, setOutputMedia] = useState<CodeOutputMedia | undefined>(initial.outputMedia);
  const [requiresPackages, setRequiresPackages] = useState<string>(
    (initial.requiresPackages ?? []).join(', '),
  );
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

  const parsedPackages = useMemo<string[] | undefined>(() => {
    const items = requiresPackages
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return items.length > 0 ? items : undefined;
  }, [requiresPackages]);

  const current: SandboxData = useMemo(() => {
    const data: SandboxData = { starterCode, encouragement };
    if (inputRows.length > 0) data.inputs = rowsToInputs(inputRows);
    if (outputMedia) data.outputMedia = outputMedia;
    if (parsedPackages) data.requiresPackages = parsedPackages;
    return data;
  }, [starterCode, encouragement, inputRows, outputMedia, parsedPackages]);

  const dirty = useMemo(() => {
    if (JSON.stringify(current) !== JSON.stringify(initial)) return true;
    return JSON.stringify(sources ?? null) !== JSON.stringify(initialSources ?? null);
  }, [current, initial, sources, initialSources]);

  const handleAddInput = useCallback(() => {
    setInputRows((prev) => [
      ...prev,
      { rowId: makeRowId(), ...blankInputForKind('image') },
    ]);
  }, []);

  const handleChangeInput = useCallback((rowId: string, next: InputRow) => {
    setInputRows((prev) => prev.map((r) => (r.rowId === rowId ? next : r)));
  }, []);

  const handleRemoveInput = useCallback((rowId: string) => {
    setInputRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }, []);

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

        <label style={fieldStyle}>
          <span style={labelStyle}>Required packages (comma-separated)</span>
          <span
            data-testid="sandbox-edit-packages-hint"
            style={{
              ...subLabelStyle,
              color: 'var(--text-tertiary)',
              marginTop: -2,
            }}
          >
            Real pip packages that must be importable in the kernel runtime
            (e.g. cv2 = OpenCV). Checked before Run; not installed automatically.
          </span>
          <input
            type="text"
            data-testid="sandbox-edit-packages"
            value={requiresPackages}
            onChange={(e) => setRequiresPackages(e.target.value)}
            placeholder="e.g. cv2, matplotlib, numpy"
            style={{
              ...inputStyle,
              fontFamily: 'var(--font-mono)',
              fontSize: '12.5px',
            }}
          />
        </label>

        <div style={fieldStyle}>
          <span style={labelStyle}>Inputs</span>
          <div data-testid="sandbox-edit-inputs">
            {inputRows.map((row, i) => (
              <InputRowEditor
                key={row.rowId}
                index={i}
                row={row}
                onChange={(next) => handleChangeInput(row.rowId, next)}
                onRemove={() => handleRemoveInput(row.rowId)}
                errors={errors}
              />
            ))}
          </div>
          <button
            type="button"
            data-testid="sandbox-edit-add-input"
            onClick={handleAddInput}
            style={addButtonStyle}
          >
            <Plus size={12} aria-hidden /> Add input
          </button>
        </div>

        <div style={fieldStyle}>
          <span style={labelStyle}>Output media</span>
          <OutputMediaEditor
            value={outputMedia}
            onChange={setOutputMedia}
            errors={errors}
          />
        </div>

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
