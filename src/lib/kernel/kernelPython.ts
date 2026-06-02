// Source-of-truth Python for the `useKernel` runWithTests path (US-199 / US-200).
//
// US-198 only exposes a single `POST /api/code/run` cell-execution endpoint,
// so `runWithTests` is implemented client-side by compiling a self-contained
// Python harness that reproduces the Pyodide worker's RUNNER_PY contract
// (src/lib/pyodide/runnerPython.ts) on the real IPython kernel:
//
//   - user code is exec'd ONCE into a *persistent* per-lesson namespace
//     (`__ai_lesson_globals`) that survives across runs in the same kernel
//     session (parity with the worker's lessonGlobals proxy);
//   - each test is exec'd in an isolated `dict(__ai_lesson_globals)` copy so
//     one test can never see another's mutations;
//   - per-test stdout/stderr is captured into a throwaway sink (so test output
//     never leaks into the cell's stdout — same as RUNNER_PY);
//   - an AssertionError's message is surfaced as `assertionDetail`; any other
//     exception fails just that test with its traceback; and an error in the
//     user code fails ALL tests with the shared traceback.
//
// Because `__ai_lesson_globals` is a top-level kernel name (lazily created the
// first time the harness runs), it persists between runs within a session and
// is wiped either by a kernel restart (`POST /api/code/reset`) or by running
// `RESET_NAMESPACE_CELL` below — both mirror the worker's `resetNamespace`.
//
// The harness emits its structured payload on stdout as a single sentinel line
// (`<marker>:<base64-json>`) so it can never collide with user output and
// survives newline-free NDJSON streaming. The hook strips that line back out
// of stdout before returning, leaving only the user code's own output.

/** Sentinel prefix the harness prints its base64 JSON payload behind. */
export const KERNEL_TEST_RESULT_MARKER = '__AI_KERNEL_TEST_RESULTS__:';

/**
 * Cell that resets the persistent per-lesson namespace in place (parity with
 * the worker's `__ai_reset_namespace`). Clearing in place — rather than
 * rebinding — keeps any already-captured reference valid, and the `NameError`
 * guard means this is also a safe no-op cold start before any harness has run.
 */
export const RESET_NAMESPACE_CELL = `
try:
    __ai_lesson_globals.clear()
    __ai_lesson_globals['__name__'] = '__main__'
except NameError:
    __ai_lesson_globals = {'__name__': '__main__'}
`;

interface HarnessTest {
  name: string;
  body: string;
}

/**
 * Build a self-contained Python cell that runs `code` then `tests`, mirroring
 * the Pyodide RUNNER_PY contract. When `captureLiveImage` is true the harness
 * also captures the most-recent matplotlib figure as base64 PNG (parity with
 * the worker's `captureLiveImage` path used by Sandbox).
 *
 * The user code and tests are passed in as a base64-encoded JSON payload so no
 * amount of quoting / escaping in user input can break the surrounding Python.
 */
export function buildTestHarness(
  code: string,
  tests: HarnessTest[],
  captureLiveImage = false,
): string {
  const payload = JSON.stringify({
    code: code ?? '',
    tests: (tests ?? []).map((t) => ({ name: t.name, body: t.body })),
    capture: Boolean(captureLiveImage),
  });
  const b64 = encodeBase64Utf8(payload);

  return `
import json as __ai_json, base64 as __ai_b64, io as __ai_io, traceback as __ai_tb, contextlib as __ai_cl

# Persistent per-lesson namespace: created once per kernel session and reused
# across every run so user-defined names survive (parity with the Pyodide
# worker's __ai_lesson_globals). Wiped by RESET_NAMESPACE_CELL / kernel restart.
try:
    __ai_lesson_globals
except NameError:
    __ai_lesson_globals = {'__name__': '__main__'}


def __ai_run_tests(__user_code, __tests, __capture):
    results = []
    # User code runs ONCE in the shared namespace. It is NOT output-redirected,
    # so its prints reach the cell stdout just like a plain run.
    try:
        exec(__user_code, __ai_lesson_globals)
    except Exception:
        tb = __ai_tb.format_exc()
        # An error in the user's code fails EVERY test with the shared trace.
        for __t in __tests:
            results.append({
                'name': __t['name'],
                'passed': False,
                'traceback': tb,
                'assertionDetail': None,
            })
        return results, None
    for __t in __tests:
        test_ns = dict(__ai_lesson_globals)
        sink = __ai_io.StringIO()
        try:
            with __ai_cl.redirect_stdout(sink), __ai_cl.redirect_stderr(sink):
                exec(__t['body'], test_ns)
            results.append({
                'name': __t['name'],
                'passed': True,
                'traceback': None,
                'assertionDetail': None,
            })
        except AssertionError as __e:
            detail = str(__e) if str(__e) else None
            results.append({
                'name': __t['name'],
                'passed': False,
                'traceback': __ai_tb.format_exc(),
                'assertionDetail': detail,
            })
        except Exception:
            results.append({
                'name': __t['name'],
                'passed': False,
                'traceback': __ai_tb.format_exc(),
                'assertionDetail': None,
            })
    png = None
    if __capture:
        try:
            import matplotlib as __ai_mpl
            __ai_mpl.use('AGG')
            import matplotlib.pyplot as __ai_plt
            nums = __ai_plt.get_fignums()
            if nums:
                buf = __ai_io.BytesIO()
                __ai_plt.figure(nums[-1]).savefig(buf, format='png', bbox_inches='tight', dpi=110)
                png = __ai_b64.b64encode(buf.getvalue()).decode('ascii')
                __ai_plt.close('all')
        except Exception:
            png = None
    return results, png


__ai_payload = __ai_json.loads(__ai_b64.b64decode('${b64}').decode('utf-8'))
__ai_results, __ai_png = __ai_run_tests(
    __ai_payload['code'], __ai_payload['tests'], __ai_payload['capture'],
)
__ai_out = {'testResults': __ai_results, 'png': __ai_png}
print('${KERNEL_TEST_RESULT_MARKER}' + __ai_b64.b64encode(__ai_json.dumps(__ai_out).encode('utf-8')).decode('ascii'))
`;
}

/** UTF-8-safe base64 encode that works in both browser and node test envs. */
function encodeBase64Utf8(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf-8').toString('base64');
  }
  // Browser fallback: encode UTF-8 bytes before btoa (which is latin1-only).
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
