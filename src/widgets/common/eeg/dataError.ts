// Readable formatting of widget data errors (Zod issues or thrown errors)
// for the shared error card. Node-safe.

import type { ZodError } from 'zod';

/** "path.to.field: message" lines (max `limit`), for an error card or log. */
export function formatZodIssues(error: ZodError, limit = 6): string[] {
  const lines = error.issues.slice(0, limit).map((i) => {
    const path = i.path.length > 0 ? i.path.join('.') : '(root)';
    return `${path}: ${i.message}`;
  });
  if (error.issues.length > limit) lines.push(`…and ${error.issues.length - limit} more`);
  return lines;
}

/** Error lines from anything thrown or returned by safeParse. */
export function describeDataError(err: unknown): string[] {
  if (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as ZodError).issues)) {
    return formatZodIssues(err as ZodError);
  }
  if (err instanceof Error) return [err.message];
  return [String(err)];
}
