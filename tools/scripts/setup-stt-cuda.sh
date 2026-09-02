#!/usr/bin/env bash
# US-168: Opt-in CUDA build of whisper.cpp for /api/stt.
#
# This script is NOT invoked automatically by `scripts/setup-stt.sh`. It is
# only useful on hosts with the NVIDIA CUDA toolkit installed (nvcc + the
# CUDA driver). On other hosts /api/stt continues to use the CPU build at
# `scripts/.bin/whisper.cpp/...` and this script is irrelevant.
#
# Usage:
#   bash scripts/setup-stt-cuda.sh           # build only if not already built
#   AI_LECTURER_FORCE_REBUILD=1 bash ...     # nuke build/ and rebuild
#
# What this script does:
#   1. Clones whisper.cpp into scripts/.whisper-cuda/ (if missing).
#   2. Builds it via cmake with -DGGML_CUDA=ON so the resulting
#      `build/bin/whisper-cli` auto-uses the GPU at runtime.
#   3. Downloads ggml-base.en.bin into scripts/.bin/whisper.cpp/models/ if
#      the CPU setup hasn't populated it yet (the model file is shared
#      between CPU and CUDA builds).
#
# Once the binary is built, `/api/stt` picks it up automatically when
# `AI_LECTURER_STT_DEVICE` is `auto` (the default) and `nvidia-smi` exits
# 0. To override the build location set `AI_LECTURER_WHISPER_CUDA_BIN` to
# the path of a CUDA-built `whisper-cli` binary.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUDA_ROOT="${SCRIPT_DIR}/.whisper-cuda"
BUILD_DIR="${CUDA_ROOT}/build"
CUDA_BIN="${BUILD_DIR}/bin/whisper-cli"
WHISPER_REPO="https://github.com/ggerganov/whisper.cpp.git"

CPU_MODEL_DIR="${SCRIPT_DIR}/.bin/whisper.cpp/models"
MODEL_FILE="${CPU_MODEL_DIR}/ggml-base.en.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"

log() { printf '[setup-stt-cuda] %s\n' "$*"; }

# --- 1. Platform / toolchain check ------------------------------------------
case "$(uname -s)" in
  Linux*) log "Detected Linux (or WSL2)." ;;
  Darwin*)
    log "macOS detected — CUDA is not supported on Apple Silicon. Use the CPU build (scripts/setup-stt.sh)."
    exit 2
    ;;
  *)
    log "Unsupported platform: $(uname -s)."
    exit 2
    ;;
esac

for tool in git cmake make nvcc nvidia-smi; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    log "Missing required tool: ${tool}."
    log "Install on Ubuntu/WSL2:"
    log "  sudo apt-get install -y build-essential cmake git"
    log "  https://developer.nvidia.com/cuda-toolkit  (for nvcc)"
    log "  NVIDIA driver providing nvidia-smi"
    exit 3
  fi
done

mkdir -p "${SCRIPT_DIR}"

# --- 2. Clone (idempotent) --------------------------------------------------
if [[ -d "${CUDA_ROOT}/.git" ]]; then
  log "whisper.cpp clone already present at ${CUDA_ROOT} — skipping clone."
else
  log "Cloning whisper.cpp into ${CUDA_ROOT}…"
  git clone --depth 1 "${WHISPER_REPO}" "${CUDA_ROOT}"
fi

# --- 3. Build with CUDA (idempotent unless forced) --------------------------
if [[ "${AI_LECTURER_FORCE_REBUILD:-0}" == "1" ]]; then
  log "AI_LECTURER_FORCE_REBUILD=1 — removing ${BUILD_DIR}."
  rm -rf "${BUILD_DIR}"
fi

if [[ -x "${CUDA_BIN}" ]]; then
  log "CUDA whisper-cli already built at ${CUDA_BIN} — skipping build."
else
  log "Building whisper.cpp with -DGGML_CUDA=ON (this can take several minutes)…"
  cmake -S "${CUDA_ROOT}" -B "${BUILD_DIR}" -DGGML_CUDA=ON
  cmake --build "${BUILD_DIR}" -j"$(nproc 2>/dev/null || echo 2)" --config Release
fi

if [[ ! -x "${CUDA_BIN}" ]]; then
  log "CUDA whisper-cli not found at ${CUDA_BIN} after build — check build log."
  exit 4
fi

# --- 4. Reuse the existing CPU-side model file ------------------------------
mkdir -p "${CPU_MODEL_DIR}"
if [[ -s "${MODEL_FILE}" ]]; then
  log "Model already present at ${MODEL_FILE} — skipping download."
else
  log "Downloading ggml-base.en.bin (~140MB) — same model file used by the CPU build…"
  if command -v curl >/dev/null 2>&1; then
    curl -L --fail --output "${MODEL_FILE}" "${MODEL_URL}"
  elif command -v wget >/dev/null 2>&1; then
    wget --output-document="${MODEL_FILE}" "${MODEL_URL}"
  else
    log "Neither curl nor wget is available — cannot download the model."
    exit 5
  fi
fi

log "Done. /api/stt will auto-detect the CUDA build via whisperCudaAvailable()."
log "Force CUDA without auto-detect: AI_LECTURER_STT_DEVICE=cuda"
log "Force CPU even with CUDA built: AI_LECTURER_STT_DEVICE=cpu"
