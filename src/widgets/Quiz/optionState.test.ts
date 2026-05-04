import { describe, expect, test } from 'vitest';

import {
  getOptionState,
  shouldShowCheck,
  shouldShowX,
  type OptionStateInput,
} from './optionState';

const base: OptionStateInput = {
  submitted: false,
  isSelected: false,
  isCorrect: false,
  multiSelect: false,
};

describe('getOptionState — pre-submission', () => {
  test('idle when nothing selected', () => {
    expect(getOptionState({ ...base })).toBe('idle');
  });

  test('selected when chosen but not yet submitted', () => {
    expect(getOptionState({ ...base, isSelected: true })).toBe('selected');
  });

  test('multi-select pre-submission also reports selected', () => {
    expect(
      getOptionState({ ...base, isSelected: true, multiSelect: true }),
    ).toBe('selected');
  });
});

describe('getOptionState — multi-select after submission', () => {
  test('selected + correct → correct (green)', () => {
    expect(
      getOptionState({
        submitted: true,
        isSelected: true,
        isCorrect: true,
        multiSelect: true,
      }),
    ).toBe('correct');
  });

  test('selected + incorrect → incorrect (red)', () => {
    expect(
      getOptionState({
        submitted: true,
        isSelected: true,
        isCorrect: false,
        multiSelect: true,
      }),
    ).toBe('incorrect');
  });

  // Bug repro (US-057): unselected correct option should NOT be revealed as green.
  test('unselected + correct → dimmed (does not reveal answer key)', () => {
    expect(
      getOptionState({
        submitted: true,
        isSelected: false,
        isCorrect: true,
        multiSelect: true,
      }),
    ).toBe('dimmed');
  });

  test('unselected + incorrect → dimmed', () => {
    expect(
      getOptionState({
        submitted: true,
        isSelected: false,
        isCorrect: false,
        multiSelect: true,
      }),
    ).toBe('dimmed');
  });
});

describe('getOptionState — single-choice after submission (unchanged)', () => {
  test('correct option always renders correct, even if not selected', () => {
    expect(
      getOptionState({
        submitted: true,
        isSelected: false,
        isCorrect: true,
        multiSelect: false,
      }),
    ).toBe('correct');
    expect(
      getOptionState({
        submitted: true,
        isSelected: true,
        isCorrect: true,
        multiSelect: false,
      }),
    ).toBe('correct');
  });

  test('selected wrong option renders incorrect', () => {
    expect(
      getOptionState({
        submitted: true,
        isSelected: true,
        isCorrect: false,
        multiSelect: false,
      }),
    ).toBe('incorrect');
  });

  test('unselected wrong option renders dimmed', () => {
    expect(
      getOptionState({
        submitted: true,
        isSelected: false,
        isCorrect: false,
        multiSelect: false,
      }),
    ).toBe('dimmed');
  });
});

describe('shouldShowCheck — green check icon', () => {
  test('multi-select hides check on unselected correct (no answer reveal)', () => {
    expect(
      shouldShowCheck({
        submitted: true,
        isSelected: false,
        isCorrect: true,
        multiSelect: true,
      }),
    ).toBe(false);
  });

  test('multi-select shows check on selected correct', () => {
    expect(
      shouldShowCheck({
        submitted: true,
        isSelected: true,
        isCorrect: true,
        multiSelect: true,
      }),
    ).toBe(true);
  });

  test('single-choice still reveals check on the correct option', () => {
    expect(
      shouldShowCheck({
        submitted: true,
        isSelected: false,
        isCorrect: true,
        multiSelect: false,
      }),
    ).toBe(true);
  });

  test('hidden before submission', () => {
    expect(
      shouldShowCheck({
        submitted: false,
        isSelected: true,
        isCorrect: true,
        multiSelect: true,
      }),
    ).toBe(false);
  });
});

describe('shouldShowX — red X icon', () => {
  test('shown only on selected wrong options', () => {
    expect(
      shouldShowX({
        submitted: true,
        isSelected: true,
        isCorrect: false,
        multiSelect: true,
      }),
    ).toBe(true);
    expect(
      shouldShowX({
        submitted: true,
        isSelected: false,
        isCorrect: false,
        multiSelect: true,
      }),
    ).toBe(false);
  });

  test('hidden before submission', () => {
    expect(
      shouldShowX({
        submitted: false,
        isSelected: true,
        isCorrect: false,
        multiSelect: true,
      }),
    ).toBe(false);
  });
});
