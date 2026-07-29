'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, X } from 'lucide-react';

import { Confetti } from '@/components/Confetti';
import { MarkdownInline } from '@/components/MarkdownInline';
import { shuffledIndices } from '@/widgets/shuffle';

import type { QuizData } from './schema';
import {
  getOptionState,
  shouldShowCheck,
  shouldShowX,
  type OptionState,
} from './optionState';

export interface QuizProgressKey {
  courseSlug: string;
  lessonSlug: string;
  sectionId: string;
}

export interface QuizWidgetProps {
  data: QuizData;
  onCorrect?: () => void;
  /**
   * When true, the widget was already completed before this mount (e.g. user is
   * re-entering the lesson). Suppresses the success confetti burst on the next
   * correct submission so animations only celebrate first-time wins.
   */
  alreadyCompleted?: boolean;
  /**
   * When provided, the widget persists `{ done: true }` on first correct
   * submission so the lesson page can detect completion across reloads.
   */
  progressKey?: QuizProgressKey;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const bodyStyle: CSSProperties = {
  padding: 'var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-5)',
};

const questionStyle: CSSProperties = {
  fontSize: 'var(--fs-md)',
  fontWeight: 500,
  color: 'var(--text)',
  lineHeight: 1.4,
};

const optionsStackStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

const letterStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-tertiary)',
  fontSize: 'var(--fs-sm)',
  width: 18,
  flexShrink: 0,
};

const optionTextBase: CSSProperties = {
  flex: 1,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
  lineHeight: 1.5,
};

const actionsRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
};

const explanationStyle: CSSProperties = {
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4) var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const explanationTitleStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
};

const explanationBodyStyle: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
  lineHeight: 1.65,
};

const buttonBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 36,
  padding: '0 var(--space-5)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  cursor: 'pointer',
  border: '1px solid transparent',
  transition: 'background-color 120ms, border-color 120ms, color 120ms',
};

function setsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

export function QuizWidget({
  data,
  onCorrect,
  alreadyCompleted,
  progressKey,
}: QuizWidgetProps) {
  const [selected, setSelected] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [everSubmitted, setEverSubmitted] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [confettiTrigger, setConfettiTrigger] = useState(0);
  const confettiOriginRef = useRef<HTMLDivElement | null>(null);
  const confettiFiredRef = useRef(false);
  // Identity order on first render → matches SSR output (no hydration mismatch).
  // Shuffled in the effect below, once per mount, so answer positions vary each visit.
  const [displayOrder, setDisplayOrder] = useState<number[]>(() =>
    data.options.map((_, i) => i),
  );

  useEffect(() => {
    setDisplayOrder(shuffledIndices(data.options.length));
  }, [data.options]);

  const correctSet = useMemo(() => new Set(data.correct), [data.correct]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggleOption(i: number) {
    if (submitted) return;
    if (data.multiSelect) {
      setSelected((prev) =>
        prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i],
      );
    } else {
      setSelected([i]);
    }
  }

  function handleSubmit() {
    if (selected.length === 0) return;
    setSubmitted(true);
    setEverSubmitted(true);
    if (setsEqual(selected, data.correct)) {
      onCorrect?.();
      if (progressKey) {
        void patchQuizDone(progressKey);
      }
      if (!alreadyCompleted && !confettiFiredRef.current) {
        confettiFiredRef.current = true;
        setConfettiTrigger((n) => n + 1);
      }
    }
  }

  function handleTryAgain() {
    setSelected([]);
    setSubmitted(false);
    setHovered(null);
  }

  const optionStyle = (state: OptionState, isHovered: boolean): CSSProperties => {
    let border = '1px solid var(--border-strong)';
    let background = 'var(--bg-elevated)';

    if (state === 'correct') {
      border = '1px solid var(--success-border)';
      background = 'var(--success-subtle)';
    } else if (state === 'incorrect') {
      border = '1px solid var(--danger-border)';
      background = 'var(--danger-subtle)';
    } else if (state === 'selected') {
      border = '1px solid var(--accent)';
      background = 'var(--accent-subtle)';
    } else if (state === 'idle' && isHovered) {
      border = '1px solid var(--accent-border)';
      background = 'var(--accent-subtle)';
    }

    return {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      width: '100%',
      padding: 'var(--space-4) var(--space-5)',
      border,
      background,
      borderRadius: 'var(--radius-md)',
      cursor: submitted ? 'default' : 'pointer',
      textAlign: 'left',
      transition: 'border-color 120ms, background-color 120ms',
    };
  };

  const optionTextStyle = (state: OptionState): CSSProperties => {
    let color = 'var(--text)';
    let weight = 400;
    if (state === 'correct') {
      weight = 500;
    } else if (state === 'incorrect') {
      // keep default color; selected wrong option stays readable
    } else if (state === 'selected') {
      weight = 500;
    } else if (state === 'dimmed') {
      color = 'var(--text-tertiary)';
    }
    return { ...optionTextBase, color, fontWeight: weight };
  };

  const optionLetterStyle = (state: OptionState): CSSProperties => {
    const color =
      state === 'dimmed' ? 'var(--text-quaternary)' : 'var(--text-tertiary)';
    return { ...letterStyle, color };
  };

  const submitDisabled = !submitted && selected.length === 0;
  const submitButtonStyle: CSSProperties = submitted
    ? {
        ...buttonBase,
        background: 'transparent',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-strong)',
      }
    : {
        ...buttonBase,
        background: submitDisabled ? 'var(--bg-active)' : 'var(--accent)',
        color: submitDisabled ? 'var(--text-tertiary)' : 'var(--text-on-accent)',
        cursor: submitDisabled ? 'not-allowed' : 'pointer',
        opacity: submitDisabled ? 0.7 : 1,
      };

  return (
    <div data-quiz-body style={bodyStyle} ref={confettiOriginRef}>
      <Confetti trigger={confettiTrigger} originRef={confettiOriginRef} />
      <div data-quiz-question style={questionStyle}>
        <MarkdownInline>{data.question}</MarkdownInline>
      </div>

      <div
        role={data.multiSelect ? 'group' : 'radiogroup'}
        aria-label="Answer options"
        style={optionsStackStyle}
      >
        {displayOrder.map((i, displayPos) => {
          const option = data.options[i];
          const isSelected = selectedSet.has(i);
          const isCorrect = correctSet.has(i);
          const stateInput = {
            submitted,
            isSelected,
            isCorrect,
            multiSelect: data.multiSelect,
          };
          const state = getOptionState(stateInput);
          const showCheck = shouldShowCheck(stateInput);
          const showX = shouldShowX(stateInput);

          return (
            <button
              key={i}
              type="button"
              role={data.multiSelect ? 'checkbox' : 'radio'}
              aria-checked={isSelected}
              aria-disabled={submitted}
              data-quiz-option={i}
              data-state={state}
              onClick={() => toggleOption(i)}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((cur) => (cur === i ? null : cur))}
              style={optionStyle(state, hovered === i)}
            >
              <span style={optionLetterStyle(state)}>
                {LETTERS[displayPos] ?? `${displayPos + 1}`}
              </span>
              <span style={optionTextStyle(state)}>
                <MarkdownInline>{option}</MarkdownInline>
              </span>
              {showCheck && (
                <Check
                  size={16}
                  aria-hidden
                  style={{ color: 'var(--success)', flexShrink: 0 }}
                />
              )}
              {showX && (
                <X
                  size={16}
                  aria-hidden
                  style={{ color: 'var(--danger)', flexShrink: 0 }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div style={actionsRowStyle}>
        {submitted ? (
          <button
            type="button"
            data-quiz-try-again
            onClick={handleTryAgain}
            style={submitButtonStyle}
          >
            Try again
          </button>
        ) : (
          <button
            type="button"
            data-quiz-submit
            onClick={handleSubmit}
            disabled={submitDisabled}
            style={submitButtonStyle}
          >
            Submit
          </button>
        )}
      </div>

      {everSubmitted && (
        <div data-quiz-explanation style={explanationStyle}>
          <div style={explanationTitleStyle}>Explanation</div>
          <div style={explanationBodyStyle}>
            <MarkdownInline>{data.explanation}</MarkdownInline>
          </div>
        </div>
      )}
    </div>
  );
}

async function patchQuizDone(key: QuizProgressKey): Promise<void> {
  try {
    await fetch('/api/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseSlug: key.courseSlug,
        lessonSlug: key.lessonSlug,
        sectionState: { [key.sectionId]: { done: true } },
      }),
    });
  } catch {
    // Persistence is non-fatal — UI still reflects success in-session.
  }
}
