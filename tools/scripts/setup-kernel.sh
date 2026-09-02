#!/usr/bin/env bash
# US-196: Provision the local Jupyter kernel runtime (CPU baseline).
#
# Creates a managed Python venv at ~/.ai-lecturer/py-runtime with a Jupyter
# kernel and the real ML/CV libraries so the Code/Sandbox widgets can execute
# actual PyTorch / TensorFlow / OpenCV instead of Pyodide in the browser.
#
# This is the CPU-only baseline (~1GB on first install). For CUDA/GPU
# acceleration run the opt-in `scripts/setup-kernel-cuda.sh` afterwards — it
# reinstalls torch (and, where available, tensorflow) with CUDA wheels and
# drops a `.cuda-enabled` marker that the server-side probe
# (`src/lib/server/kernelRuntime.ts`) auto-detects.
#
# Idempotent: re-running skips the venv creation and any baseline package that
# is already importable.
#
# Env vars:
#   AI_LECTURER_PY_RUNTIME   override the venv location (default
#                            ~/.ai-lecturer/py-runtime)
#   AI_LECTURER_FORCE_REBUILD=1  delete the venv and recreate it from scratch

set -euo pipefail

RUNTIME_DIR="${AI_LECTURER_PY_RUNTIME:-${HOME}/.ai-lecturer/py-runtime}"
VENV_PY="${RUNTIME_DIR}/bin/python"
VENV_PIP=("${VENV_PY}" -m pip)

log() { printf '[setup-kernel] %s\n' "$*"; }

# --- 1. Platform check -------------------------------------------------------
case "$(uname -s)" in
  Linux*) log "Detected Linux (or WSL2)." ;;
  Darwin*) log "Detected macOS." ;;
  *)
    log "Unsupported platform: $(uname -s). Linux/WSL2 is the tested target."
    exit 2
    ;;
esac

# --- 2. Python presence ------------------------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
  log "python3 not found on PATH. Install Python 3.10+ first."
  log "  Ubuntu/WSL2: sudo apt-get install -y python3 python3-venv python3-pip"
  exit 3
fi

# --- 3. Virtualenv (idempotent) ---------------------------------------------
if [[ "${AI_LECTURER_FORCE_REBUILD:-0}" == "1" ]]; then
  log "AI_LECTURER_FORCE_REBUILD=1 — removing ${RUNTIME_DIR}."
  rm -rf "${RUNTIME_DIR}"
fi

if [[ -x "${VENV_PY}" ]]; then
  log "venv already present at ${RUNTIME_DIR} — reusing it."
else
  log "Creating venv at ${RUNTIME_DIR}…"
  mkdir -p "$(dirname "${RUNTIME_DIR}")"
  python3 -m venv "${RUNTIME_DIR}"
fi

if [[ ! -x "${VENV_PY}" ]]; then
  log "venv python not found at ${VENV_PY} after creation. Is python3-venv installed?"
  log "  Ubuntu/WSL2: sudo apt-get install -y python3-venv"
  exit 4
fi

log "Upgrading pip/setuptools/wheel…"
"${VENV_PIP[@]}" install --upgrade pip setuptools wheel >/dev/null

# --- 4. Baseline install (idempotent per-package) ---------------------------
# `pip install` is itself idempotent (skips already-satisfied requirements),
# but the heavy wheels (torch ~750MB, tensorflow ~600MB) make a no-op re-run
# slow because pip still resolves them. Probe importability first and skip the
# whole step when everything is already present.
#
# torch / tensorflow are installed as CPU wheels here. The CUDA variants are an
# opt-in concern handled by scripts/setup-kernel-cuda.sh.
baseline_ready() {
  "${VENV_PY}" - <<'PY' >/dev/null 2>&1
import importlib
for mod in ("ipykernel", "jupyter_client", "numpy", "cv2", "matplotlib", "torch", "tensorflow"):
    importlib.import_module(mod)
PY
}

if baseline_ready; then
  log "Baseline packages already importable — skipping install."
else
  log "Installing baseline (ipykernel, jupyter_client, numpy, opencv-python, matplotlib)…"
  "${VENV_PIP[@]}" install \
    ipykernel \
    jupyter_client \
    numpy \
    opencv-python \
    matplotlib

  # CPU-only torch wheel. The PyTorch CPU index avoids pulling the multi-GB
  # CUDA runtime that the default wheel bundles on Linux.
  log "Installing CPU-wheel torch (~750MB, one-time)…"
  "${VENV_PIP[@]}" install torch --index-url https://download.pytorch.org/whl/cpu

  # TensorFlow's PyPI wheel is CPU-capable out of the box (GPU support is a
  # runtime concern gated on a working CUDA install).
  log "Installing tensorflow (~600MB, one-time)…"
  "${VENV_PIP[@]}" install tensorflow
fi

# --- 5. Register the Jupyter kernel (idempotent) ----------------------------
log "Registering the 'ai-lecturer' Jupyter kernel…"
"${VENV_PY}" -m ipykernel install --user \
  --name ai-lecturer --display-name "AI Lecturer (Python)" >/dev/null

# --- 6. Final sanity check ---------------------------------------------------
if baseline_ready; then
  log "Done. Runtime ready at ${RUNTIME_DIR}."
  log "Server-side probe: src/lib/server/kernelRuntime.ts (probeKernelRuntime)."
  log "Force CPU/CUDA: AI_LECTURER_KERNEL_DEVICE=cpu|cuda|auto (default auto)."
  log "Override venv path: AI_LECTURER_PY_RUNTIME=/path/to/py-runtime."
  log "For GPU acceleration run: bash scripts/setup-kernel-cuda.sh"
else
  log "Baseline packages still not importable after install. Check the pip log above."
  exit 5
fi
