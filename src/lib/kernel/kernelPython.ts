// Source-of-truth Python for the `useKernel` runWithTests path (US-199).
//
// US-198 only exposes a single `POST /api/code/run` cell-execution endpoint,
// so `runWithTests` is implemented client-side by compiling a self-contained
// Python harness that mirrors the Pyodide worker's `__ai_run_tests`
// (src/lib/pyodide/runnerPython.ts): it exec's the user code once, then exec's
// each test in a fresh copy of that namespace, collecting the SAME
// `TestResult` shape (`name`, `passed`, `traceback`, `assertionDetail`).
//
// The harness emits its structured payload on stdout as a single sentinel line
// (`<marker>:<base64-json>`) so it can never collide with user output and
// survives newline-free NDJSON streaming. The hook strips that line back out
// of stdout before returning, leaving only the user code's own output.

/** Sentinel prefix the harness prints its base64 JSON payload behind. */
export const KERNEL_TEST_RESULT_MARKER = '__AI_KERNEL_TEST_RESULTS__:';

interface HarnessTest {
  name: string;
  body: string;
}

/**
 * Build a self-contained Python cell that runs `code` then `tests`, mirroring
 * the Pyodide `__ai_run_tests` contract. When `captureLiveImage` is true the
 * harness also captures the most-recent matplotlib figure as base64 PNG
 * (parity with the worker's `captureLiveImage` path used by Sandbox).
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

__ai_payload = __ai_json.loads(__ai_b64.b64decode('${b64}').decode('utf-8'))
__ai_user_code = __ai_payload['code']
__ai_tests = __ai_payload['tests']
__ai_capture = __ai_payload['capture']
__ai_results = []
__ai_globals = {'__name__': '__main__'}
__ai_failed = False

try:
    exec(compile(__ai_user_code, '<user>', 'exec'), __ai_globals)
except Exception:
    __ai_user_tb = __ai_tb.format_exc()
    for __ai_t in __ai_tests:
        __ai_results.append({
            'name': __ai_t['name'],
            'passed': False,
            'traceback': __ai_user_tb,
            'assertionDetail': None,
        })
    __ai_failed = True

if not __ai_failed:
    for __ai_t in __ai_tests:
        __ai_ns = dict(__ai_globals)
        __ai_sink = __ai_io.StringIO()
        try:
            with __ai_cl.redirect_stdout(__ai_sink), __ai_cl.redirect_stderr(__ai_sink):
                exec(__ai_t['body'], __ai_ns)
            __ai_results.append({
                'name': __ai_t['name'],
                'passed': True,
                'traceback': None,
                'assertionDetail': None,
            })
        except AssertionError as __ai_e:
            __ai_detail = str(__ai_e) if str(__ai_e) else None
            __ai_results.append({
                'name': __ai_t['name'],
                'passed': False,
                'traceback': __ai_tb.format_exc(),
                'assertionDetail': __ai_detail,
            })
        except Exception:
            __ai_results.append({
                'name': __ai_t['name'],
                'passed': False,
                'traceback': __ai_tb.format_exc(),
                'assertionDetail': None,
            })

__ai_png = None
if __ai_capture:
    try:
        import matplotlib as __ai_mpl
        __ai_mpl.use('AGG')
        import matplotlib.pyplot as __ai_plt
        __ai_nums = __ai_plt.get_fignums()
        if __ai_nums:
            __ai_buf = __ai_io.BytesIO()
            __ai_plt.figure(__ai_nums[-1]).savefig(__ai_buf, format='png', bbox_inches='tight', dpi=110)
            __ai_png = __ai_b64.b64encode(__ai_buf.getvalue()).decode('ascii')
            __ai_plt.close('all')
    except Exception:
        __ai_png = None

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
