#!/usr/bin/env bash
# Smoke test: drive the new course-generation pipeline end-to-end against a
# real, running dev server. Produces /courses/pytorch-for-python-developers/
# as the committed baseline.
#
# Prereqs:
#   - Dev server running at $BASE_URL (default http://localhost:3000), e.g.
#       pnpm dev > /tmp/dev.log 2>&1 &
#   - `claude` CLI available on PATH and signed in (the backend spawns it).
#
# Behaviour:
#   1. POST scripts/smoke-tests/pytorch-course-spec.json to /api/courses
#      (creates course-spec.json on disk and returns the course slug).
#   2. POST /api/courses/generate to start a generation run.
#   3. Open the SSE stream at /api/courses/generate/stream/<id>, parse
#      `event:`/`data:` lines, and exit non-zero on `error` or any
#      failedLessons in the terminal `done` event.
#
# Exit codes:
#   0 — `done` with empty failedLessons.
#   1 — POST /api/courses failed.
#   2 — POST /api/courses/generate failed.
#   3 — SSE stream emitted `error`.
#   4 — SSE stream finished `done` but failedLessons non-empty.
#   5 — Timeout waiting for terminal event.
#   6 — Required tooling missing.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TIMEOUT_SEC="${TIMEOUT_SEC:-7200}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE="$SCRIPT_DIR/pytorch-course-spec.json"

if [[ ! -f "$FIXTURE" ]]; then
  echo "fixture not found: $FIXTURE" >&2
  exit 6
fi
for cmd in curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "required tool not on PATH: $cmd" >&2
    exit 6
  fi
done

log() { printf '[%s] %s\n' "$(date +'%H:%M:%S')" "$*"; }

# ── 1. POST /api/courses ────────────────────────────────────────────────────
log "POST $BASE_URL/api/courses (fixture: $FIXTURE)"
create_body="$(curl --silent --show-error --fail --max-time 30 \
  -H 'Content-Type: application/json' \
  --data-binary @"$FIXTURE" \
  "$BASE_URL/api/courses")" || {
    echo "POST /api/courses failed (curl exit $?)" >&2
    exit 1
  }
slug="$(printf '%s' "$create_body" | jq -r '.slug // empty')"
if [[ -z "$slug" ]]; then
  echo "POST /api/courses returned no slug. Body: $create_body" >&2
  exit 1
fi
log "course slug: $slug"

# ── 2. POST /api/courses/generate ──────────────────────────────────────────
log "POST $BASE_URL/api/courses/generate (slug=$slug)"
gen_body="$(curl --silent --show-error --fail --max-time 30 \
  -H 'Content-Type: application/json' \
  --data "$(jq -n --arg slug "$slug" '{slug:$slug}')" \
  "$BASE_URL/api/courses/generate")" || {
    echo "POST /api/courses/generate failed (curl exit $?)" >&2
    exit 2
  }
gen_id="$(printf '%s' "$gen_body" | jq -r '.id // empty')"
if [[ -z "$gen_id" ]]; then
  echo "POST /api/courses/generate returned no id. Body: $gen_body" >&2
  exit 2
fi
log "generation id: $gen_id"

# ── 3. Stream SSE ──────────────────────────────────────────────────────────
stream_url="$BASE_URL/api/courses/generate/stream/$gen_id"
log "GET $stream_url (timeout ${TIMEOUT_SEC}s)"

raw_log="$(mktemp -t pytorch-smoke-sse-XXXXXX.log)"
trap 'rm -f "$raw_log"' EXIT

# `curl --max-time` covers the worst-case wall clock; the backend closes the
# stream when the run finishes so we usually exit much sooner.
exit_code=5
last_event=""
last_data=""

# Use a process substitution so the while-loop keeps running in the current
# shell (so `exit_code` etc. survive). curl writes the raw SSE feed; we read
# it line-by-line.
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$raw_log"
  if [[ "$line" == event:* ]]; then
    last_event="${line#event:}"
    last_event="${last_event## }"
    continue
  fi
  if [[ "$line" == data:* ]]; then
    last_data="${line#data:}"
    last_data="${last_data## }"
    # Pretty-print interesting events to stdout so the operator can watch
    # progress without tailing the raw log.
    case "$last_event" in
      log)
        msg="$(printf '%s' "$last_data" | jq -r '.line // empty' 2>/dev/null || true)"
        [[ -n "$msg" ]] && printf '   %s\n' "$msg"
        ;;
      stage)
        name="$(printf '%s' "$last_data" | jq -r '.name // empty' 2>/dev/null || true)"
        status="$(printf '%s' "$last_data" | jq -r '.status // empty' 2>/dev/null || true)"
        log "stage[$status] $name"
        ;;
      progress)
        cur="$(printf '%s' "$last_data" | jq -r '.current // empty' 2>/dev/null || true)"
        tot="$(printf '%s' "$last_data" | jq -r '.total // empty' 2>/dev/null || true)"
        log "progress $cur/$tot"
        ;;
      done)
        failed_count="$(printf '%s' "$last_data" | jq -r '(.failedLessons // []) | length')"
        if [[ "$failed_count" == "0" ]]; then
          log "DONE — all lessons generated successfully"
          exit_code=0
        else
          log "DONE — but $failed_count lesson(s) failed"
          printf '%s' "$last_data" | jq -r '.failedLessons[] | "   - \(.slug): \(.reason)"'
          exit_code=4
        fi
        break
        ;;
      error)
        msg="$(printf '%s' "$last_data" | jq -r '.message // empty' 2>/dev/null || true)"
        log "ERROR — $msg"
        failed_count="$(printf '%s' "$last_data" | jq -r '(.failedLessons // []) | length')"
        if [[ "$failed_count" != "0" ]]; then
          printf '%s' "$last_data" | jq -r '.failedLessons[] | "   - \(.slug): \(.reason)"'
        fi
        exit_code=3
        break
        ;;
    esac
  fi
done < <(curl --silent --show-error --no-buffer --max-time "$TIMEOUT_SEC" \
  -H 'Accept: text/event-stream' \
  "$stream_url" || true)

if [[ "$exit_code" -eq 5 ]]; then
  log "TIMEOUT — never saw a terminal event. Raw SSE log: $raw_log"
  trap - EXIT
fi

log "raw SSE log: $raw_log"
exit "$exit_code"
