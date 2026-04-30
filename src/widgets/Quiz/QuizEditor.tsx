'use client';

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import type { z } from 'zod';

import {
  EditorFormFooter,
  EditorFormSaveError,
  errorTextStyle,
  fieldStyle,
  formBodyStyle,
  inputStyle,
  labelStyle,
  pickFieldError,
  textareaStyle,
  type FieldErrors,
} from '@/components/EditorForm';

import { QuizDataSchema, type QuizData } from './schema';

export interface QuizEditorProps {
  initial: QuizData;
  onCancel: () => void;
  onSave: (next: QuizData) => Promise<void>;
}

interface OptionRow {
  id: string;
  text: string;
  correct: boolean;
}

function makeRowId(): string {
  return `opt-${Math.random().toString(36).slice(2, 9)}`;
}

function dataToRows(data: QuizData): OptionRow[] {
  const correctSet = new Set(data.correct);
  return data.options.map((text, i) => ({
    id: makeRowId(),
    text,
    correct: correctSet.has(i),
  }));
}

function rowsToData(
  question: string,
  rows: OptionRow[],
  multiSelect: boolean,
  explanation: string,
): QuizData {
  return {
    question,
    options: rows.map((r) => r.text),
    correct: rows.flatMap((r, i) => (r.correct ? [i] : [])),
    multiSelect,
    explanation,
  };
}

function flattenIssues(error: z.ZodError<unknown>): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

const checkboxStyle: CSSProperties = {
  width: 16,
  height: 16,
  flexShrink: 0,
  cursor: 'pointer',
  accentColor: 'var(--accent)',
};

const optionRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: '6px 8px',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  marginBottom: 6,
};

const dragHandleStyle: CSSProperties = {
  cursor: 'grab',
  color: 'var(--text-quaternary)',
  flexShrink: 0,
  padding: '0 2px',
  touchAction: 'none',
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

const toggleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
};

export function QuizEditor({ initial, onCancel, onSave }: QuizEditorProps) {
  const [question, setQuestion] = useState(initial.question);
  const [rows, setRows] = useState<OptionRow[]>(() => dataToRows(initial));
  const [multiSelect, setMultiSelect] = useState(initial.multiSelect);
  const [explanation, setExplanation] = useState(initial.explanation);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dragIndexRef = useRef<number | null>(null);

  const current = useMemo(
    () => rowsToData(question, rows, multiSelect, explanation),
    [question, rows, multiSelect, explanation],
  );

  const dirty = useMemo(() => {
    if (current.question !== initial.question) return true;
    if (current.multiSelect !== initial.multiSelect) return true;
    if (current.explanation !== initial.explanation) return true;
    if (current.options.length !== initial.options.length) return true;
    if (current.options.some((opt, i) => opt !== initial.options[i])) return true;
    if (current.correct.length !== initial.correct.length) return true;
    const initialCorrect = [...initial.correct].sort((a, b) => a - b);
    const currentCorrect = [...current.correct].sort((a, b) => a - b);
    return currentCorrect.some((c, i) => c !== initialCorrect[i]);
  }, [current, initial]);

  const handleAddOption = useCallback(() => {
    setRows((prev) => [...prev, { id: makeRowId(), text: '', correct: false }]);
  }, []);

  const handleRemoveOption = useCallback((index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleEditOptionText = useCallback((index: number, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, text: value } : r)));
  }, []);

  const handleToggleCorrect = useCallback(
    (index: number, nextChecked: boolean) => {
      setRows((prev) => {
        if (multiSelect) {
          return prev.map((r, i) =>
            i === index ? { ...r, correct: nextChecked } : r,
          );
        }
        // Single-select: at most one row may be marked correct.
        return prev.map((r, i) => ({ ...r, correct: i === index ? nextChecked : false }));
      });
    },
    [multiSelect],
  );

  const handleToggleMultiSelect = useCallback((next: boolean) => {
    setMultiSelect(next);
    if (!next) {
      // Collapse to first correct row only, to keep schema invariant.
      setRows((prev) => {
        const firstCorrect = prev.findIndex((r) => r.correct);
        if (firstCorrect < 0) return prev;
        return prev.map((r, i) => ({ ...r, correct: i === firstCorrect }));
      });
    }
  }, []);

  const handleDragStart = useCallback(
    (index: number, e: React.DragEvent<HTMLElement>) => {
      dragIndexRef.current = index;
      e.dataTransfer.effectAllowed = 'move';
      // Required for some browsers to actually start the drag.
      try {
        e.dataTransfer.setData('text/plain', String(index));
      } catch {
        // Ignore — some test envs don't support setData.
      }
    },
    [],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((dropIndex: number) => {
    setRows((prev) => {
      const from = dragIndexRef.current;
      dragIndexRef.current = null;
      if (from === null || from === dropIndex) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(dropIndex, 0, moved);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    const result = QuizDataSchema.safeParse(current);
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

  const questionError = errors.question;
  const optionsError = pickFieldError(errors, 'options');
  const correctError = pickFieldError(errors, 'correct');
  const explanationError = errors.explanation;

  return (
    <div
      data-testid="quiz-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div style={formBodyStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Question</span>
          <textarea
            data-testid="quiz-edit-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            style={{
              ...textareaStyle,
              minHeight: 70,
              borderColor: questionError ? 'var(--danger-border)' : undefined,
            }}
          />
          {questionError && (
            <div data-testid="quiz-edit-question-error" style={errorTextStyle}>
              {questionError}
            </div>
          )}
        </label>

        <div style={fieldStyle}>
          <span style={labelStyle}>Options</span>
          <div data-testid="quiz-edit-options">
            {rows.map((row, i) => (
              <div
                key={row.id}
                data-testid="quiz-edit-option-row"
                data-option-index={i}
                draggable
                onDragStart={(e) => handleDragStart(i, e)}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(i)}
                style={optionRowStyle}
              >
                <span
                  data-testid="quiz-edit-drag-handle"
                  aria-label="Drag to reorder"
                  style={dragHandleStyle}
                >
                  <GripVertical size={14} aria-hidden />
                </span>
                <input
                  type="checkbox"
                  data-testid="quiz-edit-option-correct"
                  data-option-index={i}
                  checked={row.correct}
                  onChange={(e) => handleToggleCorrect(i, e.target.checked)}
                  aria-label={`Option ${i + 1} is correct`}
                  style={checkboxStyle}
                />
                <input
                  type="text"
                  data-testid="quiz-edit-option-text"
                  data-option-index={i}
                  value={row.text}
                  onChange={(e) => handleEditOptionText(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  style={{ ...inputStyle, padding: '6px 8px', flex: 1, minWidth: 0 }}
                />
                <button
                  type="button"
                  data-testid="quiz-edit-option-remove"
                  data-option-index={i}
                  onClick={() => handleRemoveOption(i)}
                  aria-label={`Remove option ${i + 1}`}
                  disabled={rows.length <= 2}
                  style={{
                    ...removeButtonStyle,
                    cursor: rows.length <= 2 ? 'not-allowed' : 'pointer',
                    opacity: rows.length <= 2 ? 0.4 : 1,
                  }}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>
            ))}
          </div>
          {optionsError && (
            <div data-testid="quiz-edit-options-error" style={errorTextStyle}>
              {optionsError}
            </div>
          )}
          {correctError && (
            <div data-testid="quiz-edit-correct-error" style={errorTextStyle}>
              At least one option must be marked correct.
            </div>
          )}
          <button
            type="button"
            data-testid="quiz-edit-add-option"
            onClick={handleAddOption}
            style={addButtonStyle}
          >
            <Plus size={12} aria-hidden /> Add option
          </button>
        </div>

        <label style={{ ...fieldStyle, ...toggleRowStyle }}>
          <input
            type="checkbox"
            data-testid="quiz-edit-multi-select"
            checked={multiSelect}
            onChange={(e) => handleToggleMultiSelect(e.target.checked)}
            style={checkboxStyle}
          />
          Multi-select (allow multiple correct answers)
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Explanation</span>
          <textarea
            data-testid="quiz-edit-explanation"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            style={{
              ...textareaStyle,
              minHeight: 90,
              borderColor: explanationError ? 'var(--danger-border)' : undefined,
            }}
          />
          {explanationError && (
            <div data-testid="quiz-edit-explanation-error" style={errorTextStyle}>
              {explanationError}
            </div>
          )}
        </label>
      </div>

      <EditorFormSaveError message={saveError} />
      <EditorFormFooter
        saving={saving}
        saveDisabled={!dirty}
        onCancel={onCancel}
        onSave={() => void handleSave()}
        cancelTestId="quiz-edit-cancel"
        saveTestId="quiz-edit-save"
      />
    </div>
  );
}
