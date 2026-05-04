/**
 * Convert the JSON-encoded `value` payload returned by the Pyodide worker
 * (`__pexp_json.dumps(result)` on the Python side) into the string the
 * ParametricExplorer value-output panel actually renders.
 *
 * Returns `null` when there is no incoming value (so the widget can fall back
 * to its em-dash placeholder), `'—'` when the parsed value is null/undefined,
 * and the stringified scalar otherwise.
 */
export function formatValueOutput(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || parsed === undefined) return '—';
    if (typeof parsed === 'number' || typeof parsed === 'boolean') {
      return String(parsed);
    }
    if (typeof parsed === 'string') return parsed;
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}
