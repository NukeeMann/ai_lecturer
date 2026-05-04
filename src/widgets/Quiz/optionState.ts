export type OptionState =
  | 'idle'
  | 'selected'
  | 'correct'
  | 'incorrect'
  | 'dimmed';

export interface OptionStateInput {
  submitted: boolean;
  isSelected: boolean;
  isCorrect: boolean;
  multiSelect: boolean;
}

export function getOptionState(input: OptionStateInput): OptionState {
  const { submitted, isSelected, isCorrect, multiSelect } = input;
  if (!submitted) return isSelected ? 'selected' : 'idle';
  if (multiSelect) {
    if (!isSelected) return 'dimmed';
    return isCorrect ? 'correct' : 'incorrect';
  }
  if (isCorrect) return 'correct';
  if (isSelected) return 'incorrect';
  return 'dimmed';
}

export function shouldShowCheck(input: OptionStateInput): boolean {
  const { submitted, isSelected, isCorrect, multiSelect } = input;
  if (!submitted || !isCorrect) return false;
  if (multiSelect) return isSelected;
  return true;
}

export function shouldShowX(input: OptionStateInput): boolean {
  const { submitted, isSelected, isCorrect } = input;
  return submitted && isSelected && !isCorrect;
}
