import { describe, it, expect } from 'vitest';
import {
  resolveCheckboxChecked,
  applyCompletedTransition,
} from './Widget';

describe('resolveCheckboxChecked (US-080)', () => {
  it('reflects auto-completed=true when there is no manual override', () => {
    expect(
      resolveCheckboxChecked({ userOverride: null, completed: true }),
    ).toBe(true);
  });

  it('reflects auto-completed=false when there is no manual override', () => {
    expect(
      resolveCheckboxChecked({ userOverride: null, completed: false }),
    ).toBe(false);
  });

  it('explicit user override of false beats auto-completed=true', () => {
    expect(
      resolveCheckboxChecked({ userOverride: false, completed: true }),
    ).toBe(false);
  });

  it('explicit user override of true beats auto-completed=false', () => {
    expect(
      resolveCheckboxChecked({ userOverride: true, completed: false }),
    ).toBe(true);
  });
});

describe('applyCompletedTransition (US-080)', () => {
  it('clears the user override when completed flips false → true', () => {
    expect(applyCompletedTransition(false, false, true)).toBeNull();
  });

  it('clears the user override when completed flips true → false', () => {
    expect(applyCompletedTransition(true, true, false)).toBeNull();
  });

  it('preserves the user override when completed has not changed', () => {
    expect(applyCompletedTransition(false, true, true)).toBe(false);
    expect(applyCompletedTransition(true, false, false)).toBe(true);
  });
});
