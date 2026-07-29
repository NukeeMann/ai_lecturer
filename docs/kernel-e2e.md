# Kernel end-to-end suite (US-205)

This suite proves the Option-2 migration end-to-end: it pushes the **real** ML/CV
libraries through the genuine Jupyter kernel and exercises every Code/Sandbox
flow. It is deliberately **un-skippable** — if the runtime is not provisioned it
fails loudly with an actionable message instead of silently skipping.

- Suite: `src/lib/server/kernelE2E.e2e.test.ts`
- Config: `vitest.e2e.config.ts` (separate from the default `vitest run`)
- Runtime probe: `src/lib/server/kernelRuntime.ts`
- Kernel bridge: `scripts/kernel/kernel_bridge.py`

## One-time prerequisite setup

The suite runs against the persistent US-196 runtime — a managed Python venv at
`~/.ai-lecturer/py-runtime` containing `ipykernel`, `jupyter_client`, `numpy`,
`opencv-python` (cv2), `matplotlib`, `torch`, and `tensorflow`. Provision it
**once** per host:

```bash
bash scripts/setup-kernel.sh
```

This downloads ~1.5 GB of wheels (torch ~750 MB, tensorflow ~600 MB) on first
run and is idempotent (re-running skips already-importable packages). For GPU
acceleration, follow with the opt-in `bash scripts/setup-kernel-cuda.sh`.

## Running the suite

```bash
npm run test:e2e
```

By default this resolves the venv python at `~/.ai-lecturer/py-runtime/bin/python`.
Point it elsewhere when the real libraries live in a different interpreter:

```bash
# Use a specific interpreter (must have cv2 + numpy + torch + tensorflow):
AI_LECTURER_E2E_PYTHON=/path/to/python npm run test:e2e

# Or point at a venv created at a non-default location:
AI_LECTURER_PY_RUNTIME=/path/to/py-runtime npm run test:e2e
```

The default `npm test` (`vitest run`) **excludes** `*.e2e.test.ts`, so the fast
unit suite stays green on hosts without the heavy runtime.

## What it covers

| AC | Test(s) |
| --- | --- |
| Real imports, no skip | `cv2` Canny on an input image, `numpy` reduce, `torch` tensor build + op, `tensorflow` constant + reduce |
| One-line health-check → actionable FAIL | `healthCheckRuntime()` in `beforeAll` + a named `health-check` test |
| Code Submit: real PASS **and** real FAIL | hidden-test harness asserts one genuine pass + one genuine fail (with `assertionDetail`) |
| Code: live figure | harness `captureLiveImage` returns a non-empty base64 PNG |
| Sandbox free-run via display_data | `%matplotlib inline` + `plt.show()` → bridge surfaces `images[]` |
| Stop interrupts a long cell | `interrupt()` → `KeyboardInterrupt`, kernel survives |
| Lesson switch / reset clears namespace | `reset()` and `RESET_NAMESPACE_CELL` both wipe user names |
| Runaway cell → 30s timeout → killed | infinite loop hits the 30s execution timeout, session reaped |
| No runtime → gentle error | forced-missing probe → `KernelRuntimeNotInstalledError` |

## Why it must fail (not skip) without the runtime

`scripts/setup-kernel.sh` installs the libraries once on the persistent host;
this suite then imports them for real on every run. A missing or half-provisioned
runtime is a real regression, so the health-check converts it into a red build
with a "run scripts/setup-kernel.sh" message — never a silent skip or pass.
