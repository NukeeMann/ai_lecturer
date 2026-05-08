#!/usr/bin/env bash
# US-154: Set up Coqui XTTS for /api/tts.
#
# Idempotent: skips steps already done. Tested manually only — see
# README.md ("Optional: TTS/STT setup") for the contract.
#
# What this script does:
#   1. Detects the platform (Linux/WSL2 supported).
#   2. Creates a virtualenv at scripts/.venv/coqui/ and installs `coqui-tts`
#      (preferred over `pipx` so the binaries land at a predictable path
#      that the /api/tts route can find without scanning $PATH).
#   3. Pre-downloads the default English XTTS v2 model so the first real
#      request is not a 30s download.
#   4. Runs a 1s test synthesis to verify the install end-to-end.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv/coqui"
TTS_BIN="${VENV_DIR}/bin/tts"
MODEL_NAME="tts_models/multilingual/multi-dataset/xtts_v2"

log() { printf '[setup-tts] %s\n' "$*"; }

# --- 1. Platform check -------------------------------------------------------
case "$(uname -s)" in
  Linux*)
    log "Detected Linux (or WSL2)."
    ;;
  Darwin*)
    log "Detected macOS — install path is the same, but model download is slow on Apple Silicon CPU. Continuing."
    ;;
  *)
    log "Unsupported platform: $(uname -s). Linux/WSL2 is the only tested target. Edit this script if you want to try."
    exit 2
    ;;
esac

# --- 2. Python presence ------------------------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
  log "python3 not found on PATH. Install Python 3.10+ first."
  exit 3
fi

# --- 3. Virtualenv (idempotent) ---------------------------------------------
if [[ -x "${TTS_BIN}" ]]; then
  log "Coqui TTS already installed at ${TTS_BIN} — skipping create+install."
else
  log "Creating virtualenv at ${VENV_DIR}…"
  mkdir -p "$(dirname "${VENV_DIR}")"
  python3 -m venv "${VENV_DIR}"
  # shellcheck disable=SC1091
  source "${VENV_DIR}/bin/activate"
  log "Upgrading pip…"
  pip install --upgrade pip >/dev/null
  log "Installing coqui-tts (this can take several minutes — torch is large)…"
  pip install coqui-tts
  deactivate
fi

if [[ ! -x "${TTS_BIN}" ]]; then
  log "Install completed but ${TTS_BIN} is missing — coqui-tts may have changed entry-point names. Check ${VENV_DIR}/bin/."
  exit 4
fi

# --- 4. Pre-download the default English voice model ------------------------
# `tts --list_models` will lazily fetch the model on first use; we trigger
# the download up-front so the first real request is fast.
MODEL_MARKER="${VENV_DIR}/.xtts_v2_downloaded"
if [[ -f "${MODEL_MARKER}" ]]; then
  log "Default model marker present (${MODEL_MARKER}) — skipping pre-download."
else
  log "Pre-downloading ${MODEL_NAME} (~1.8GB)…"
  # The CLI errors out when run with --list_models on missing args; instead
  # we issue a dummy synthesis with a single short word and discard the
  # output. This forces the model download.
  TMP_WAV="$(mktemp --suffix=.wav)"
  if "${TTS_BIN}" \
        --text "ok" \
        --model_name "${MODEL_NAME}" \
        --language_idx en \
        --out_path "${TMP_WAV}" >/dev/null 2>&1; then
    rm -f "${TMP_WAV}"
    touch "${MODEL_MARKER}"
    log "Model downloaded."
  else
    rm -f "${TMP_WAV}"
    log "Model download failed. Re-run this script or check your network."
    exit 5
  fi
fi

# --- 5. Verify with a 1-second test synthesis -------------------------------
log "Verifying installation with a 1-second test synthesis…"
VERIFY_WAV="$(mktemp --suffix=.wav)"
if "${TTS_BIN}" \
      --text "Hello." \
      --model_name "${MODEL_NAME}" \
      --language_idx en \
      --out_path "${VERIFY_WAV}" >/dev/null 2>&1; then
  if [[ -s "${VERIFY_WAV}" ]]; then
    log "OK. Synthesis verified at ${VERIFY_WAV} ($(wc -c <"${VERIFY_WAV}") bytes)."
    rm -f "${VERIFY_WAV}"
    log "Done. You can now call POST /api/tts."
    exit 0
  fi
fi

rm -f "${VERIFY_WAV}"
log "Test synthesis failed. Inspect ${TTS_BIN} manually."
exit 6
