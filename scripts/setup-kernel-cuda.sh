#!/usr/bin/env bash
# US-196: Opt-in CUDA/GPU acceleration for the Jupyter kernel runtime.
#
# This script is NOT invoked automatically by `scripts/setup-kernel.sh`. It is
# only useful on hosts with an NVIDIA driver (nvidia-smi) and is modelled on
# `scripts/setup-stt-cuda.sh`. It reinstalls torch with CUDA wheels into the
# existing venv created by setup-kernel.sh, then drops a `.cuda-enabled` marker
# that the server-side probe (`kernelCudaAvailable()` in
# src/lib/server/kernelRuntime.ts) looks for.
#
# After this runs, the server picks CUDA automatically when
# `AI_LECTURER_KERNEL_DEVICE` is `auto` (the default) and `nvidia-smi` exits 0.
# Force the choice with AI_LECTURER_KERNEL_DEVICE=cuda|cpu.
#
# Usage:
#   bash scripts/setup-kernel-cuda.sh
#   AI_LECTURER_CUDA_INDEX_URL=https://download.pytorch.org/whl/cu124 bash ...
#
# Env vars:
#   AI_LECTURER_PY_RUNTIME       override the venv location
#   AI_LECTURER_CUDA_INDEX_URL   PyTorch CUDA wheel index (default cu121)

set -euo pipefail

RUNTIME_DIR="${AI_LECTURER_PY_RUNTIME:-${HOME}/.ai-lecturer/py-runtime}"
VENV_PY="${RUNTIME_DIR}/bin/python"
VENV_PIP=("${VENV_PY}" -m pip)
CUDA_MARKER="${RUNTIME_DIR}/.cuda-enabled"
CUDA_INDEX_URL="${AI_LECTURER_CUDA_INDEX_URL:-https://download.pytorch.org/whl/cu121}"

log() { printf '[setup-kernel-cuda] %s\n' "$*"; }

# --- 1. Platform / driver check ---------------------------------------------
case "$(uname -s)" in
  Linux*) log "Detected Linux (or WSL2)." ;;
  Darwin*)
    log "macOS detected — CUDA is not supported. Use the CPU baseline (scripts/setup-kernel.sh)."
    exit 2
    ;;
  *)
    log "Unsupported platform: $(uname -s)."
    exit 2
    ;;
esac

if ! command -v nvidia-smi >/dev/null 2>&1; then
  log "nvidia-smi not found — no NVIDIA driver detected."
  log "Install the NVIDIA driver/CUDA toolkit, or stay on the CPU baseline."
  exit 3
fi

# --- 2. Require the baseline venv -------------------------------------------
if [[ ! -x "${VENV_PY}" ]]; then
  log "venv not found at ${RUNTIME_DIR}. Run scripts/setup-kernel.sh first."
  exit 4
fi

# --- 3. Reinstall torch with CUDA wheels ------------------------------------
log "Reinstalling torch from the CUDA wheel index (${CUDA_INDEX_URL})…"
"${VENV_PIP[@]}" install --upgrade --force-reinstall torch --index-url "${CUDA_INDEX_URL}"

# --- 4. Verify torch reports CUDA -------------------------------------------
if "${VENV_PY}" - <<'PY'
import sys
import torch
sys.exit(0 if torch.cuda.is_available() else 1)
PY
then
  log "torch.cuda.is_available() == True."
else
  log "torch installed but torch.cuda.is_available() == False."
  log "Check the driver/toolkit version vs the wheel index (AI_LECTURER_CUDA_INDEX_URL)."
  log "Not writing the .cuda-enabled marker — the runtime will stay on CPU."
  exit 5
fi

# --- 5. Drop the marker the server probe looks for --------------------------
date -u +"%Y-%m-%dT%H:%M:%SZ" > "${CUDA_MARKER}"
log "Wrote CUDA marker at ${CUDA_MARKER}."
log "Done. The runtime will auto-select CUDA when AI_LECTURER_KERNEL_DEVICE=auto"
log "and nvidia-smi succeeds. Force CPU with AI_LECTURER_KERNEL_DEVICE=cpu."
