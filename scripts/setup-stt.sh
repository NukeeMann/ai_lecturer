#!/usr/bin/env bash
# US-154: Set up whisper.cpp for /api/stt.
#
# Idempotent: skips clone/build/download if already done. Tested manually
# only — see README.md ("Optional: TTS/STT setup") for the contract.
#
# What this script does:
#   1. Clones whisper.cpp into scripts/.bin/whisper.cpp/ (if missing).
#   2. Runs `make` (requires gcc/clang + make) to build the `main` binary.
#   3. Downloads ggml-base.en.bin into scripts/.bin/whisper.cpp/models/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${SCRIPT_DIR}/.bin"
REPO_DIR="${BIN_DIR}/whisper.cpp"
MODEL_DIR="${REPO_DIR}/models"
MODEL_FILE="${MODEL_DIR}/ggml-base.en.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
WHISPER_REPO="https://github.com/ggerganov/whisper.cpp.git"

log() { printf '[setup-stt] %s\n' "$*"; }

# --- 1. Platform check -------------------------------------------------------
case "$(uname -s)" in
  Linux*) log "Detected Linux (or WSL2)." ;;
  Darwin*) log "Detected macOS." ;;
  *)
    log "Unsupported platform: $(uname -s). Linux/WSL2 is the tested target."
    exit 2
    ;;
esac

# --- 2. Toolchain check ------------------------------------------------------
for tool in git make cc cmake ffmpeg; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    log "Missing required tool: ${tool}."
    log "Install on Ubuntu/WSL2: sudo apt-get install -y build-essential cmake ffmpeg git"
    exit 3
  fi
done

mkdir -p "${BIN_DIR}"

# --- 3. Clone (idempotent) ---------------------------------------------------
if [[ -d "${REPO_DIR}/.git" ]]; then
  log "whisper.cpp clone already present at ${REPO_DIR} — skipping clone."
else
  log "Cloning whisper.cpp into ${REPO_DIR}…"
  git clone --depth 1 "${WHISPER_REPO}" "${REPO_DIR}"
fi

# --- 4. Build (idempotent) ---------------------------------------------------
# Recent whisper.cpp versions emit the binary at `main`; older ones used
# `bin/main`. Check both.
MAIN_BIN_NEW="${REPO_DIR}/main"
MAIN_BIN_OLD="${REPO_DIR}/build/bin/main"
MAIN_BIN_CLI="${REPO_DIR}/build/bin/whisper-cli"

if [[ -x "${MAIN_BIN_NEW}" || -x "${MAIN_BIN_OLD}" || -x "${MAIN_BIN_CLI}" ]]; then
  log "whisper.cpp binary already built — skipping make."
else
  log "Building whisper.cpp (this can take a few minutes)…"
  ( cd "${REPO_DIR}" && make -j"$(nproc 2>/dev/null || echo 2)" )
fi

# --- 5. Download the base.en model (idempotent) -----------------------------
mkdir -p "${MODEL_DIR}"
if [[ -s "${MODEL_FILE}" ]]; then
  log "Model already present at ${MODEL_FILE} — skipping download."
else
  log "Downloading ggml-base.en.bin (~140MB)…"
  if command -v curl >/dev/null 2>&1; then
    curl -L --fail --output "${MODEL_FILE}" "${MODEL_URL}"
  elif command -v wget >/dev/null 2>&1; then
    wget --output-document="${MODEL_FILE}" "${MODEL_URL}"
  else
    log "Neither curl nor wget is available — cannot download the model."
    exit 4
  fi
fi

# --- 6. Final sanity check ---------------------------------------------------
if [[ ! -s "${MODEL_FILE}" ]]; then
  log "Model file at ${MODEL_FILE} is empty after download — re-run this script."
  exit 5
fi
if [[ ! -x "${MAIN_BIN_NEW}" && ! -x "${MAIN_BIN_OLD}" && ! -x "${MAIN_BIN_CLI}" ]]; then
  log "whisper.cpp main binary not found after build. Check ${REPO_DIR} for build errors."
  exit 6
fi

log "Done. /api/stt can now be invoked."
