'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
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
  textareaStyle,
  type FieldErrors,
} from '@/components/EditorForm';
import { SourcesField } from '@/components/Sources';
import type { Source } from '@/lib/schemas/lesson';

import {
  codeRunnerEditorTheme,
  codeRunnerHighlightStyle,
} from '../Code/CodeRunner';
import {
  CodeClozeDataSchema,
  type CodeClozeData,
  type CodeClozeFinalTest,
  type CodeClozeProgressiveHint,
  type CodeClozeSlot,
  type CodeClozeSlotValidation,
} from './schema';

export interface CodeClozeEditorProps {
  initial: CodeClozeData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: CodeClozeData, sources?: Source[]) => Promise<void>;
}

interface SlotRow extends CodeClozeSlot {
  rowId: string;
}

interface TestRow extends CodeClozeFinalTest {
  rowId: string;
}

interface HintRow extends CodeClozeProgressiveHint {
  rowId: string;
}

function makeRowId(): string {
  return `r-${Math.random().toString(36).slice(2, 9)}`;
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

const cardStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  background: 'var(--bg-elevated)',
  marginBottom: 6,
};

const cardHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
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

const subLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: '11px',
  color: 'var(--text-tertiary)',
  marginBottom: 4,
};

const expandToggleStyle: CSSProperties = {
  width: 22,
  height: 22,
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

const testBodyContainerStyle: CSSProperties = {
  ...cmContainerStyle,
  marginTop: 4,
};

interface PythonEditorProps {
  initial: string;
  onChange: (value: string) => void;
  testId?: string;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={parentRef} data-testid={testId} style={cmContainerStyle} />;
}

function defaultValidation(
  kind: CodeClozeSlotValidation['kind'],
): CodeClozeSlotValidation {
  if (kind === 'exact') return { kind: 'exact', value: '' };
  if (kind === 'regex') return { kind: 'regex', pattern: '' };
  return { kind: 'oneOf', values: [''] };
}

export function CodeClozeEditor({
  initial,
  initialSources,
  onCancel,
  onSave,
}: CodeClozeEditorProps) {
  const [taskMarkdown, setTaskMarkdown] = useState<string>(
    initial.taskMarkdown ?? '',
  );
  const [template, setTemplate] = useState<string>(initial.template);
  const [slots, setSlots] = useState<SlotRow[]>(() =>
    (initial.slots ?? []).map((s) => ({ ...s, rowId: makeRowId() })),
  );
  const [tests, setTests] = useState<TestRow[]>(() =>
    (initial.finalTests ?? []).map((t) => ({ ...t, rowId: makeRowId() })),
  );
  const [hints, setHints] = useState<HintRow[]>(() =>
    (initial.hints ?? []).map((h) => ({ ...h, rowId: makeRowId() })),
  );
  const [sources, setSources] = useState<Source[] | undefined>(initialSources);
  const [expandedTests, setExpandedTests] = useState<Record<string, boolean>>(
    {},
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const current: CodeClozeData = useMemo(() => {
    const obj: CodeClozeData = {
      template,
      slots: slots.map((s) => ({
        id: s.id,
        ...(s.hint ? { hint: s.hint } : {}),
        validation: s.validation,
      })),
    };
    if (taskMarkdown.trim()) obj.taskMarkdown = taskMarkdown;
    if (tests.length > 0) {
      obj.finalTests = tests.map((t) => ({
        name: t.name,
        body: t.body,
        hidden: t.hidden,
      }));
    }
    if (hints.length > 0) {
      obj.hints = hints.map((h) => ({
        revealAfterAttempts: h.revealAfterAttempts,
        markdown: h.markdown,
      }));
    }
    return obj;
  }, [taskMarkdown, template, slots, tests, hints]);

  const dirty = useMemo(() => {
    if (JSON.stringify(current) !== JSON.stringify(initial)) return true;
    return JSON.stringify(sources ?? null) !== JSON.stringify(initialSources ?? null);
  }, [current, initial, sources, initialSources]);

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    const result = CodeClozeDataSchema.safeParse(current);
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

  const addSlot = useCallback(() => {
    setSlots((prev) => [
      ...prev,
      {
        rowId: makeRowId(),
        id: '',
        validation: { kind: 'exact', value: '' },
      },
    ]);
  }, []);

  const updateSlot = useCallback(
    (rowId: string, patch: Partial<SlotRow>) => {
      setSlots((prev) =>
        prev.map((s) => (s.rowId === rowId ? { ...s, ...patch } : s)),
      );
    },
    [],
  );

  const removeSlot = useCallback((rowId: string) => {
    setSlots((prev) => prev.filter((s) => s.rowId !== rowId));
  }, []);

  const addTest = useCallback(() => {
    const row: TestRow = { rowId: makeRowId(), name: '', body: '', hidden: true };
    setTests((prev) => [...prev, row]);
    setExpandedTests((prev) => ({ ...prev, [row.rowId]: true }));
  }, []);

  const updateTestName = useCallback((rowId: string, value: string) => {
    setTests((prev) =>
      prev.map((t) => (t.rowId === rowId ? { ...t, name: value } : t)),
    );
  }, []);

  const updateTestBody = useCallback((rowId: string, value: string) => {
    setTests((prev) =>
      prev.map((t) => (t.rowId === rowId ? { ...t, body: value } : t)),
    );
  }, []);

  const removeTest = useCallback((rowId: string) => {
    setTests((prev) => prev.filter((t) => t.rowId !== rowId));
    setExpandedTests((prev) => {
      const copy = { ...prev };
      delete copy[rowId];
      return copy;
    });
  }, []);

  const toggleTest = useCallback((rowId: string) => {
    setExpandedTests((prev) => ({ ...prev, [rowId]: !prev[rowId] }));
  }, []);

  const addHint = useCallback(() => {
    setHints((prev) => [
      ...prev,
      { rowId: makeRowId(), revealAfterAttempts: prev.length + 1, markdown: '' },
    ]);
  }, []);

  const updateHint = useCallback((rowId: string, patch: Partial<HintRow>) => {
    setHints((prev) =>
      prev.map((h) => (h.rowId === rowId ? { ...h, ...patch } : h)),
    );
  }, []);

  const removeHint = useCallback((rowId: string) => {
    setHints((prev) => prev.filter((h) => h.rowId !== rowId));
  }, []);

  return (
    <div
      data-testid="code-cloze-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div style={formBodyStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Task description (markdown, optional)</span>
          <textarea
            data-testid="cloze-edit-task"
            value={taskMarkdown}
            onChange={(e) => setTaskMarkdown(e.target.value)}
            style={{
              ...textareaStyle,
              minHeight: 70,
              fontFamily: 'var(--font-mono)',
              fontSize: '12.5px',
            }}
          />
        </label>

        <div style={fieldStyle}>
          <span style={labelStyle}>
            Template (Python — use {'{{slotId}}'} for blanks)
          </span>
          <PythonEditor
            initial={initial.template}
            onChange={setTemplate}
            testId="cloze-edit-template"
          />
          {errors.template && <div style={errorTextStyle}>{errors.template}</div>}
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
            <span style={{ ...labelStyle, marginBottom: 0 }}>Slots</span>
          </div>
          <div data-testid="cloze-edit-slots">
            {slots.map((slot, i) => {
              const validation = slot.validation;
              return (
                <div key={slot.rowId} style={cardStyle} data-test-slot-index={i}>
                  <div style={cardHeaderStyle}>
                    <input
                      type="text"
                      data-testid={`cloze-edit-slot-id-${i}`}
                      value={slot.id}
                      placeholder="slotId"
                      onChange={(e) =>
                        updateSlot(slot.rowId, { id: e.target.value })
                      }
                      style={{
                        ...inputStyle,
                        flex: 1,
                        minWidth: 0,
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12.5px',
                      }}
                    />
                    <button
                      type="button"
                      data-testid={`cloze-edit-slot-remove-${i}`}
                      onClick={() => removeSlot(slot.rowId)}
                      aria-label={`Remove slot ${i + 1}`}
                      style={removeButtonStyle}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </div>

                  <label>
                    <span style={subLabelStyle}>Hint (shown on incorrect)</span>
                    <input
                      type="text"
                      data-testid={`cloze-edit-slot-hint-${i}`}
                      value={slot.hint ?? ''}
                      onChange={(e) =>
                        updateSlot(slot.rowId, {
                          hint: e.target.value || undefined,
                        })
                      }
                      style={inputStyle}
                    />
                  </label>

                  <label>
                    <span style={subLabelStyle}>Validation kind</span>
                    <select
                      data-testid={`cloze-edit-slot-kind-${i}`}
                      value={validation.kind}
                      onChange={(e) =>
                        updateSlot(slot.rowId, {
                          validation: defaultValidation(
                            e.target.value as CodeClozeSlotValidation['kind'],
                          ),
                        })
                      }
                      style={inputStyle}
                    >
                      <option value="exact">exact</option>
                      <option value="regex">regex</option>
                      <option value="oneOf">oneOf</option>
                    </select>
                  </label>

                  {validation.kind === 'exact' && (
                    <label>
                      <span style={subLabelStyle}>Expected value</span>
                      <input
                        type="text"
                        data-testid={`cloze-edit-slot-value-${i}`}
                        value={validation.value}
                        onChange={(e) =>
                          updateSlot(slot.rowId, {
                            validation: { kind: 'exact', value: e.target.value },
                          })
                        }
                        style={{
                          ...inputStyle,
                          fontFamily: 'var(--font-mono)',
                          fontSize: '12.5px',
                        }}
                      />
                    </label>
                  )}

                  {validation.kind === 'regex' && (
                    <label>
                      <span style={subLabelStyle}>Regex pattern</span>
                      <input
                        type="text"
                        data-testid={`cloze-edit-slot-pattern-${i}`}
                        value={validation.pattern}
                        onChange={(e) =>
                          updateSlot(slot.rowId, {
                            validation: {
                              kind: 'regex',
                              pattern: e.target.value,
                            },
                          })
                        }
                        style={{
                          ...inputStyle,
                          fontFamily: 'var(--font-mono)',
                          fontSize: '12.5px',
                        }}
                      />
                    </label>
                  )}

                  {validation.kind === 'oneOf' && (
                    <label>
                      <span style={subLabelStyle}>
                        Allowed values (comma-separated)
                      </span>
                      <input
                        type="text"
                        data-testid={`cloze-edit-slot-values-${i}`}
                        value={validation.values.join(',')}
                        onChange={(e) =>
                          updateSlot(slot.rowId, {
                            validation: {
                              kind: 'oneOf',
                              values: e.target.value
                                .split(',')
                                .map((v) => v.trim())
                                .filter((v) => v.length > 0),
                            },
                          })
                        }
                        style={{
                          ...inputStyle,
                          fontFamily: 'var(--font-mono)',
                          fontSize: '12.5px',
                        }}
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            data-testid="cloze-edit-add-slot"
            onClick={addSlot}
            style={addButtonStyle}
          >
            <Plus size={12} aria-hidden /> Add slot
          </button>
        </div>

        <div style={fieldStyle}>
          <span style={labelStyle}>Final tests (optional)</span>
          <div data-testid="cloze-edit-tests">
            {tests.map((test, i) => {
              const isExpanded = Boolean(expandedTests[test.rowId]);
              return (
                <div key={test.rowId} data-test-test-index={i}>
                  <div style={cardHeaderStyle}>
                    <button
                      type="button"
                      data-testid={`cloze-edit-test-toggle-${i}`}
                      onClick={() => toggleTest(test.rowId)}
                      aria-expanded={isExpanded}
                      style={expandToggleStyle}
                    >
                      {isExpanded ? (
                        <ChevronDown size={13} aria-hidden />
                      ) : (
                        <ChevronRight size={13} aria-hidden />
                      )}
                    </button>
                    <input
                      type="text"
                      data-testid={`cloze-edit-test-name-${i}`}
                      value={test.name}
                      onChange={(e) => updateTestName(test.rowId, e.target.value)}
                      placeholder="test_name"
                      style={{
                        ...inputStyle,
                        flex: 1,
                        minWidth: 0,
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12.5px',
                      }}
                    />
                    <button
                      type="button"
                      data-testid={`cloze-edit-test-remove-${i}`}
                      onClick={() => removeTest(test.rowId)}
                      aria-label={`Remove test ${i + 1}`}
                      style={removeButtonStyle}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </div>
                  {isExpanded && (
                    <div style={testBodyContainerStyle}>
                      <PythonEditor
                        initial={test.body}
                        onChange={(v) => updateTestBody(test.rowId, v)}
                        testId={`cloze-edit-test-body-${i}`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            data-testid="cloze-edit-add-test"
            onClick={addTest}
            style={addButtonStyle}
          >
            <Plus size={12} aria-hidden /> Add final test
          </button>
        </div>

        <div style={fieldStyle}>
          <span style={labelStyle}>Progressive hints (optional)</span>
          <div data-testid="cloze-edit-hints">
            {hints.map((hint, i) => (
              <div key={hint.rowId} style={cardStyle} data-test-hint-index={i}>
                <div style={cardHeaderStyle}>
                  <span style={{ ...subLabelStyle, marginBottom: 0 }}>
                    Reveal after
                  </span>
                  <input
                    type="number"
                    min={0}
                    data-testid={`cloze-edit-hint-after-${i}`}
                    value={hint.revealAfterAttempts}
                    onChange={(e) =>
                      updateHint(hint.rowId, {
                        revealAfterAttempts: Math.max(
                          0,
                          Math.floor(Number(e.target.value) || 0),
                        ),
                      })
                    }
                    style={{ ...inputStyle, width: 90 }}
                  />
                  <span style={{ ...subLabelStyle, marginBottom: 0 }}>
                    failed attempts
                  </span>
                  <button
                    type="button"
                    data-testid={`cloze-edit-hint-remove-${i}`}
                    onClick={() => removeHint(hint.rowId)}
                    aria-label={`Remove hint ${i + 1}`}
                    style={{ ...removeButtonStyle, marginLeft: 'auto' }}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>
                <textarea
                  data-testid={`cloze-edit-hint-md-${i}`}
                  value={hint.markdown}
                  onChange={(e) =>
                    updateHint(hint.rowId, { markdown: e.target.value })
                  }
                  placeholder="Hint markdown"
                  style={{ ...textareaStyle, minHeight: 56 }}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            data-testid="cloze-edit-add-hint"
            onClick={addHint}
            style={addButtonStyle}
          >
            <Plus size={12} aria-hidden /> Add hint
          </button>
        </div>

        <SourcesField sources={sources} onChange={setSources} />

        {errors._root && <div style={errorTextStyle}>{errors._root}</div>}
      </div>

      <EditorFormSaveError message={saveError} />
      <EditorFormFooter
        saving={saving}
        saveDisabled={!dirty}
        onCancel={onCancel}
        onSave={() => void handleSave()}
        cancelTestId="cloze-edit-cancel"
        saveTestId="cloze-edit-save"
      />
    </div>
  );
}
