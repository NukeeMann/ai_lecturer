// Source-of-truth Python for the Pyodide worker's per-lesson namespace and
// custom test runner. Lives in a non-worker module so vitest unit tests can
// load Pyodide in Node, install this exact source, and verify the contracts
// (namespace persistence, namespace reset, test runner isolation) without
// bringing up a Web Worker.
//
// The worker installs this once via `runPythonAsync(RUNNER_PY)` and then
// reuses three top-level names from it:
//   - `__ai_lesson_globals` : dict shared by every Python widget in a lesson
//   - `__ai_reset_namespace`: clears the dict in-place (proxy stays valid)
//   - `__ai_run_tests`      : exec's user code in lessonGlobals, then exec's
//                              each test in a fresh `dict(lessonGlobals)` copy
export const RUNNER_PY = `
import sys as _sys
import io as _io
import traceback as _tb
import contextlib as _cl

__ai_lesson_globals = {'__name__': '__main__'}

def __ai_reset_namespace():
    __ai_lesson_globals.clear()
    __ai_lesson_globals['__name__'] = '__main__'

def __ai_run_tests(__user_code, __tests):
    results = []
    try:
        exec(__user_code, __ai_lesson_globals)
    except Exception:
        tb = _tb.format_exc()
        for t in __tests:
            results.append({
                'name': t['name'],
                'passed': False,
                'traceback': tb,
                'assertionDetail': None,
            })
        return results
    for t in __tests:
        test_ns = dict(__ai_lesson_globals)
        sink = _io.StringIO()
        try:
            with _cl.redirect_stdout(sink), _cl.redirect_stderr(sink):
                exec(t['body'], test_ns)
            results.append({
                'name': t['name'],
                'passed': True,
                'traceback': None,
                'assertionDetail': None,
            })
        except AssertionError as e:
            tb = _tb.format_exc()
            detail = str(e) if str(e) else None
            results.append({
                'name': t['name'],
                'passed': False,
                'traceback': tb,
                'assertionDetail': detail,
            })
        except Exception:
            tb = _tb.format_exc()
            results.append({
                'name': t['name'],
                'passed': False,
                'traceback': tb,
                'assertionDetail': None,
            })
    return results
`;
