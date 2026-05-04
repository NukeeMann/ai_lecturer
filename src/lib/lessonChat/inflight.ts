/**
 * In-flight chat-stream registry.
 *
 * The streaming POST handler stores an `AbortController` for each active
 * SSE response keyed by the server-generated `requestId`. The matching
 * `DELETE /api/lesson-chat/<requestId>` handler looks up the entry and
 * calls `abort()` to terminate the underlying connector stream
 * (which in turn kills the subprocess or aborts the SDK iterator).
 *
 * Entries are removed when the stream finishes (success, error, or abort)
 * to avoid leaking memory across long-lived server processes.
 */

const inflight = new Map<string, AbortController>();

export function registerInflight(requestId: string, controller: AbortController): void {
  inflight.set(requestId, controller);
}

export function unregisterInflight(requestId: string): void {
  inflight.delete(requestId);
}

export function abortInflight(requestId: string): boolean {
  const ctrl = inflight.get(requestId);
  if (!ctrl) return false;
  ctrl.abort();
  inflight.delete(requestId);
  return true;
}

export function _inflightSizeForTesting(): number {
  return inflight.size;
}

export function _resetInflightForTesting(): void {
  inflight.clear();
}
