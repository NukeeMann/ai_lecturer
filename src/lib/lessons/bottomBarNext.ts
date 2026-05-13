// US-164 — When the learner clicks the bottom-bar Next button, implicitly mark
// the current lesson completed (if not already), THEN navigate to the next
// lesson. Sharing the completion mutator with the explicit "Mark Complete"
// control keeps the persisted state and downstream UI effects identical.
//
// The handler is idempotent: a finished lesson stays finished, no toggle-off.

export interface BottomBarNextDeps {
  /** Whether the current lesson is already finished. */
  finished: boolean;
  /** Same completion mutator the explicit "Mark Complete" button calls. */
  markComplete: () => void | Promise<void>;
  /** Navigates to the resolved next-lesson target. */
  navigate: () => void;
}

/**
 * The bottom-bar Next click handler logic, extracted as a pure function so it
 * can be unit-tested without rendering the whole lesson page. Returns once the
 * (optional) mark-complete side effect has resolved AND navigation has fired.
 */
export async function bottomBarNextAction(
  deps: BottomBarNextDeps,
): Promise<void> {
  if (!deps.finished) {
    await deps.markComplete();
  }
  deps.navigate();
}
