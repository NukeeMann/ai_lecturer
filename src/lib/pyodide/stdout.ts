// Joins stdout/stderr chunks emitted by Pyodide's `setStdout({ batched })` /
// `setStderr({ batched })` callbacks. Pyodide's batched stream fires once per
// line and strips the trailing newline, so naively `chunks.join('')` collapses
// consecutive `print()` calls into one continuous run. Joining with `\n`
// restores per-line separation; CSS `white-space: pre-wrap` on the output panel
// then renders each line on its own row.
//
// Carriage-return handling: Pyodide's batched stream partitions on `\n` only,
// so a chunk may legitimately contain `\r` (e.g. progress-bar updates). Per
// terminal convention, `\r` rewinds the cursor to column 0; subsequent text on
// the same line overwrites prior text. We approximate that by dropping
// everything before the last `\r` on each line, which matches the common
// "in-place update" use case and prevents bare `\r` characters from rendering
// as spurious line breaks under `white-space: pre-wrap`.
export function formatStdoutChunks(chunks: string[]): string {
  if (chunks.length === 0) return '';
  return chunks
    .join('\n')
    .split('\n')
    .map((line) => {
      const lastCR = line.lastIndexOf('\r');
      return lastCR >= 0 ? line.slice(lastCR + 1) : line;
    })
    .join('\n');
}
