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

import {
  codeRunnerEditorTheme,
  codeRunnerHighlightStyle,
} from './CodeRunner';
import { CodeDataSchema, type CodeData, type CodeTest } from './schema';

export interface CodeEditorProps {
  initial: CodeData;
  onCancel: () => void;
  onSave: (next: CodeData) => Promise<void>;
}

interface TestRow extends CodeTest {
  rowId: string;
}

function makeRowId(): string {
  return `t-${Math.random().toString(36).slice(2, 9)}`;
}

function dataToTestRows(tests: CodeTest[]): TestRow[] {
  return tests.map((t) => ({ ...t, rowId: makeRowId() }));
}

function rowsToTests(rows: TestRow[]): CodeTest[] {
  return rows.map((row) => ({
    name: row.name,
    body: row.body,
    hidden: row.hidden,
  }));
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

const testRowHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 6,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  marginBottom: 6,
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

const testBodyContainerStyle: CSSProperties = {
  ...cmContainerStyle,
  marginBottom: 6,
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
    // Mount-once: initial change is forwarded above; consumers track their own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={parentRef} data-testid={testId} style={cmContainerStyle} />;
}

export function CodeEditor({ initial, onCancel, onSave }: CodeEditorProps) {
  const [taskMarkdown, setTaskMarkdown] = useState(initial.taskMarkdown);
  const [starterCode, setStarterCode] = useState(initial.starterCode);
  const [tests, setTests] = useState<TestRow[]>(() => dataToTestRows(initial.tests));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const current: CodeData = useMemo(
    () => ({
      taskMarkdown,
      starterCode,
      tests: rowsToTests(tests),
    }),
    [taskMarkdown, starterCode, tests],
  );

  const dirty = useMemo(
    () => JSON.stringify(current) !== JSON.stringify(initial),
    [current, initial],
  );

  const handleAddTest = useCallback(() => {
    const newRow: TestRow = {
      rowId: makeRowId(),
      name: '',
      body: '',
      hidden: true,
    };
    setTests((prev) => [...prev, newRow]);
    setExpanded((prev) => ({ ...prev, [newRow.rowId]: true }));
  }, []);

  const handleRemoveTest = useCallback((rowId: string) => {
    setTests((prev) => prev.filter((t) => t.rowId !== rowId));
    setExpanded((prev) => {
      const copy = { ...prev };
      delete copy[rowId];
      return copy;
    });
  }, []);

  const handleEditTestName = useCallback((rowId: string, value: string) => {
    setTests((prev) => prev.map((t) => (t.rowId === rowId ? { ...t, name: value } : t)));
  }, []);

  const handleEditTestBody = useCallback((rowId: string, value: string) => {
    setTests((prev) => prev.map((t) => (t.rowId === rowId ? { ...t, body: value } : t)));
  }, []);

  const toggleExpanded = useCallback((rowId: string) => {
    setExpanded((prev) => ({ ...prev, [rowId]: !prev[rowId] }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    const result = CodeDataSchema.safeParse(current);
    if (!result.success) {
      setErrors(flattenIssues(result.error));
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

  const taskError = errors.taskMarkdown;
  const starterError = errors.starterCode;

  return (
    <div
      data-testid="code-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div style={formBodyStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Task description (markdown)</span>
          <textarea
            data-testid="code-edit-task"
            value={taskMarkdown}
            onChange={(e) => setTaskMarkdown(e.target.value)}
            style={{
              ...textareaStyle,
              minHeight: 90,
              fontFamily: 'var(--font-mono)',
              fontSize: '12.5px',
              borderColor: taskError ? 'var(--danger-border)' : undefined,
            }}
          />
          {taskError && (
            <div data-testid="code-edit-task-error" style={errorTextStyle}>
              {taskError}
            </div>
          )}
        </label>

        <div style={fieldStyle}>
          <span style={labelStyle}>Starter code</span>
          <PythonEditor
            initial={initial.starterCode}
            onChange={setStarterCode}
            testId="code-edit-starter"
          />
          {starterError && (
            <div data-testid="code-edit-starter-error" style={errorTextStyle}>
              {starterError}
            </div>
          )}
        </div>

        <div style={fieldStyle}>
          <span style={labelStyle}>Tests</span>
          <div data-testid="code-edit-tests">
            {tests.map((test, i) => {
              const isExpanded = Boolean(expanded[test.rowId]);
              const nameError = errors[`tests.${i}.name`];
              const bodyError = errors[`tests.${i}.body`];
              return (
                <div key={test.rowId} data-testid="code-edit-test-row" data-test-index={i}>
                  <div style={testRowHeaderStyle}>
                    <button
                      type="button"
                      data-testid="code-edit-test-toggle"
                      data-test-index={i}
                      onClick={() => toggleExpanded(test.rowId)}
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? 'Collapse test body' : 'Expand test body'}
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
                      data-testid="code-edit-test-name"
                      data-test-index={i}
                      value={test.name}
                      onChange={(e) => handleEditTestName(test.rowId, e.target.value)}
                      placeholder="test_name"
                      style={{
                        ...inputStyle,
                        padding: '6px 8px',
                        flex: 1,
                        minWidth: 0,
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12.5px',
                        borderColor: nameError ? 'var(--danger-border)' : undefined,
                      }}
                    />
                    <button
                      type="button"
                      data-testid="code-edit-test-remove"
                      data-test-index={i}
                      onClick={() => handleRemoveTest(test.rowId)}
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
                        onChange={(value) => handleEditTestBody(test.rowId, value)}
                        testId={`code-edit-test-body-${i}`}
                      />
                    </div>
                  )}
                  {nameError && (
                    <div style={errorTextStyle}>{nameError}</div>
                  )}
                  {bodyError && (
                    <div style={errorTextStyle}>{bodyError}</div>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            data-testid="code-edit-add-test"
            onClick={handleAddTest}
            style={addButtonStyle}
          >
            <Plus size={12} aria-hidden /> Add test
          </button>
        </div>
      </div>

      <EditorFormSaveError message={saveError} />
      <EditorFormFooter
        saving={saving}
        saveDisabled={!dirty}
        onCancel={onCancel}
        onSave={() => void handleSave()}
        cancelTestId="code-edit-cancel"
        saveTestId="code-edit-save"
      />
    </div>
  );
}
