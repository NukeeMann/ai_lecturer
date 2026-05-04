// Splits a Pyodide `PythonError` (or any thrown value) into the structured
// shape the Output panel renders: a one-liner `<Type>: <message>` plus the
// full traceback for the expandable details section. Pyodide's `PythonError`
// exposes a `.type` string property (the exception class name) and a `.message`
// containing the formatted Python traceback that ends in `<Type>: <msg>`.
// Non-Python exceptions (e.g. JS errors) fall through with no `errorType`.

export interface FormattedPythonError {
  /** Full multi-line traceback, ready for an expandable <pre>. */
  traceback: string;
  /** Python exception class name (e.g. "ValueError"). Undefined for non-Python errors. */
  errorType?: string;
  /** Single-line exception message (text after `<Type>:` on the last frame). */
  errorMessage?: string;
}

interface MaybePyError {
  type?: unknown;
  message?: unknown;
  toString?: () => string;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract `errorType` + `errorMessage` from a Pyodide `PythonError`.
 *
 * For SyntaxError-style multi-line trailers ("ValueError: line1\n  line2") we
 * only keep the first line as the headline message — the rest stays in the
 * traceback for the expandable view.
 */
export function extractPythonError(err: unknown): FormattedPythonError {
  if (!err || typeof err !== 'object') {
    return { traceback: String(err ?? '') };
  }
  const e = err as MaybePyError;
  const traceback =
    typeof e.message === 'string' && e.message.length > 0
      ? e.message
      : typeof e.toString === 'function'
        ? e.toString()
        : String(err);

  const errorType = typeof e.type === 'string' && e.type.length > 0 ? e.type : undefined;

  let errorMessage: string | undefined;
  if (errorType) {
    const lines = traceback.split(/\r?\n/);
    const headRe = new RegExp(`^${escapeForRegex(errorType)}(?::\\s*(.*))?$`);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;
      const m = line.match(headRe);
      if (m) {
        errorMessage = (m[1] ?? '').trim();
        break;
      }
    }
  }

  return { traceback, errorType, errorMessage };
}
