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
import { tokenize } from '@/lib/widgets/transcriptTokenize';

import {
  TranscriptClozeDataSchema,
  type TranscriptClozeBlank,
  type TranscriptClozeData,
} from './schema';

export interface TranscriptClozeEditorProps {
  initial: TranscriptClozeData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: TranscriptClozeData, sources?: Source[]) => Promise<void>;
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

const chipsRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  padding: 'var(--space-3)',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  minHeight: 60,
};

const chipBaseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
  borderWidth: 1,
  borderStyle: 'solid',
};

const hintInlineStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginTop: 8,
  padding: 'var(--space-2) var(--space-3)',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--fs-xs)',
};

const hintInputStyle: CSSProperties = {
  ...inputStyle,
  fontSize: 'var(--fs-xs)',
  padding: '4px 8px',
  fontFamily: 'inherit',
};

export function TranscriptClozeEditor({
  initial,
  initialSources,
  onCancel,
  onSave,
}: TranscriptClozeEditorProps) {
  const [audioPath, setAudioPath] = useState(initial.audioPath);
  const [title, setTitle] = useState(initial.title ?? '');
  const [instructions, setInstructions] = useState(initial.instructions ?? '');
  const [transcript, setTranscript] = useState(initial.transcript);
  const [blanks, setBlanks] = useState<TranscriptClozeBlank[]>(
    () => [...initial.blanks].sort((a, b) => a.wordIndex - b.wordIndex),
  );
  const [selectedChip, setSelectedChip] = useState<number | null>(null);
  const [sources, setSources] = useState<Source[] | undefined>(initialSources);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const tokens = useMemo(() => tokenize(transcript), [transcript]);
  const blanksByIndex = useMemo(() => {
    const m = new Map<number, TranscriptClozeBlank>();
    for (const b of blanks) m.set(b.wordIndex, b);
    return m;
  }, [blanks]);

  // When the transcript shrinks, drop now-out-of-range blanks.
  const safeBlanks = useMemo(
    () => blanks.filter((b) => b.wordIndex < tokens.length),
    [blanks, tokens.length],
  );

  const current: TranscriptClozeData = useMemo(() => {
    const out: TranscriptClozeData = {
      audioPath: audioPath.trim(),
      transcript,
      blanks: safeBlanks
        .slice()
        .sort((a, b) => a.wordIndex - b.wordIndex),
    };
    if (title.trim()) out.title = title.trim();
    if (instructions.trim()) out.instructions = instructions.trim();
    return out;
  }, [audioPath, instructions, safeBlanks, title, transcript]);

  const dirty = useMemo(() => {
    if (JSON.stringify(current) !== JSON.stringify(initial)) return true;
    return JSON.stringify(sources ?? null) !== JSON.stringify(initialSources ?? null);
  }, [current, initial, initialSources, sources]);

  const toggleBlank = useCallback(
    (wordIndex: number, defaultAnswer: string) => {
      setBlanks((prev) => {
        const exists = prev.find((b) => b.wordIndex === wordIndex);
        if (exists) {
          return prev.filter((b) => b.wordIndex !== wordIndex);
        }
        const next = [
          ...prev,
          { wordIndex, answer: defaultAnswer },
        ];
        next.sort((a, b) => a.wordIndex - b.wordIndex);
        return next;
      });
      setSelectedChip(wordIndex);
    },
    [],
  );

  const updateBlank = useCallback(
    (wordIndex: number, patch: Partial<TranscriptClozeBlank>) => {
      setBlanks((prev) =>
        prev.map((b) => (b.wordIndex === wordIndex ? { ...b, ...patch } : b)),
      );
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (saving) return;
    const result = TranscriptClozeDataSchema.safeParse(current);
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
      data-testid="transcript-cloze-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div style={formBodyStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Audio file path</span>
          <input
            type="text"
            data-testid="transcript-cloze-edit-path"
            value={audioPath}
            onChange={(e) => setAudioPath(e.target.value)}
            spellCheck={false}
            placeholder="e.g. lesson-01.wav"
            style={{
              ...inputStyle,
              fontFamily: 'var(--font-mono)',
              borderColor: errors.audioPath ? 'var(--danger-border)' : undefined,
            }}
          />
          <div style={helpTextStyle}>
            Path relative to <code>courses/&lt;slug&gt;/assets/audio/</code>.
          </div>
          {errors.audioPath && (
            <div data-testid="transcript-cloze-edit-path-error" style={errorTextStyle}>
              {errors.audioPath}
            </div>
          )}
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Title (optional)</span>
          <input
            type="text"
            data-testid="transcript-cloze-edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Instructions (optional)</span>
          <textarea
            data-testid="transcript-cloze-edit-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            style={{ ...textareaStyle, minHeight: 60 }}
          />
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Transcript</span>
          <textarea
            data-testid="transcript-cloze-edit-transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Paste the full transcript here. Each whitespace-tokenized word becomes a clickable chip below."
            style={{ ...textareaStyle, minHeight: 140 }}
          />
          {errors.transcript && (
            <div style={errorTextStyle}>{errors.transcript}</div>
          )}
        </label>

        <div style={fieldStyle}>
          <span style={labelStyle}>
            Click words to mark as blanks ({safeBlanks.length} selected)
          </span>
          <div style={chipsRowStyle} data-testid="transcript-cloze-chips">
            {tokens.length === 0 && (
              <span
                style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}
              >
                Enter a transcript to see word chips.
              </span>
            )}
            {tokens.map((tok) => {
              const isBlank = blanksByIndex.has(tok.index);
              const chipStyle: CSSProperties = {
                ...chipBaseStyle,
                background: isBlank ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
                color: isBlank ? 'var(--accent-text)' : 'var(--text)',
                borderColor: isBlank ? 'var(--accent-border)' : 'var(--border-strong)',
              };
              return (
                <button
                  type="button"
                  key={`chip-${tok.index}`}
                  data-testid={`transcript-cloze-chip-${tok.index}`}
                  data-chip-blank={isBlank ? 'true' : 'false'}
                  data-chip-index={tok.index}
                  onClick={() => toggleBlank(tok.index, tok.text || tok.raw)}
                  style={chipStyle}
                  aria-pressed={isBlank}
                  title={`Word #${tok.index + 1}`}
                >
                  {tok.raw}
                </button>
              );
            })}
          </div>
          {errors.blanks && (
            <div style={errorTextStyle}>{errors.blanks}</div>
          )}
        </div>

        {selectedChip !== null && blanksByIndex.has(selectedChip) && (
          <div style={hintInlineStyle} data-testid="transcript-cloze-blank-detail">
            <span style={{ color: 'var(--text-secondary)' }}>
              Blank for word #{selectedChip + 1} (
              <code>{tokens[selectedChip]?.raw ?? ''}</code>)
            </span>
            <label style={{ display: 'block' }}>
              <span style={{ ...labelStyle, marginBottom: 4 }}>Answer</span>
              <input
                type="text"
                data-testid="transcript-cloze-blank-answer"
                value={blanksByIndex.get(selectedChip)?.answer ?? ''}
                onChange={(e) => updateBlank(selectedChip, { answer: e.target.value })}
                style={hintInputStyle}
              />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ ...labelStyle, marginBottom: 4 }}>
                Hint (optional)
              </span>
              <input
                type="text"
                data-testid="transcript-cloze-blank-hint"
                value={blanksByIndex.get(selectedChip)?.hint ?? ''}
                onChange={(e) =>
                  updateBlank(selectedChip, {
                    hint: e.target.value.trim() ? e.target.value : undefined,
                  })
                }
                style={hintInputStyle}
              />
            </label>
          </div>
        )}

        <SourcesField sources={sources} onChange={setSources} />

        {errors._root && <div style={errorTextStyle}>{errors._root}</div>}
      </div>

      <EditorFormSaveError message={saveError} />
      <EditorFormFooter
        saving={saving}
        saveDisabled={!dirty}
        onCancel={onCancel}
        onSave={() => void handleSave()}
        cancelTestId="transcript-cloze-edit-cancel"
        saveTestId="transcript-cloze-edit-save"
      />
    </div>
  );
}
