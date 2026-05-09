'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Check, RotateCcw, X } from 'lucide-react';

import { AudioPlayerWidget } from '@/widgets/AudioPlayer/AudioPlayerWidget';
import {
  answersMatch,
  tokenize,
  type TranscriptToken,
} from '@/lib/widgets/transcriptTokenize';

import {
  TranscriptClozeDataSchema,
  type TranscriptClozeBlank,
  type TranscriptClozeData,
} from './schema';

export interface TranscriptClozeProgressKey {
  courseSlug: string;
  lessonSlug: string;
  sectionId: string;
}

export interface TranscriptClozeWidgetProps {
  data: TranscriptClozeData;
  courseSlug: string;
  progressKey?: TranscriptClozeProgressKey;
  onComplete?: () => void;
}

type BlankState = 'idle' | 'correct' | 'incorrect';

const wrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const instructionsStyle: CSSProperties = {
  padding: 'var(--space-3) var(--space-5)',
  borderTop: '1px solid var(--border)',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
};

const transcriptStyle: CSSProperties = {
  padding: 'var(--space-4) var(--space-5)',
  fontFamily: 'var(--font-prose)',
  fontSize: 'var(--fs-md)',
  lineHeight: 2.1,
  color: 'var(--text)',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 0,
};

const inputBaseStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.95em',
  padding: '2px 6px',
  margin: '0 2px',
  borderRadius: 'var(--radius-sm)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border-strong)',
  background: 'var(--bg-elevated)',
  color: 'var(--text)',
  outline: 'none',
  verticalAlign: 'baseline',
  boxSizing: 'border-box',
  minWidth: '3ch',
};

const correctAnswerHintStyle: CSSProperties = {
  display: 'block',
  fontSize: 'var(--fs-xs)',
  color: 'var(--text-tertiary)',
  fontFamily: 'var(--font-mono)',
  marginTop: 2,
};

const blankCellStyle: CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'center',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
};

const footerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
  padding: 'var(--space-3) var(--space-5)',
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
};

const submitButtonBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 var(--space-4)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  cursor: 'pointer',
};

const tryAgainButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 var(--space-3)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-xs)',
  cursor: 'pointer',
};

const scoreLabelStyle: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 600,
  color: 'var(--text)',
};

function borderColorFor(state: BlankState): string {
  if (state === 'correct') return 'var(--success-border)';
  if (state === 'incorrect') return 'var(--danger-border)';
  return 'var(--border-strong)';
}

function backgroundFor(state: BlankState): string {
  if (state === 'correct') return 'var(--success-subtle)';
  if (state === 'incorrect') return 'var(--danger-subtle)';
  return 'var(--bg-elevated)';
}

export function TranscriptClozeWidget({
  data: rawData,
  courseSlug,
  progressKey,
  onComplete,
}: TranscriptClozeWidgetProps) {
  const data = useMemo(() => TranscriptClozeDataSchema.parse(rawData), [rawData]);

  const tokens: TranscriptToken[] = useMemo(
    () => tokenize(data.transcript),
    [data.transcript],
  );

  const blanksByIndex = useMemo(() => {
    const m = new Map<number, TranscriptClozeBlank>();
    for (const b of data.blanks) m.set(b.wordIndex, b);
    return m;
  }, [data.blanks]);

  const [values, setValues] = useState<Record<number, string>>(() => {
    const out: Record<number, string> = {};
    for (const b of data.blanks) out[b.wordIndex] = '';
    return out;
  });

  const [submitted, setSubmitted] = useState(false);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Reset internal state if the section's data changes (e.g. saved from editor).
  useEffect(() => {
    const next: Record<number, string> = {};
    for (const b of data.blanks) next[b.wordIndex] = '';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues(next);
    setSubmitted(false);
  }, [data.blanks, data.transcript, data.audioPath]);

  const handleChange = useCallback((wordIndex: number, next: string) => {
    setValues((prev) => ({ ...prev, [wordIndex]: next }));
  }, []);

  const handleReset = useCallback(() => {
    const next: Record<number, string> = {};
    for (const b of data.blanks) next[b.wordIndex] = '';
    setValues(next);
    setSubmitted(false);
  }, [data.blanks]);

  const blanksFilled = useMemo(
    () => data.blanks.every((b) => (values[b.wordIndex] ?? '').trim().length > 0),
    [data.blanks, values],
  );

  const blankStates = useMemo<Record<number, BlankState>>(() => {
    const out: Record<number, BlankState> = {};
    for (const b of data.blanks) {
      if (!submitted) {
        out[b.wordIndex] = 'idle';
        continue;
      }
      const v = (values[b.wordIndex] ?? '').trim();
      out[b.wordIndex] = answersMatch(b.answer, v) ? 'correct' : 'incorrect';
    }
    return out;
  }, [data.blanks, submitted, values]);

  const correctCount = useMemo(
    () =>
      data.blanks.reduce(
        (n, b) => (blankStates[b.wordIndex] === 'correct' ? n + 1 : n),
        0,
      ),
    [data.blanks, blankStates],
  );

  const handleSubmit = useCallback(() => {
    if (submitted) return;
    if (!blanksFilled) return;
    setSubmitted(true);

    if (progressKey) {
      const total = data.blanks.length;
      const correct = data.blanks.reduce((n, b) => {
        const v = (values[b.wordIndex] ?? '').trim();
        return answersMatch(b.answer, v) ? n + 1 : n;
      }, 0);
      void persistScore(progressKey, { correct, total });
    }
    onCompleteRef.current?.();
  }, [blanksFilled, data.blanks, progressKey, submitted, values]);

  const submitDisabled = submitted || !blanksFilled;

  const submitButtonStyle: CSSProperties = useMemo(() => {
    if (submitted) {
      return {
        ...submitButtonBase,
        background: 'transparent',
        borderColor: 'var(--success-border)',
        color: 'var(--success)',
        cursor: 'default',
      };
    }
    return {
      ...submitButtonBase,
      background: submitDisabled ? 'var(--bg-active)' : 'var(--accent)',
      color: submitDisabled ? 'var(--text-tertiary)' : 'var(--text-on-accent)',
      cursor: submitDisabled ? 'not-allowed' : 'pointer',
      opacity: submitDisabled ? 0.7 : 1,
    };
  }, [submitDisabled, submitted]);

  return (
    <div data-testid="transcript-cloze-widget" style={wrapStyle}>
      <AudioPlayerWidget
        data={{ audioPath: data.audioPath, autoplay: false, title: data.title }}
        courseSlug={courseSlug}
      />

      {data.instructions && (
        <div
          data-testid="transcript-cloze-instructions"
          style={instructionsStyle}
        >
          {data.instructions}
        </div>
      )}

      <div data-testid="transcript-cloze-transcript" style={transcriptStyle}>
        {tokens.map((tok, i) => {
          const blank = blanksByIndex.get(tok.index);
          const space = i < tokens.length - 1 ? ' ' : '';
          if (!blank) {
            return (
              <span key={`tok-${tok.index}`} data-cloze-word>
                {tok.raw}
                {space}
              </span>
            );
          }
          const state = blankStates[tok.index] ?? 'idle';
          const value = values[tok.index] ?? '';
          const widthCh = Math.max(blank.answer.length, 4);
          const inputStyle: CSSProperties = {
            ...inputBaseStyle,
            width: `calc(${widthCh}ch + 14px)`,
            borderColor: borderColorFor(state),
            background: backgroundFor(state),
          };
          return (
            <span
              key={`tok-${tok.index}`}
              data-cloze-blank
              data-blank-index={tok.index}
              data-blank-state={state}
              style={blankCellStyle}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                <input
                  type="text"
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  autoComplete="off"
                  data-testid={`transcript-cloze-input-${tok.index}`}
                  aria-label={
                    blank.hint
                      ? `Blank ${tok.index + 1} (hint: ${blank.hint})`
                      : `Blank ${tok.index + 1}`
                  }
                  value={value}
                  disabled={submitted}
                  onChange={(e) => handleChange(tok.index, e.target.value)}
                  style={{ ...inputStyle, ['--w' as never]: `${widthCh}ch` }}
                />
                {state === 'correct' && (
                  <Check
                    size={14}
                    aria-hidden
                    data-testid={`transcript-cloze-icon-${tok.index}`}
                    style={{ color: 'var(--success)', marginLeft: 4 }}
                  />
                )}
                {state === 'incorrect' && (
                  <X
                    size={14}
                    aria-hidden
                    data-testid={`transcript-cloze-icon-${tok.index}`}
                    style={{ color: 'var(--danger)', marginLeft: 4 }}
                  />
                )}
              </span>
              {state === 'incorrect' && (
                <span
                  data-testid={`transcript-cloze-correct-${tok.index}`}
                  style={correctAnswerHintStyle}
                >
                  {blank.answer}
                </span>
              )}
              {!submitted && blank.hint && (
                <span
                  data-testid={`transcript-cloze-hint-${tok.index}`}
                  style={{
                    display: 'block',
                    fontSize: 'var(--fs-xs)',
                    color: 'var(--text-tertiary)',
                    fontStyle: 'italic',
                    marginTop: 2,
                  }}
                >
                  {blank.hint}
                </span>
              )}
              {space && <span aria-hidden>{space}</span>}
            </span>
          );
        })}
      </div>

      <div style={footerStyle}>
        <span style={scoreLabelStyle} data-testid="transcript-cloze-score">
          {submitted ? `${correctCount}/${data.blanks.length} correct` : ''}
        </span>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {submitted && (
            <button
              type="button"
              data-testid="transcript-cloze-try-again"
              onClick={handleReset}
              style={tryAgainButtonStyle}
            >
              <RotateCcw size={12} aria-hidden /> Try again
            </button>
          )}
          <button
            type="button"
            data-testid="transcript-cloze-submit"
            onClick={handleSubmit}
            disabled={submitDisabled}
            style={submitButtonStyle}
            aria-label={submitted ? 'Submitted' : 'Submit answers'}
          >
            {submitted ? (
              <>
                <Check size={14} aria-hidden /> Submitted
              </>
            ) : (
              'Submit'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

async function persistScore(
  key: TranscriptClozeProgressKey,
  score: { correct: number; total: number },
): Promise<void> {
  try {
    await fetch('/api/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseSlug: key.courseSlug,
        lessonSlug: key.lessonSlug,
        sectionState: {
          [key.sectionId]: { done: true, score },
        },
      }),
    });
  } catch {
    // Persistence is non-fatal.
  }
}
