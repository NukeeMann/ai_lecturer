// US-111 — pure helpers for ordering generation-log lines for display.
// The Stage-5 generation log on `src/app/create/page.tsx` stores lines in
// chronological order (oldest first) but renders them reverse-chronological
// (newest first) so the latest entry is always visible at the top of the
// scroll panel without scrolling.

/**
 * Reverse a multi-line log string so the last line becomes the first.
 * A single trailing newline (typical for files written line-by-line) is
 * dropped before splitting so the reversed output doesn't gain a leading
 * blank line. Empty input is returned as-is.
 */
export function reverseLogLines(text: string): string {
  if (!text) return text;
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
  return trimmed.split('\n').reverse().join('\n');
}

/**
 * Reverse an in-memory array of live log lines (newest first). Returns a
 * new array; the input is left untouched.
 */
export function reverseLiveLogLines(lines: ReadonlyArray<string>): string[] {
  const out = lines.slice();
  out.reverse();
  return out;
}
