import { describe, it, expect, vi } from 'vitest';
import { bottomBarNextAction } from './bottomBarNext';

describe('bottomBarNextAction (US-164)', () => {
  it('calls completion mutator once then navigates when lesson is NOT finished', async () => {
    const markComplete = vi.fn();
    const navigate = vi.fn();

    await bottomBarNextAction({
      finished: false,
      markComplete,
      navigate,
    });

    expect(markComplete).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('skips the completion mutator and only navigates when lesson IS finished', async () => {
    const markComplete = vi.fn();
    const navigate = vi.fn();

    await bottomBarNextAction({
      finished: true,
      markComplete,
      navigate,
    });

    expect(markComplete).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('awaits the completion mutator before navigating (order matters)', async () => {
    const order: string[] = [];
    const markComplete = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('mark');
    });
    const navigate = vi.fn(() => {
      order.push('nav');
    });

    await bottomBarNextAction({
      finished: false,
      markComplete,
      navigate,
    });

    expect(order).toEqual(['mark', 'nav']);
  });

  it('navigates exactly once even if invoked back-to-back (idempotent guard lives in caller)', async () => {
    const markComplete = vi.fn();
    const navigate = vi.fn();

    await bottomBarNextAction({
      finished: true,
      markComplete,
      navigate,
    });
    await bottomBarNextAction({
      finished: true,
      markComplete,
      navigate,
    });

    expect(markComplete).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(2);
  });
});
