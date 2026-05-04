#!/bin/bash
# Ralph Loop Orchestrator - parallel task execution with git worktrees
# Usage: ./ralph.sh [--parallel N] [--max-iterations N]
set -euo pipefail

# Paths are overridable via env vars so the test suite can redirect them to
# a temp dir before sourcing this file. Production runs get the computed defaults.
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SCRIPT_DIR="${SCRIPT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

# Load config if exists (can override PRD_DIR, STORIES_FIELD, INSTALL_CMD)
CONFIG_FILE="$SCRIPT_DIR/ralph.config"
PRD_DIR="$SCRIPT_DIR"
STORIES_FIELD=""
INSTALL_CMD="npm install --ignore-scripts --no-audit --no-fund"
VALIDATE_CMD=""
TASK_TIMEOUT_SEC=3600
# Reserve the last N seconds of TASK_TIMEOUT_SEC as a soft-deadline buffer.
# When the agent crosses (TASK_TIMEOUT_SEC - SOFT_DEADLINE_BUFFER_SEC) it must
# stop, print a TIMEOUT REPORT to stdout, and exit cleanly so the next retry
# has a real failure note instead of a SIGKILL'd transcript.
SOFT_DEADLINE_BUFFER_SEC=600
PROGRESS_ROTATE_LINES=200
if [ -f "$CONFIG_FILE" ]; then
  source "$CONFIG_FILE"
fi

# Force timestamps in logs and progress markers to render in Warsaw local
# time. Override by exporting TZ before invoking ralph.sh, or by setting
# `export TZ=...` inside ralph.config.
export TZ="${TZ:-Europe/Warsaw}"

PRD="$PRD_DIR/prd.json"
# Repo-relative path to prd.json, used for `git add` / `git checkout` /
# pathspec matches against `git diff --name-only` output. With the default
# PRD_DIR=$SCRIPT_DIR this is "scripts/ralph/prd.json", not "prd.json".
PRD_REL="${PRD#$REPO_ROOT/}"
WORKTREE_BASE="$REPO_ROOT/.worktrees"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_DIR_REL="${LOG_DIR#$REPO_ROOT/}"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
PROGRESS_FILE_REL="${PROGRESS_FILE#$REPO_ROOT/}"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
ARCHIVE_DIR_REL="${ARCHIVE_DIR#$REPO_ROOT/}"
LOCK_DIR="$REPO_ROOT/.ralph-locks"
# Per-worker session IDs are written here so the orchestrator can reap
# any leftover dev servers (or other long-running children) the agent
# forgot to stop. See kill_session() / run_worker for the mechanism.
SESSION_DIR="$LOCK_DIR/sessions"

# Auto-detect stories field if not set in config
if [ -z "$STORIES_FIELD" ] && [ -f "$PRD" ]; then
  if jq -e '.stories' "$PRD" &>/dev/null; then
    STORIES_FIELD="stories"
  elif jq -e '.userStories' "$PRD" &>/dev/null; then
    STORIES_FIELD="userStories"
  else
    STORIES_FIELD="stories"
  fi
elif [ -z "$STORIES_FIELD" ]; then
  STORIES_FIELD="stories"
fi

# STORIES_FIELD is interpolated into jq queries throughout this script, so it
# must be a bare identifier — anything else could break queries or worse.
if ! [[ "$STORIES_FIELD" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "Invalid STORIES_FIELD: '$STORIES_FIELD' (must match [a-zA-Z_][a-zA-Z0-9_]*)" >&2
  exit 1
fi

# Defaults
PARALLEL=2
MAX_ITERATIONS=50
MAX_RETRIES=2
MODEL="opus"  # opus | sonnet | haiku
MODE="merge"  # merge | pr — pr opens PRs via `gh` instead of auto-merging
BASE_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --parallel|-p)   PARALLEL="$2"; shift 2 ;;
    --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
    --max-retries)   MAX_RETRIES="$2"; shift 2 ;;
    --model|-m)      MODEL="$2"; shift 2 ;;
    --mode)          MODE="$2"; shift 2 ;;
    --base)          BASE_BRANCH="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: ./ralph.sh [--parallel N] [--max-iterations N] [--max-retries N] [--mode MODE] [--base BRANCH]"
      echo ""
      echo "  --parallel N      Run N tasks in parallel (default: 2)"
      echo "  --max-iterations  Max total iterations (default: 50)"
      echo "  --max-retries N   Max retries per failed task (default: 2)"
      echo "  --model, -m       Claude model: opus, sonnet, haiku (default: opus)"
      echo "  --mode            merge | pr (default: merge). 'pr' opens GitHub PRs via gh"
      echo "                    instead of auto-merging, and stops after one batch so a human can review."
      echo "  --base            Base branch (default: current branch)"
      exit 0
      ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ "$MODE" != "merge" && "$MODE" != "pr" ]]; then
  echo "Invalid --mode: '$MODE' (must be 'merge' or 'pr')" >&2
  exit 1
fi

if [ "$MODE" = "pr" ] && ! command -v gh &>/dev/null; then
  echo "--mode=pr requires the GitHub CLI (gh). Install from https://cli.github.com" >&2
  exit 1
fi

FAILED_REPORT="$LOG_DIR/failed_report.json"

mkdir -p "$LOG_DIR" "$LOCK_DIR" "$SESSION_DIR" "$WORKTREE_BASE"

# Initialize empty report
echo '[]' > "$FAILED_REPORT"

# Retry tracking: RETRIES[task_id]=count
declare -A RETRIES

# PIDs of currently-running workers. Tracked so the SIGINT/SIGTERM handler
# can tear down their descendants (timeout -> claude -> tee, ...) on Ctrl+C.
declare -a ACTIVE_PIDS=()

# Minimal colors — only used to tint status words in logs. Works fine on
# pipes/log files because everything is still readable without the codes.
RST='\033[0m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'

SCRIPT_START=$(date +%s)

# Task title cache
declare -A TASK_TITLES
cache_task_titles() {
  while IFS=$'\t' read -r id title; do
    TASK_TITLES["$id"]="$title"
  done < <(jq -r ".${STORIES_FIELD}[] | [.id, .title] | @tsv" "$PRD" 2>/dev/null)
}
cache_task_titles

task_title() {
  echo "${TASK_TITLES[$1]:-$1}"
}

elapsed_since() {
  local start=$1
  local now
  now=$(date +%s)
  local diff=$(( now - start ))
  if [ $diff -ge 3600 ]; then
    printf '%dh%02dm%02ds' $(( diff / 3600 )) $(( (diff % 3600) / 60 )) $(( diff % 60 ))
  else
    printf '%dm%02ds' $(( diff / 60 )) $(( diff % 60 ))
  fi
}

# Logging helpers — 4 levels, timestamped, colour-tagged but readable without.
_ts() { date '+%H:%M:%S'; }
log()      { echo -e "[$(_ts)] $*"; }
log_ok()   { echo -e "[$(_ts)] ${GREEN}OK${RST}   $*"; }
log_warn() { echo -e "[$(_ts)] ${YELLOW}WARN${RST} $*"; }
log_fail() { echo -e "[$(_ts)] ${RED}FAIL${RST} $*"; }
log_task() {
  local tid="$1"; shift
  echo -e "[$(_ts)] [$tid] $*"
}

# Extract a short, human-readable tail from a JSONL stream-json log for retry
# prompts. Keeps only assistant text and the final result line — tool calls and
# tool results are deliberately dropped to keep the snippet compact. The full
# transcript stays at $logfile if deeper inspection is needed.
format_log_tail() {
  local logfile="$1"
  local n_lines="${2:-12}"
  [ -s "$logfile" ] || return 0
  local extracted
  extracted=$(jq -R -r 'try (fromjson |
      if .type == "assistant" then
        (.message.content // []) | map(
          if .type == "text" then .text else empty end
        ) | join("\n")
      elif .type == "result" then
        "RESULT (" + (.subtype // "?") + "): " + ((.result // "(no result)") | .[0:200])
      else empty end
    ) catch empty' "$logfile" 2>/dev/null | sed '/^$/d' | tail -n "$n_lines")
  if [ -n "$extracted" ]; then
    printf '%s\n' "$extracted"
  else
    tail -n "$n_lines" "$logfile"
  fi
}

# ============================================================================
# Signal handling: propagate Ctrl+C to active workers and their subprocesses
# ============================================================================

# `&` in bash doesn't create a new process group, so `kill -- -$pid` would
# hit the orchestrator itself. Instead, walk the process tree via `pgrep -P`
# and signal each node bottom-up. Covers grandchildren (claude -> node/tee).
kill_tree() {
  local pid=$1 sig=${2:-TERM}
  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for child in $children; do
    kill_tree "$child" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

# Reap every process that shares a given session ID. kill_tree only
# walks parent->child links, so it misses dev servers the agent
# detached via `disown` / `nohup` (those get reparented to PID 1 but
# stay in the same session unless they call setsid() themselves).
# run_worker wraps each agent invocation in `setsid` precisely so we
# can sweep that session here after the agent exits.
kill_session() {
  local sid=$1
  local label=${2:-}
  [ -n "$sid" ] || return 0
  local pids
  pids=$(ps -e -o pid=,sid= 2>/dev/null \
    | awk -v sid="$sid" -v self="$$" '$2==sid && $1!=self {print $1}')
  [ -n "$pids" ] || return 0
  local n
  n=$(echo "$pids" | wc -w | tr -d ' ')
  if [ -n "$label" ]; then
    log_task "$label" "Reaping $n leftover process(es) from agent session $sid"
  else
    log_warn "Reaping $n leftover process(es) from agent session $sid"
  fi
  echo "$pids" | xargs -r kill -TERM 2>/dev/null || true
  sleep 1
  pids=$(ps -e -o pid=,sid= 2>/dev/null \
    | awk -v sid="$sid" -v self="$$" '$2==sid && $1!=self {print $1}')
  if [ -n "$pids" ]; then
    echo "$pids" | xargs -r kill -KILL 2>/dev/null || true
  fi
}

cleanup_on_interrupt() {
  trap '' INT TERM  # don't re-enter while we tear down
  echo ""
  log_warn "Interrupted — terminating ${#ACTIVE_PIDS[@]} active worker(s)..."
  for pid in "${ACTIVE_PIDS[@]}"; do
    kill_tree "$pid" TERM
  done
  sleep 1
  for pid in "${ACTIVE_PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill_tree "$pid" KILL
    fi
  done
  # Sweep agent sessions in case any worker spawned dev servers that
  # detached from its parent->child tree (kill_tree above can't see them).
  if [ -d "$SESSION_DIR" ]; then
    for sid_file in "$SESSION_DIR"/*.sid; do
      [ -f "$sid_file" ] || continue
      local sid
      sid=$(cat "$sid_file" 2>/dev/null || echo "")
      [ -n "$sid" ] && kill_session "$sid"
      rm -f "$sid_file"
    done
  fi
  rm -rf "$LOCK_DIR" 2>/dev/null || true
  exit 130
}

# ============================================================================
# Core helpers
# ============================================================================

# Append/replace a row in failed_report.json. Acts as a compact index of failed
# attempts — id, title, retry count, gave_up flag, and a pointer to the full
# log file. The agent transcript itself stays in $logfile so this report
# doesn't bloat with duplicated output.
report_failure() {
  local task_id="$1"
  local attempt="$2"
  local max="$3"
  local t_title
  t_title=$(jq -r ".${STORIES_FIELD}[] | select(.id == \"$task_id\") | .title" "$PRD")
  local logfile="$LOG_DIR/${task_id}.log"

  local tmp="$FAILED_REPORT.tmp.$$"
  jq --arg id "$task_id" \
     --arg title "$t_title" \
     --argjson attempt "$attempt" \
     --argjson max "$max" \
     --arg time "$(date -Iseconds)" \
     --arg log "$logfile" \
     '. |= map(select(.id != $id)) + [{
       id: $id,
       title: $title,
       attempt: $attempt,
       max_retries: $max,
       gave_up: ($attempt > $max),
       timestamp: $time,
       logfile: $log
     }]' "$FAILED_REPORT" > "$tmp" && mv "$tmp" "$FAILED_REPORT"
}

get_pending_tasks() {
  local min_priority
  min_priority=$(jq "[.${STORIES_FIELD}[] | select(.passes == false) | .priority] | min // empty" "$PRD" 2>/dev/null)
  if [ -z "$min_priority" ]; then
    echo ""
    return
  fi
  # Return tasks, filtering out those that exhausted retries
  for tid in $(jq -r ".${STORIES_FIELD}[] | select(.passes == false and .priority == $min_priority) | .id" "$PRD"); do
    if [ "${RETRIES[$tid]:-0}" -le "$MAX_RETRIES" ]; then
      echo "$tid"
    fi
  done
}

count_pending() {
  jq "[.${STORIES_FIELD}[] | select(.passes == false)] | length" "$PRD"
}

count_total() {
  jq "[.${STORIES_FIELD}[]] | length" "$PRD"
}

# Rotate progress.txt when it grows past PROGRESS_ROTATE_LINES. The
# Codebase Patterns section is preserved so future iterations still get
# the consolidated knowledge; everything else goes to archive/.
rotate_progress() {
  local progress="$SCRIPT_DIR/progress.txt"
  [ -f "$progress" ] || return 0
  local line_count
  line_count=$(wc -l < "$progress")
  if [ "$line_count" -le "$PROGRESS_ROTATE_LINES" ]; then
    return 0
  fi

  local archive_dir="$SCRIPT_DIR/archive"
  mkdir -p "$archive_dir"
  local stamp
  stamp=$(date +%Y-%m-%d-%H%M)
  local archive_file="$archive_dir/progress-$stamp.txt"
  cp "$progress" "$archive_file"

  local patterns
  patterns=$(awk '
    /^## Codebase Patterns/ { in_patterns = 1; print; next }
    in_patterns && /^## / { in_patterns = 0 }
    in_patterns { print }
  ' "$progress")

  {
    echo "# Ralph Progress Log"
    echo "Rotated: $(date)"
    echo "Previous log archived to: archive/progress-$stamp.txt"
    echo "---"
    if [ -n "$patterns" ]; then
      echo ""
      echo "$patterns"
    fi
  } > "$progress"

  log "Rotated progress.txt ($line_count lines -> archive/progress-$stamp.txt)"
}

mark_done() {
  local task_id="$1"
  local tmp="$PRD.tmp.$$"
  jq "(.${STORIES_FIELD}[] | select(.id == \"$task_id\") | .passes) = true" "$PRD" > "$tmp" && mv "$tmp" "$PRD"
}

# Stage prd.json + ralph logs/progress/archive and create a commit on BASE_BRANCH
# so completion state, failure transcripts, and rotated progress logs persist
# across runs. Idempotent — exits cleanly when nothing is staged. Caller is
# responsible for `git push` afterwards.
#
# Failed-task artifacts (US-XXX.log, US-XXX.last_failure.txt, updated
# failed_report.json) are intentionally captured here so a fresh ralph run on
# a clean checkout — or a retry agent on a different branch — can still see
# why the previous attempt failed.
commit_progress() {
  local message="$1"
  cd "$REPO_ROOT"
  git add "$PRD_REL" "$LOG_DIR_REL" "$PROGRESS_FILE_REL" "$ARCHIVE_DIR_REL" 2>/dev/null || true
  if git diff --cached --quiet 2>/dev/null; then
    return 0
  fi
  git commit -m "$message" >/dev/null || return 1
  log_ok "Committed ralph progress: $message"
}

# Wrapper that commits any outstanding ralph artifacts and pushes BASE_BRANCH.
# Called at end-of-batch and at every script exit so log files never sit
# uncommitted after a ralph run completes. Idempotent: a no-op when there's
# nothing to commit (exit code from commit_progress is checked via &&).
flush_artifacts() {
  local message="$1"
  cd "$REPO_ROOT" || return 0
  if commit_progress "$message"; then
    git push origin "$BASE_BRANCH" >/dev/null 2>&1 || true
  fi
}

branch_name() {
  echo "ralph/$(echo "$1" | tr '[:upper:]' '[:lower:]')"
}

# flock-based lock to serialize git operations (survives crashes, no stale locks)
GIT_LOCK_FILE="$LOCK_DIR/git.lock"
GIT_LOCK_FD=""
git_lock() {
  exec {GIT_LOCK_FD}>"$GIT_LOCK_FILE"
  flock -x "$GIT_LOCK_FD"
}
git_unlock() {
  if [ -n "$GIT_LOCK_FD" ]; then
    flock -u "$GIT_LOCK_FD"
    exec {GIT_LOCK_FD}>&-
    GIT_LOCK_FD=""
  fi
}

# Persist a compact failure note for the next retry attempt: the failure
# reason, the names of files the previous attempt touched in the worktree,
# and a short tail of the agent's output. The next prompt embeds this verbatim
# so it stays brief on purpose. MUST be called before `git worktree remove` —
# once the worktree is gone, the uncommitted file list is unrecoverable.
capture_failure_context() {
  local task_id="$1"
  local worktree_dir="$2"
  local logfile="$3"
  local last_failure_file="$4"
  local reason="$5"

  {
    echo "$reason"
    if [ -d "$worktree_dir/.git" ] || [ -f "$worktree_dir/.git" ]; then
      local status
      status=$(git -C "$worktree_dir" status --short 2>/dev/null | head -20 || true)
      if [ -n "$status" ]; then
        echo ""
        echo "Files touched (lost on retry):"
        echo "$status"
        # Capture the actual diff so the retry agent can rebuild work that
        # the previous attempt produced but never committed. Bounded to keep
        # the failure note small enough to embed in the next prompt.
        local unstaged_diff
        unstaged_diff=$(git -C "$worktree_dir" diff --no-color 2>/dev/null | head -400 || true)
        if [ -n "$unstaged_diff" ]; then
          echo ""
          echo "Unstaged diff (first 400 lines, for rebuild):"
          echo "$unstaged_diff"
        fi
        local untracked
        untracked=$(git -C "$worktree_dir" ls-files --others --exclude-standard 2>/dev/null | head -10 || true)
        if [ -n "$untracked" ]; then
          echo ""
          echo "Untracked files (first 10):"
          echo "$untracked"
        fi
      fi
    fi
    if [ -s "$logfile" ]; then
      echo ""
      echo "Last agent output:"
      format_log_tail "$logfile" 12 2>/dev/null || true
    fi
  } > "$last_failure_file" 2>/dev/null || true
}

# ============================================================================
# Diagnostician: narrow Sonnet finisher invoked when run_worker's success
# check fails. If the prior agent did the work but skipped passes:true /
# commit, the diagnostician flips passes and commits IN THE SAME ITERATION,
# converting a near-miss into a passing run. If the work is genuinely
# incomplete the diagnostician exits without changes — the orchestrator's
# existing failure note stands, and the next Ralph iteration re-implements
# as today. Re-implementation is explicitly NOT in scope for the diagnostician.
#
# Always returns 0 — diagnostician failure must never block the regular
# retry path. The caller re-checks passes from HEAD afterwards to decide
# whether the diagnostician recovered the task.
# ============================================================================

run_diagnostician() {
  local task_id="$1"
  local worktree_dir="$2"
  local logfile="$3"
  local last_failure_file="$4"
  local branch="$5"
  local diagnostician_log="$LOG_DIR/${task_id}.diagnostician.log"

  if [ ! -d "$worktree_dir" ]; then
    log_task "$task_id" "diagnostician skipped (worktree gone)"
    return 0
  fi

  local story_json story_title story_criteria
  story_json=$(jq -r ".${STORIES_FIELD}[] | select(.id == \"$task_id\")" "$PRD" 2>/dev/null)
  story_title=$(echo "$story_json" | jq -r '.title // empty')
  story_criteria=$(echo "$story_json" | jq -r '
    if .acceptanceCriteria then
      if (.acceptanceCriteria | type) == "array" then
        .acceptanceCriteria | map("- " + .) | join("\n")
      else .acceptanceCriteria end
    elif .acceptance_criteria then
      if (.acceptance_criteria | type) == "array" then
        .acceptance_criteria | map("- " + .) | join("\n")
      else .acceptance_criteria end
    else empty end')

  local prompt
  prompt="You are a finisher agent for the failed Ralph task $task_id. The implementation
agent already ran. The orchestrator's success check failed (committed prd.json
does NOT have passes==true for $task_id, or there is no commit at all).

YOUR JOB: if the prior agent's work is COMPLETE but only missing finishing
actions (passes flip / commit / a skipped final check), apply them. If the
work is incomplete or broken, EXIT WITHOUT CHANGES — the next Ralph iteration
re-implements. Re-implementation is NOT your job.

DO NOT NARRATE. No plans, no 'let me…', no summaries. Tool calls only.

═══════ READ FIRST (no writes yet) ═══════

  - $logfile                  (filtered agent transcript)
  - $last_failure_file        (orchestrator's note + unstaged diff)
  - $PRD_REL                  (current prd.json in the worktree)
  - git status / git diff     (worktree state)
  - git log $BASE_BRANCH..HEAD --oneline  (any commits the agent made)

═══════ DECISION ═══════

Apply finishing actions ONLY if ALL hold:
  1. The diff (committed and/or unstaged) is substantive, matches the story
     scope, and shows no TODOs / placeholders / partial files / scope creep
     into unrelated areas.
  2. Required validation either ALREADY succeeded in the transcript, OR is
     cheap for you to run yourself (see TESTS below).
  3. The ONLY things missing are: passes flip, commit, and/or a skipped
     final check.

If any of the above does NOT hold — agent gave up mid-implementation,
acceptance criteria visibly unmet, tests failed and weren't fixed, files
missing — EXIT IMMEDIATELY with no changes. Do not write a diagnosis. The
orchestrator already captured a failure note; the next iteration inherits it.

═══════ TESTS (only if not completed in $logfile) ═══════

If the transcript does NOT show a successful run of the project's checks,
run them yourself BEFORE committing:
  - $VALIDATE_CMD if non-empty
  - Otherwise: npm run typecheck   (and npm test if the repo has unit tests)

If any check fails: EXIT WITH NO CHANGES. The implementation was not
actually complete — let the next Ralph iteration handle it.

DO NOT run playwright / browser tests. If a 'ui'-tagged task's transcript
lacks a successful playwright run, treat it as incomplete and exit.

═══════ FINISHING STEPS ═══════

  a. If prd.json's passes==false for $task_id, edit $PRD_REL to set passes=true.
     Touch ONLY $task_id's entry — leave every other story alone.
  b. git add changed/untracked files belonging to this task. SKIP stray temp
     artifacts (e.g. .temp-execution-*.js, .DS_Store, editor swap files).
  c. Commit (NEW commit only — never amend; the orchestrator's push is
     non-forced and amend would rewrite history the agent may have pushed):
       • No commit yet on branch:
             git commit -m \"feat: $task_id - $story_title\"
       • Commit exists but lacks prd.json:
             git commit -m \"chore: $task_id - mark passes:true\"
  d. DO NOT PUSH. The orchestrator handles the push after re-checking your
     work. Your last action before VERIFY is the commit.
  e. VERIFY — these MUST be your final two tool calls:
       1. git log -1 --format='%s'      → output must contain \"$task_id\"
       2. git show HEAD:$PRD_REL | jq -r '.${STORIES_FIELD}[]|select(.id==\"$task_id\")|.passes'
                                        → output must be exactly: true
     If verification fails: ONE fix attempt, then re-verify. If still failing,
     exit. Do not loop.

═══════ HARD RULES ═══════

  - DO NOT edit any source file. $PRD_REL is the ONLY file you may edit.
  - DO NOT re-implement anything. Incomplete work → exit.
  - DO NOT write any diagnosis / report / log file.
  - DO NOT push, checkout other branches, reset, rebase, or amend.
  - Hard cap: 5 min wall clock, 30 tool calls. On exceeded: exit without
    further changes.

═══════ CONTEXT ═══════

Task:    $task_id — $story_title
Branch:  $branch
Worktree: $worktree_dir
Acceptance criteria:
$story_criteria

VALIDATE_CMD: ${VALIDATE_CMD:-(unset)}"

  log_task "$task_id" "Running diagnostician (sonnet, 5min cap)..."

  cd "$worktree_dir"
  local exit_code=0
  # Filter mirrors run_worker's stream-json filter so the diagnostician log
  # is human-readable in the same format. See run_worker for the rationale.
  timeout --foreground 300 \
    stdbuf -oL claude \
      --model sonnet \
      --dangerously-skip-permissions \
      --print \
      --output-format stream-json \
      --verbose \
      -p "$prompt" 2>&1 \
    | stdbuf -oL jq -R -r --unbuffered --arg tzoff "$(date '+%z')" '
        def fmt: localtime | strftime("%Y-%m-%dT%H:%M:%S") + $tzoff;
        def ts: now | fmt;
        def strip_ms: sub("\\.[0-9]+Z$"; "Z");
        def to_local(s): try (s | strip_ms | fromdateiso8601 | localtime | strftime("%Y-%m-%dT%H:%M:%S") + $tzoff) catch ts;
        . as $line
        | (try fromjson catch null) as $msg
        | if $msg == null then
            "[" + ts + "] [stderr] " + $line
          elif $msg.type == "assistant" then
            (if $msg.timestamp then to_local($msg.timestamp) else ts end) as $t
            | (($msg.message.content // [])
                | map(if .type == "text" then .text else empty end)
                | join("\n")) as $txt
            | if ($txt | length) > 0 then "[" + $t + "] " + $txt else empty end
          elif $msg.type == "result" then
            (if $msg.timestamp then to_local($msg.timestamp) else ts end) as $t
            | "[" + $t + "] [result " + ($msg.subtype // "?")
              + (if ($msg.is_error // false) then " ERROR" else "" end)
              + " turns=" + (($msg.num_turns // 0) | tostring)
              + " cost=$" + (($msg.total_cost_usd // 0) | tostring)
              + "] " + ($msg.result // "(no result)")
          else empty
          end
      ' > "$diagnostician_log" || exit_code=$?

  if [ $exit_code -eq 124 ]; then
    log_task "$task_id" "diagnostician TIMEOUT after 5min (non-fatal, see $diagnostician_log)"
  elif [ $exit_code -ne 0 ]; then
    log_task "$task_id" "diagnostician exited with code $exit_code (non-fatal, see $diagnostician_log)"
  fi

  return 0
}

# ============================================================================
# Conflict Resolver: narrow Sonnet finisher invoked when merge_tasks hits a
# real source conflict (a file outside the auto-resolvable allowlist). Runs
# in REPO_ROOT against the in-progress merge state, attempts to combine both
# sides, and completes the merge with a NEW commit. If it cannot resolve
# cleanly it exits without committing — merge_tasks then aborts the merge and
# falls back to the existing retry path.
#
# Returns 0 only when the merge was completed (MERGE_HEAD gone, new commit
# referencing $task_id reachable from HEAD). Otherwise 1 — caller aborts.
# ============================================================================

run_conflict_resolver() {
  local task_id="$1"
  local branch="$2"
  local conflicted_files="$3"
  # When "true", $PRD_REL was among the conflicted files and was NOT
  # pre-resolved — the resolver must handle it directly using the rules in
  # the prompt (preserve other tasks' progress, set passes:true for $task_id).
  local prd_conflicted="${4:-false}"
  local resolver_log="$LOG_DIR/${task_id}.conflict_resolver.log"

  cd "$REPO_ROOT"

  if [ ! -f "$REPO_ROOT/.git/MERGE_HEAD" ]; then
    log_task "$task_id" "conflict resolver skipped (no merge in progress)"
    return 1
  fi

  local story_json story_title story_criteria
  story_json=$(jq -r ".${STORIES_FIELD}[] | select(.id == \"$task_id\")" "$PRD" 2>/dev/null)
  story_title=$(echo "$story_json" | jq -r '.title // empty')
  story_criteria=$(echo "$story_json" | jq -r '
    if .acceptanceCriteria then
      if (.acceptanceCriteria | type) == "array" then
        .acceptanceCriteria | map("- " + .) | join("\n")
      else .acceptanceCriteria end
    elif .acceptance_criteria then
      if (.acceptance_criteria | type) == "array" then
        .acceptance_criteria | map("- " + .) | join("\n")
      else .acceptance_criteria end
    else empty end')

  local validate_hint="${VALIDATE_CMD:-npm run typecheck}"

  # Two prompt fragments swap in/out depending on whether $PRD_REL was
  # pre-resolved or handed to the resolver. Keeping them as variables avoids
  # a duplicated prompt template.
  local pre_resolved_summary prd_rule prd_block
  if [ "$prd_conflicted" = "true" ]; then
    pre_resolved_summary="The orchestrator already pre-resolved auto-mergeable lockfiles
and .gitignore. ${PRD_REL} is in YOUR list — the orchestrator did not pre-resolve it
because the conflict is on this task's own progress entry."
    prd_rule="  - DO NOT touch any file that was not in conflict.
  - You MAY edit $PRD_REL because it IS in conflict (see PRD.JSON RULES below)."
    prd_block="
═══════ PRD.JSON RULES (only because $PRD_REL is in conflict) ═══════

$PRD_REL is the orchestrator's source of truth for which stories are done.
Conflicts here typically mean another ralph branch already marked a different
story passes:true on $BASE_BRANCH while this branch was in flight.

Resolve $PRD_REL like this:
  1. Start from the OUR side (\`git show :2:$PRD_REL\` — the $BASE_BRANCH copy)
     so other tasks' passes:true and any operator edits on base are preserved.
  2. Set \`passes\` to \`true\` for THIS task ($task_id) — and ONLY this task.
     Use jq to be safe, e.g.:
        jq '(.${STORIES_FIELD}[] | select(.id == \"$task_id\") | .passes) = true' \\
           <(git show :2:$PRD_REL) > $PRD_REL
  3. Do NOT change any other story's \`passes\` value, priority, title, criteria,
     or any other field. Touch ONLY $task_id's \`passes\`.
  4. \`git add $PRD_REL\` like any other resolved file."
  else
    pre_resolved_summary="The orchestrator already pre-resolved auto-mergeable files (lockfiles,
prd.json, .gitignore). The remaining conflicts are real source conflicts."
    prd_rule="  - DO NOT touch any file that was not in conflict.
  - DO NOT modify $PRD_REL — it was pre-resolved by the orchestrator."
    prd_block=""
  fi

  local prompt
  prompt="You are a merge-conflict resolver agent for Ralph task $task_id ($story_title).
A merge of branch '$branch' into '$BASE_BRANCH' is IN PROGRESS but has conflicts.
You are running in the repo root: $REPO_ROOT (on $BASE_BRANCH with MERGE_HEAD set).
$pre_resolved_summary

YOUR JOB: resolve the remaining conflict markers, stage the resolved files,
run validation, and complete the merge with a NEW 'git commit'. If you cannot
resolve cleanly (semantic incompatibility, conflicting intents you cannot
reconcile), EXIT WITHOUT COMMITTING — the orchestrator will abort the merge
and retry the task on a fresh base. Do NOT guess.

DO NOT NARRATE. No plans, no 'let me…', no summaries. Tool calls only.

═══════ READ FIRST (no writes yet) ═══════

  - git status                                  (overview, see unmerged files)
  - git diff --name-only --diff-filter=U        (the files you must resolve)
  - For each conflicted file:
      • Read the file (look for <<<<<<<, =======, >>>>>>> markers)
      • git show :2:<file>   → OUR side ($BASE_BRANCH content)
      • git show :3:<file>   → THEIR side ($branch content)
  - git log --oneline $branch ^$BASE_BRANCH -10  (commits being merged in)
  - git log --oneline $BASE_BRANCH -5            (recent base commits)
  - $PRD_REL                                     (acceptance criteria for this task)

═══════ DECISION ═══════

Resolve ONLY when you can confidently combine both intents. Examples of
clean resolution:
  - Both sides edited adjacent / non-overlapping lines → combine.
  - Both sides added imports → include both, dedupe.
  - One side renamed a symbol, the other edited it → apply edit to renamed.
  - Same logical change duplicated → keep one, drop the other.
  - One side adds a function, the other edits a different function → keep both.

If conflicts are semantically incompatible — e.g., both sides redefined the
same function with different signatures, or both sides changed the same
config in contradictory ways and the right answer isn't obvious from the
acceptance criteria — EXIT WITH NO COMMIT. The orchestrator falls back to
retry on a fresh base. Do not invent a 'compromise' that satisfies neither.

═══════ STEPS ═══════

  a. For each unmerged file:
       • Edit the file to remove ALL conflict markers (<<<<<<<, =======, >>>>>>>)
       • Combine both sides per the rules above
  b. git add <each-resolved-file>   (only the files you resolved — not -A)
  c. Run validation:
       $validate_hint
     If validation fails: EXIT WITHOUT COMMITTING. A failing validate means
     the resolution is broken; let the next Ralph iteration re-implement.
  d. Complete the merge with a NEW commit (no --amend, no --no-verify):
       git commit -m \"merge: $task_id resolved by conflict-resolver\"
  e. DO NOT push. The orchestrator handles the push.

═══════ VERIFY (final tool calls) ═══════

  1. test ! -f $REPO_ROOT/.git/MERGE_HEAD     → must succeed (merge complete)
  2. git log -1 --format='%s'                  → must contain '$task_id'

If verification fails: ONE fix attempt, then exit. Do not loop.

═══════ HARD RULES ═══════

  - DO NOT 'git merge --abort'. The orchestrator decides aborts.
  - DO NOT push, checkout other branches, reset, rebase, or amend.
  - DO NOT introduce new functionality. Resolution only.
$prd_rule
  - Hard cap: 5 min wall clock, 30 tool calls. On exceeded: exit cleanly.$prd_block

═══════ CONTEXT ═══════

Task:        $task_id — $story_title
Branch:      $branch (merging into $BASE_BRANCH)
Conflicted files (need your resolution):
$conflicted_files

Acceptance criteria (for tie-breaking when both sides differ):
$story_criteria

VALIDATE_CMD: ${VALIDATE_CMD:-(unset, fall back to npm run typecheck)}"

  log_task "$task_id" "Running conflict resolver (sonnet, 10min cap)..."

  local exit_code=0
  # Filter mirrors run_worker's stream-json filter so the resolver log is
  # human-readable in the same format. See run_worker for the rationale.
  timeout --foreground 600 \
    stdbuf -oL claude \
      --model sonnet \
      --dangerously-skip-permissions \
      --print \
      --output-format stream-json \
      --verbose \
      -p "$prompt" 2>&1 \
    | stdbuf -oL jq -R -r --unbuffered --arg tzoff "$(date '+%z')" '
        def fmt: localtime | strftime("%Y-%m-%dT%H:%M:%S") + $tzoff;
        def ts: now | fmt;
        def strip_ms: sub("\\.[0-9]+Z$"; "Z");
        def to_local(s): try (s | strip_ms | fromdateiso8601 | localtime | strftime("%Y-%m-%dT%H:%M:%S") + $tzoff) catch ts;
        . as $line
        | (try fromjson catch null) as $msg
        | if $msg == null then
            "[" + ts + "] [stderr] " + $line
          elif $msg.type == "assistant" then
            (if $msg.timestamp then to_local($msg.timestamp) else ts end) as $t
            | (($msg.message.content // [])
                | map(if .type == "text" then .text else empty end)
                | join("\n")) as $txt
            | if ($txt | length) > 0 then "[" + $t + "] " + $txt else empty end
          elif $msg.type == "result" then
            (if $msg.timestamp then to_local($msg.timestamp) else ts end) as $t
            | "[" + $t + "] [result " + ($msg.subtype // "?")
              + (if ($msg.is_error // false) then " ERROR" else "" end)
              + " turns=" + (($msg.num_turns // 0) | tostring)
              + " cost=$" + (($msg.total_cost_usd // 0) | tostring)
              + "] " + ($msg.result // "(no result)")
          else empty
          end
      ' > "$resolver_log" || exit_code=$?

  if [ $exit_code -eq 124 ]; then
    log_task "$task_id" "conflict resolver TIMEOUT after 10min (see $resolver_log)"
  elif [ $exit_code -ne 0 ]; then
    log_task "$task_id" "conflict resolver exited with code $exit_code (see $resolver_log)"
  fi

  # Success criteria: merge state cleared AND new commit references the task.
  # Both must hold — a stray commit on the branch without the merge being
  # completed would still leave MERGE_HEAD set.
  if [ -f "$REPO_ROOT/.git/MERGE_HEAD" ]; then
    log_task "$task_id" "conflict resolver did not complete the merge"
    return 1
  fi

  local last_msg
  last_msg=$(git -C "$REPO_ROOT" log -1 --format='%s' 2>/dev/null || true)
  if ! echo "$last_msg" | grep -qF "$task_id"; then
    log_task "$task_id" "conflict resolver commit does not reference $task_id"
    return 1
  fi

  return 0
}

# ============================================================================
# Worker: runs one task in a worktree
# ============================================================================

run_worker() {
  local task_id="$1"
  local branch
  branch=$(branch_name "$task_id")
  local worktree_dir="$WORKTREE_BASE/$task_id"
  local logfile="$LOG_DIR/${task_id}.log"
  local worker_start
  worker_start=$(date +%s)

  log_task "$task_id" "Starting -> branch: $branch"

  # Serialize git setup (branch + worktree creation)
  git_lock

  cd "$REPO_ROOT"
  git branch "$branch" "$BASE_BRANCH" 2>/dev/null || true

  if [ -d "$worktree_dir" ]; then
    git worktree remove "$worktree_dir" --force 2>/dev/null || rm -rf "$worktree_dir"
  fi
  git worktree add "$worktree_dir" "$branch" >/dev/null 2>&1

  git_unlock

  # Install dependencies in the worktree. Output is discarded — npm chatter
  # on a warm cache ("up to date in 470ms") is not worth a per-task log file.
  # Install failures are flagged so the operator can re-run install manually;
  # the agent still gets to attempt the task and may succeed if cache is good.
  cd "$worktree_dir"
  log_task "$task_id" "Installing dependencies..."
  if ! eval "$INSTALL_CMD" >/dev/null 2>&1; then
    log_task "$task_id" "Dependency install failed — agent will need to resolve"
  fi

  # Build enriched prompt with story context
  local story_json
  story_json=$(jq -r ".${STORIES_FIELD}[] | select(.id == \"$task_id\")" "$PRD" 2>/dev/null)
  local story_title story_desc story_criteria story_tags
  story_title=$(echo "$story_json" | jq -r '.title // empty')
  story_desc=$(echo "$story_json" | jq -r '.description // empty')
  story_criteria=$(echo "$story_json" | jq -r '
    if .acceptanceCriteria then
      if (.acceptanceCriteria | type) == "array" then
        .acceptanceCriteria | map("- " + .) | join("\n")
      else .acceptanceCriteria end
    elif .acceptance_criteria then
      if (.acceptance_criteria | type) == "array" then
        .acceptance_criteria | map("- " + .) | join("\n")
      else .acceptance_criteria end
    else empty end')
  story_tags=$(echo "$story_json" | jq -r '
    if .tags then
      if (.tags | type) == "array" then .tags | join(", ")
      else .tags end
    else empty end')

  # Lazy playwright-skill setup: only when THIS task has tag `ui`.
  # Chromium download (~300MB) is deferred until actually needed.
  # Flock serializes parallel UI tasks so chromium cache isn't fetched twice.
  if echo "$story_tags" | grep -qw "ui"; then
    local pw_skill_dir="$worktree_dir/scripts/ralph/skills/playwright-skill"
    if [ -f "$pw_skill_dir/package.json" ] && [ ! -d "$pw_skill_dir/node_modules" ]; then
      local pw_lock_file="$LOCK_DIR/playwright-setup.lock"
      log_task "$task_id" "Task has tag 'ui' — installing playwright-skill runtime..."
      (
        exec {pw_fd}>"$pw_lock_file"
        flock -x "$pw_fd"
        (cd "$pw_skill_dir" && npm run setup 2>&1)
      ) > "$logfile.pw" 2>&1 || {
        log_task "$task_id" "playwright-skill setup failed (check $logfile.pw)"
      }
    fi
  fi

  local recent_progress=""
  if [ -f "$SCRIPT_DIR/progress.txt" ]; then
    recent_progress=$(tail -30 "$SCRIPT_DIR/progress.txt" 2>/dev/null || true)
  fi

  local last_failure_file="$LOG_DIR/${task_id}.last_failure.txt"
  local last_failure=""
  if [ -f "$last_failure_file" ]; then
    last_failure=$(cat "$last_failure_file" 2>/dev/null || true)
  fi

  # Compute soft-deadline window so the agent has time to write a graceful
  # failure report before SIGKILL. If the configured buffer would leave less
  # than 60s of working time, fall back to half the timeout — still better
  # than nothing, and obvious to the agent that the task is too tight.
  local soft_deadline_sec deadline_epoch
  soft_deadline_sec=$(( TASK_TIMEOUT_SEC - SOFT_DEADLINE_BUFFER_SEC ))
  if [ "$soft_deadline_sec" -lt 60 ]; then
    soft_deadline_sec=$(( TASK_TIMEOUT_SEC / 2 ))
  fi
  deadline_epoch=$(( $(date +%s) + soft_deadline_sec ))

  local enriched_prompt
  enriched_prompt="You are Ralph, an autonomous coding agent. Read scripts/ralph/CLAUDE.md and follow ALL instructions there.

YOUR TASK: $task_id - $story_title
$([ -n "$story_desc" ] && echo "
DESCRIPTION:
$story_desc")
$([ -n "$story_criteria" ] && echo "
ACCEPTANCE CRITERIA:
$story_criteria")
$([ -n "$story_tags" ] && echo "
TAGS: $story_tags")
$([ -n "$last_failure" ] && echo "
PREVIOUS ATTEMPT FAILED:
$last_failure

Fix these issues specifically.")

TIME BUDGET (HARD CONSTRAINT):
- Hard timeout: ${TASK_TIMEOUT_SEC}s. After this you are SIGKILLed mid-step — no chance to write anything.
- Soft deadline: ${soft_deadline_sec}s from agent start (= hard timeout minus a ${SOFT_DEADLINE_BUFFER_SEC}s graceful-shutdown buffer).
- Absolute deadline epoch is exposed as env var \$RALPH_DEADLINE_EPOCH. Check elapsed periodically with: test \$(date +%s) -ge \$RALPH_DEADLINE_EPOCH
- When you reach the soft deadline, regardless of progress:
  1. STOP. No new file edits. No new tool calls except printing your final report.
  2. Print a clearly-marked block to stdout starting with the literal line 'TIMEOUT REPORT:' followed by:
     - what you attempted, what's working, what's blocking, exact file/line where you stopped.
  3. Do NOT commit partial work and do NOT set passes:true. Exit cleanly — the orchestrator sees passes is still false, captures your TIMEOUT REPORT plus any unstaged diff, and feeds it to the next retry.
- The 10-minute buffer is reserved for steps 1-3. Do not eat into it with 'just one more thing'.

RULES:
- Work ONLY on task $task_id. Do NOT touch other stories.
- You are already on the correct branch - do NOT switch branches.
- The project PRD is at $PRD_REL.
- After implementing, run quality checks. Then BEFORE committing:
  1. Edit $PRD_REL and set \`.${STORIES_FIELD}[] | select(.id == \"$task_id\") | .passes\` to \`true\` (and ONLY for $task_id — leave other stories alone).
  2. \`git add\` your code changes AND $PRD_REL.
  3. Commit with message: \`feat: $task_id - <short title>\`. Push is handled by the orchestrator.
- SUCCESS SIGNAL: the orchestrator decides this task succeeded ONLY by reading $PRD_REL from your latest commit and confirming \`passes == true\` for $task_id. If passes is still false in your commit, your work will be rejected and the worktree discarded — even if every other check passed.
$([ -n "$recent_progress" ] && echo "
RECENT PROGRESS (from prior iterations):
$recent_progress")"

  # Run claude in worktree (wrapped in timeout — kills hung agents).
  # Filter the stream-json transcript through jq before writing $logfile so we
  # keep only the entries worth reading later — assistant text, result summary,
  # and rate_limit_event status — each prefixed with an ISO-8601 timestamp.
  # User/system/tool_result lines are dropped (they balloon the file with no
  # human-readable signal). Non-JSON stderr noise (crashes, timeout messages)
  # is passed through with a wallclock timestamp so signal-related errors
  # aren't silently dropped.
  # pipefail (set at top of file) ensures claude's exit code (e.g. 124 on
  # timeout) propagates even when jq exits 0 at the end of the pipe.
  log_task "$task_id" "Running claude in worktree (hard ${TASK_TIMEOUT_SEC}s, soft ${soft_deadline_sec}s)..."

  local exit_code=0
  # Wrap the agent in `setsid` so we can reap any long-running children
  # (dev servers, playwright, etc.) it forgot to stop before exiting.
  # The inner bash records its own PID — which equals the new session's
  # leader and SID — into $sid_file; we sweep that session after the
  # pipeline finishes regardless of outcome. The agent's CLAUDE.md asks
  # it to clean up its own PIDs, but we cannot rely on that, so the
  # orchestrator enforces teardown unconditionally.
  local sid_file="$SESSION_DIR/${task_id}.sid"
  rm -f "$sid_file"
  RALPH_TASK_ID="$task_id" \
  RALPH_TIMEOUT_SEC="$TASK_TIMEOUT_SEC" \
  RALPH_SOFT_DEADLINE_SEC="$soft_deadline_sec" \
  RALPH_DEADLINE_EPOCH="$deadline_epoch" \
  RALPH_SID_FILE="$sid_file" \
  RALPH_MODEL="$MODEL" \
  RALPH_PROMPT="$enriched_prompt" \
  setsid bash -c '
    echo "$$" > "$RALPH_SID_FILE"
    exec timeout "$RALPH_TIMEOUT_SEC" stdbuf -oL claude \
      --model "$RALPH_MODEL" \
      --dangerously-skip-permissions \
      --print \
      --output-format stream-json \
      --verbose \
      -p "$RALPH_PROMPT" 2>&1
  ' \
  | stdbuf -oL jq -R -r --unbuffered --arg tzoff "$(date '+%z')" '
      # All timestamps render in Warsaw local time (TZ=Europe/Warsaw is
      # exported by ralph.sh). SDK-supplied $msg.timestamp values arrive as
      # UTC ISO strings ("…Z", possibly with a millisecond fraction) — strip
      # the fraction, parse, convert to local, and append the offset captured
      # at script start (--arg tzoff). Doing this in jq alone is unreliable:
      # strftime("%z") and mktime both mis-handle the offset on common builds.
      def fmt: localtime | strftime("%Y-%m-%dT%H:%M:%S") + $tzoff;
      def ts: now | fmt;
      def strip_ms: sub("\\.[0-9]+Z$"; "Z");
      def to_local(s): try (s | strip_ms | fromdateiso8601 | localtime | strftime("%Y-%m-%dT%H:%M:%S") + $tzoff) catch ts;
      . as $line
      | (try fromjson catch null) as $msg
      | if $msg == null then
          "[" + ts + "] [stderr] " + $line
        elif $msg.type == "assistant" then
          (if $msg.timestamp then to_local($msg.timestamp) else ts end) as $t
          | (($msg.message.content // [])
              | map(if .type == "text" then .text else empty end)
              | join("\n")) as $txt
          | if ($txt | length) > 0 then "[" + $t + "] " + $txt else empty end
        elif $msg.type == "result" then
          (if $msg.timestamp then to_local($msg.timestamp) else ts end) as $t
          | "[" + $t + "] [result " + ($msg.subtype // "?")
            + (if ($msg.is_error // false) then " ERROR" else "" end)
            + " turns=" + (($msg.num_turns // 0) | tostring)
            + " cost=$" + (($msg.total_cost_usd // 0) | tostring)
            + "] " + ($msg.result // "(no result)")
        elif $msg.type == "rate_limit_event" then
          (if $msg.timestamp then to_local($msg.timestamp) else ts end) as $t
          | ($msg.rate_limit_info // {}) as $rl
          | "[" + $t + "] [rate_limit " + ($rl.rateLimitType // "?")
            + " status=" + ($rl.status // "?")
            + (if ($rl.isUsingOverage // false) then " (overage)" else "" end)
            + "]"
        else empty
        end
    ' > "$logfile" || exit_code=$?

  # Sweep the agent's session even on success — leaked dev servers
  # hold ports and block the next worker. Runs before any exit_code
  # branching so timeout/error paths also benefit.
  local agent_sid=""
  [ -f "$sid_file" ] && agent_sid=$(cat "$sid_file" 2>/dev/null || echo "")
  rm -f "$sid_file"
  if [ -n "$agent_sid" ]; then
    kill_session "$agent_sid" "$task_id"
  fi

  if [ $exit_code -eq 124 ]; then
    log_task "$task_id" "${RED}TIMEOUT${RST} after ${TASK_TIMEOUT_SEC}s — running diagnostician..."
    capture_failure_context "$task_id" "$worktree_dir" "$logfile" "$last_failure_file" \
      "TIMEOUT after ${TASK_TIMEOUT_SEC}s. Agent was killed mid-run — likely scope too large, infinite loop, or stuck on a single problem. Narrow your approach and commit incrementally."

    run_diagnostician "$task_id" "$worktree_dir" "$logfile" "$last_failure_file" "$branch"

    # Diagnostician may have salvaged a near-miss timeout (work done, just no
    # commit yet). Re-check passes from HEAD; if true, fall through to the
    # normal validate+push flow. If still false, clean up as before.
    cd "$worktree_dir"
    local _to_passes=""
    _to_passes=$(git -C "$worktree_dir" show "HEAD:$PRD_REL" 2>/dev/null \
      | jq -r ".${STORIES_FIELD}[] | select(.id == \"$task_id\") | .passes" 2>/dev/null \
      || echo "")

    if [ "$_to_passes" = "true" ]; then
      log_task "$task_id" "${GREEN}Diagnostician finished the task post-timeout${RST} — proceeding"
      rm -f "$last_failure_file"
      # Fall through; the passes check below sees passes=true and skips.
    else
      git_lock
      cd "$REPO_ROOT"
      git worktree remove "$worktree_dir" --force 2>/dev/null || true
      git branch -D "$branch" 2>/dev/null || true
      git_unlock
      return 1
    fi
  fi

  if [ $exit_code -ne 0 ]; then
    log_task "$task_id" "claude exited with code $exit_code (check $logfile)"
  fi

  # Success criterion: the agent must have set passes:true for this story in
  # prd.json AND committed it. We read prd.json from HEAD (committed state),
  # not the worktree, so an unstaged edit doesn't fool us — only what's in
  # the commit graph gets pushed and merged.
  cd "$worktree_dir"
  local commits_ahead
  commits_ahead=$(git rev-list "$BASE_BRANCH".."$branch" --count 2>/dev/null || echo "0")
  local passes_value=""
  if [ "$commits_ahead" -gt 0 ]; then
    passes_value=$(git -C "$worktree_dir" show "HEAD:$PRD_REL" 2>/dev/null \
      | jq -r ".${STORIES_FIELD}[] | select(.id == \"$task_id\") | .passes" 2>/dev/null \
      || echo "")
  fi

  if [ "$passes_value" != "true" ]; then
    local reason
    if [ "$commits_ahead" -eq 0 ]; then
      log_task "$task_id" "${RED}Agent did not commit${RST} — running diagnostician..."
      reason="Agent finished but produced 0 commits. You MUST set passes:true for $task_id in $PRD_REL AND run 'git commit' before exiting — uncommitted work is captured below for the next retry to rebuild."
    else
      log_task "$task_id" "${RED}Agent did not set passes:true in prd.json${RST} — running diagnostician..."
      reason="Agent committed work but did NOT set passes:true for $task_id in $PRD_REL. Edit $PRD_REL, set this story's passes field to true, and commit (amend or new commit) before exiting. The orchestrator treats passes:true in the committed prd.json as the sole success signal."
    fi
    capture_failure_context "$task_id" "$worktree_dir" "$logfile" "$last_failure_file" "$reason"

    run_diagnostician "$task_id" "$worktree_dir" "$logfile" "$last_failure_file" "$branch"

    # Re-check passes from HEAD after diagnostician. If it flipped to true,
    # fall through to validate+push; otherwise clean up and return 1 as before.
    cd "$worktree_dir"
    commits_ahead=$(git rev-list "$BASE_BRANCH".."$branch" --count 2>/dev/null || echo "0")
    passes_value=""
    if [ "$commits_ahead" -gt 0 ]; then
      passes_value=$(git -C "$worktree_dir" show "HEAD:$PRD_REL" 2>/dev/null \
        | jq -r ".${STORIES_FIELD}[] | select(.id == \"$task_id\") | .passes" 2>/dev/null \
        || echo "")
    fi

    if [ "$passes_value" = "true" ]; then
      log_task "$task_id" "${GREEN}Diagnostician finished the task${RST} — proceeding to validate + push"
      rm -f "$last_failure_file"
      # Fall through to validation gate + push below.
    else
      git_lock
      cd "$REPO_ROOT"
      git worktree remove "$worktree_dir" --force 2>/dev/null || true
      git branch -D "$branch" 2>/dev/null || true
      git_unlock
      return 1
    fi
  fi

  # Validation gate: run VALIDATE_CMD before allowing merge
  if [ -n "$VALIDATE_CMD" ]; then
    log_task "$task_id" "Validating ($VALIDATE_CMD)..."
    cd "$worktree_dir"
    local val_exit=0
    eval "$VALIDATE_CMD" > "$logfile.validate" 2>&1 || val_exit=$?
    if [ $val_exit -ne 0 ]; then
      log_task "$task_id" "${RED}Validation FAILED${RST} (exit $val_exit) — see $logfile.validate"
      {
        echo "Validation command failed: $VALIDATE_CMD (exit $val_exit)"
        echo ""
        echo "Last 50 lines of validation output:"
        tail -50 "$logfile.validate" 2>/dev/null || true
      } > "$last_failure_file" 2>/dev/null || true
      git_lock
      cd "$REPO_ROOT"
      git worktree remove "$worktree_dir" --force 2>/dev/null || true
      git branch -D "$branch" 2>/dev/null || true
      git_unlock
      return 1
    fi
    log_task "$task_id" "${GREEN}Validation passed${RST}"
  fi

  # Task cleared validation — drop any stale failure log
  rm -f "$last_failure_file"

  # Push branch. Plain push (no --force-with-lease): this branch was just
  # created from BASE_BRANCH and has no prior remote state to protect against.
  cd "$worktree_dir"
  if ! git push -u origin "$branch" >/dev/null 2>&1; then
    log_task "$task_id" "${RED}Push failed${RST} — task will be retried"
    git_lock
    cd "$REPO_ROOT"
    git worktree remove "$worktree_dir" --force 2>/dev/null || true
    git branch -D "$branch" 2>/dev/null || true
    git_unlock
    return 1
  fi
  log_task "$task_id" "Pushed $commits_ahead commit(s) to $branch"

  # Cleanup worktree (keep branch for merge)
  git_lock
  cd "$REPO_ROOT"
  git worktree remove "$worktree_dir" --force 2>/dev/null || true
  git_unlock

  local elapsed
  elapsed=$(elapsed_since "$worker_start")
  log_task "$task_id" "${GREEN}Done${RST} ($elapsed)"
  return 0
}

# ============================================================================
# Merge: merge completed branches back to base
# ============================================================================

merge_tasks() {
  local tasks=("$@")
  merge_failed=()
  local merged_ok=()
  log "Merging ${#tasks[@]} branch(es) -> $BASE_BRANCH"

  cd "$REPO_ROOT"
  git checkout "$BASE_BRANCH" >/dev/null 2>&1
  git pull --rebase origin "$BASE_BRANCH" >/dev/null 2>&1 || true

  for task_id in "${tasks[@]}"; do
    local branch
    branch=$(branch_name "$task_id")
    local t_title
    t_title=$(task_title "$task_id")

    if ! git rev-parse --verify "$branch" &>/dev/null; then
      log_task "$task_id" "Branch $branch not found - skipping merge"
      continue
    fi

    local merge_status="clean"
    if git merge --no-ff --no-edit "$branch" >/dev/null 2>&1; then
      :
    else
      merge_status="conflict"
      log_task "$task_id" "Conflict detected - analyzing..."

      # Categorize conflicting files
      local conflicted_files auto_resolvable=() needs_human=()
      conflicted_files=$(git diff --name-only --diff-filter=U 2>/dev/null || true)

      while IFS= read -r cf; do
        [ -z "$cf" ] && continue
        case "$cf" in
          "$PRD_REL")                 auto_resolvable+=("$cf") ;;
          package-lock.json)          auto_resolvable+=("$cf") ;;
          *.lock)                     auto_resolvable+=("$cf") ;;
          .gitignore)                 auto_resolvable+=("$cf") ;;
          *)                          needs_human+=("$cf") ;;
        esac
      done <<< "$conflicted_files"

      local prd_conflicted=false
      for af in "${auto_resolvable[@]}"; do
        if [ "$af" = "$PRD_REL" ]; then
          prd_conflicted=true
          break
        fi
      done

      # Pre-resolve deterministic auto-mergeable files (lockfiles, .gitignore).
      # prd.json is handled below: pre-resolved on the auto-only path so the
      # batch finishes without invoking an agent, but handed to the resolver
      # when source conflicts need agent attention so resolver can preserve
      # any progress recorded on base since this branch was created.
      for af in "${auto_resolvable[@]}"; do
        [ "$af" = "$PRD_REL" ] && continue
        git checkout --theirs "$af" 2>/dev/null || true
        git add "$af" 2>/dev/null || true
      done

      if [ ${#needs_human[@]} -gt 0 ]; then
        # Build the file list the resolver must handle. Include $PRD_REL when
        # it had a real conflict — resolver applies the prd.json rules.
        local resolver_files=("${needs_human[@]}")
        if [ "$prd_conflicted" = true ]; then
          resolver_files+=("$PRD_REL")
        fi

        log_task "$task_id" "${YELLOW}Source conflict in ${#resolver_files[@]} file(s):${RST} ${resolver_files[*]} — running conflict resolver..."

        local needs_human_list
        needs_human_list=$(printf '  - %s\n' "${resolver_files[@]}")

        if run_conflict_resolver "$task_id" "$branch" "$needs_human_list" "$prd_conflicted"; then
          log_task "$task_id" "${GREEN}Conflict resolver completed merge${RST}"
        else
          log_task "$task_id" "${RED}Conflict resolver could not resolve${RST} — aborting merge"
          git merge --abort 2>/dev/null || true
          log_task "$task_id" "Merge aborted — task will retry on fresh base"
          git branch -D "$branch" 2>/dev/null || true
          git push origin --delete "$branch" 2>/dev/null || true
          merge_failed+=("$task_id")
          continue
        fi
      else
        # Auto-only path: pre-resolve prd.json deterministically (take base,
        # re-apply mark_done so this task's passes:true survives the --ours
        # pick), then finalize the merge ourselves. -A is safe because every
        # conflicted file was already resolved and `git add`-ed above; nothing
        # unresolved remains in the worktree.
        if [ "$prd_conflicted" = true ]; then
          git checkout --ours "$PRD_REL" 2>/dev/null || true
          mark_done "$task_id"
          git add "$PRD_REL" 2>/dev/null || true
        fi
        git add -A
        git commit --no-edit -m "merge: $task_id with auto-resolved conflicts" >/dev/null 2>&1 || true
      fi
    fi

    # One-line merge summary
    local shortstat files_n ins_n del_n
    shortstat=$(git diff --shortstat HEAD~1 HEAD -- . ":!$PRD_REL" 2>/dev/null || true)
    files_n=$(echo "$shortstat" | grep -oP '\d+ file' | grep -oP '\d+' || echo "0")
    ins_n=$(echo "$shortstat" | grep -oP '\d+ insertion' | grep -oP '\d+' || echo "0")
    del_n=$(echo "$shortstat" | grep -oP '\d+ deletion' | grep -oP '\d+' || echo "0")
    log_ok "Merged $task_id: $t_title ($files_n files, +$ins_n/-$del_n, $merge_status)"

    # passes:true is set by the agent and arrives via the merge; the conflict
    # branch above re-applies mark_done if --ours discarded it. Defensive
    # mark_done here in case neither path ran (e.g. fast-forward of a stale
    # branch where the commit somehow lacked the prd.json update).
    if [ "$(jq -r ".${STORIES_FIELD}[] | select(.id == \"$task_id\") | .passes" "$PRD" 2>/dev/null)" != "true" ]; then
      mark_done "$task_id"
    fi
    merged_ok+=("$task_id")

    # Cleanup branch
    git branch -D "$branch" 2>/dev/null || true
    git push origin --delete "$branch" 2>/dev/null || true
  done

  # Persist prd.json passes-field updates and the run logs from this batch.
  # Without this, completion state and agent stdout exist only in the local
  # working tree and are silently lost when the next merge_tasks runs `git
  # pull --rebase` or when the workstation is wiped.
  if [ ${#merged_ok[@]} -gt 0 ]; then
    commit_progress "chore(ralph): mark ${merged_ok[*]} done + update logs"
  fi

  git push origin "$BASE_BRANCH" >/dev/null 2>&1 || true
  log_ok "Pushed to $BASE_BRANCH"
}

# ============================================================================
# PR mode: open GitHub PRs instead of merging (human-gated)
# ============================================================================

# For each successful task, push the branch is already done in run_worker; here
# we just call `gh pr create` against BASE_BRANCH. Stories stay passes=false
# until a subsequent ralph invocation detects the PR as merged.
open_prs() {
  local tasks=("$@")
  log "PR mode: opening ${#tasks[@]} PR(s) against $BASE_BRANCH"

  cd "$REPO_ROOT"
  local opened=0 failed_pr=0
  for task_id in "${tasks[@]}"; do
    local branch
    branch=$(branch_name "$task_id")
    local t_title
    t_title=$(task_title "$task_id")

    if ! git ls-remote --exit-code --heads origin "$branch" &>/dev/null; then
      log_task "$task_id" "branch $branch missing on origin — skipping PR"
      continue
    fi

    local story_json story_desc story_criteria
    story_json=$(jq -r ".${STORIES_FIELD}[] | select(.id == \"$task_id\")" "$PRD" 2>/dev/null)
    story_desc=$(echo "$story_json" | jq -r '.description // ""')
    story_criteria=$(echo "$story_json" | jq -r '
      if .acceptanceCriteria and (.acceptanceCriteria | type) == "array"
      then .acceptanceCriteria | map("- " + .) | join("\n")
      else "" end')

    # Body uses printf to avoid shell-expansion surprises from user-authored
    # story content (backticks, $vars) — safer than a heredoc here.
    local body
    body=$(printf 'Story: %s — %s\n\n%s\n\nAcceptance criteria:\n%s\n\n---\nOpened automatically by Ralph. Merge to complete the story; the next ralph run will detect it and mark the story done in prd.json.\n' \
      "$task_id" "$t_title" "$story_desc" "$story_criteria")

    local pr_url
    if pr_url=$(gh pr create \
        --base "$BASE_BRANCH" \
        --head "$branch" \
        --title "ralph: $task_id $t_title" \
        --body "$body" 2>&1); then
      log_ok "PR opened for $task_id: $pr_url"
      opened=$(( opened + 1 ))
    else
      log_fail "gh pr create failed for $task_id: $pr_url"
      failed_pr=$(( failed_pr + 1 ))
    fi
  done

  log_ok "Opened $opened PR(s)$([ $failed_pr -gt 0 ] && echo " ($failed_pr failed)")"
}

# Skip tasks that already have their branch on origin — a PR for them is
# presumably in flight from a previous run. Prevents opening duplicate PRs
# or re-running work that's waiting on human review.
filter_in_flight_tasks() {
  cd "$REPO_ROOT"
  for tid in "$@"; do
    local branch
    branch=$(branch_name "$tid")
    if git ls-remote --exit-code --heads origin "$branch" &>/dev/null; then
      log_task "$tid" "skipping: branch exists on origin (PR likely in flight)" >&2
      continue
    fi
    echo "$tid"
  done
}

# At the start of a PR-mode run, detect stories whose PRs were merged since
# last time and mark them done locally. This is how passes=true gets set in
# PR mode — the reviewer merges the PR, ralph picks it up next run.
reconcile_merged_prs() {
  log "PR mode: reconciling merged PRs against prd.json..."

  local merged_branches
  merged_branches=$(gh pr list --state merged --base "$BASE_BRANCH" --limit 200 \
    --json headRefName -q '.[].headRefName' 2>/dev/null | grep '^ralph/' || true)

  if [ -z "$merged_branches" ]; then
    log "No merged ralph PRs found"
    return 0
  fi

  local reconciled=0
  cd "$REPO_ROOT"
  git checkout "$BASE_BRANCH" >/dev/null 2>&1
  git pull --rebase origin "$BASE_BRANCH" >/dev/null 2>&1 || true

  for tid in $(jq -r ".${STORIES_FIELD}[] | select(.passes == false) | .id" "$PRD" 2>/dev/null); do
    local branch
    branch=$(branch_name "$tid")
    if echo "$merged_branches" | grep -qxF "$branch"; then
      log_ok "Detected merged PR for $tid — marking done"
      mark_done "$tid"
      reconciled=$(( reconciled + 1 ))
    fi
  done

  if [ "$reconciled" -gt 0 ]; then
    commit_progress "chore(ralph): reconcile $reconciled merged PR(s) into prd.json"
    git push origin "$BASE_BRANCH" >/dev/null 2>&1 || true
    log_ok "Reconciled $reconciled merged PR(s) and pushed to $BASE_BRANCH"
  fi
}

# ============================================================================
# Main Loop
# ============================================================================

# When sourced by the test suite, stop before the main loop so tests can
# exercise the helper functions in isolation.
if [[ "${RALPH_TEST_MODE:-0}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

# Install AFTER the test-mode early-return so bats tests don't inherit the
# trap when they source this file.
trap cleanup_on_interrupt INT TERM

log "Ralph starting | parallel=$PARALLEL model=$MODEL mode=$MODE base=$BASE_BRANCH max_iter=$MAX_ITERATIONS max_retry=$MAX_RETRIES"
if [ -n "$VALIDATE_CMD" ]; then
  log "Validate: $VALIDATE_CMD"
else
  log "Validate: disabled (set VALIDATE_CMD in ralph.config)"
fi

cd "$REPO_ROOT"
git checkout "$BASE_BRANCH" >/dev/null 2>&1
git pull --rebase origin "$BASE_BRANCH" >/dev/null 2>&1 || true

# In PR mode, pick up stories whose PRs got merged since last run before we
# count totals or pick tasks. This is the closest we get to "sync".
if [ "$MODE" = "pr" ]; then
  reconcile_merged_prs
  cache_task_titles
fi

total_tasks=$(count_total)
log "Tasks: $total_tasks total"

# Ensure lock directory exists (flock uses file-based locks, no stale lock cleanup needed)
touch "$GIT_LOCK_FILE" 2>/dev/null || true

batch_num=0
iteration=0
while [ $iteration -lt $MAX_ITERATIONS ]; do
  # Refresh title cache and counts each batch
  cache_task_titles
  rotate_progress
  pending=$(count_pending)
  completed=$(( total_tasks - pending ))

  if [ "$pending" -eq 0 ]; then
    log_ok "ALL TASKS DONE ($completed/$total_tasks) in $iteration iterations, elapsed $(elapsed_since $SCRIPT_START)"
    gave_up_count=$(jq '[.[] | select(.gave_up == true)] | length' "$FAILED_REPORT")
    if [ "$gave_up_count" -gt 0 ]; then
      log_warn "$gave_up_count task(s) had failures (later completed on retry) — see $FAILED_REPORT"
    fi
    flush_artifacts "chore(ralph): final artifacts after run completed"
    rm -rf "$LOCK_DIR"
    exit 0
  fi

  batch_num=$(( batch_num + 1 ))
  log "Batch $batch_num | $completed/$total_tasks done | $pending pending | elapsed $(elapsed_since $SCRIPT_START)"

  mapfile -t batch < <(get_pending_tasks)

  # In PR mode, drop tasks whose branches already exist on origin — those
  # have open PRs waiting for review, so running them again would either
  # conflict or produce a duplicate PR.
  if [ "$MODE" = "pr" ] && [ ${#batch[@]} -gt 0 ]; then
    mapfile -t batch < <(filter_in_flight_tasks "${batch[@]}")
  fi

  if [ ${#batch[@]} -eq 0 ]; then
    if [ "$MODE" = "pr" ]; then
      log_warn "No pending tasks to run (all either in-flight or retry-exhausted). Merge open PRs and re-run."
    else
      log_warn "No pending tasks found (all exhausted retries?)"
    fi
    flush_artifacts "chore(ralph): final artifacts (no runnable tasks)"
    exit 0
  fi

  # Cap to PARALLEL limit
  run_batch=("${batch[@]:0:$PARALLEL}")

  for tid in "${run_batch[@]}"; do
    log_task "$tid" "queued: $(task_title "$tid")"
  done

  # Launch workers
  ACTIVE_PIDS=()
  local_batch_start=$(date +%s)
  for task_id in "${run_batch[@]}"; do
    run_worker "$task_id" &
    ACTIVE_PIDS+=($!)
    iteration=$(( iteration + 1 ))
  done

  # Wait for all workers
  failed=()
  for i in "${!ACTIVE_PIDS[@]}"; do
    if ! wait "${ACTIVE_PIDS[$i]}"; then
      failed+=("${run_batch[$i]}")
    fi
  done
  # Batch drained — clear so the trap doesn't try to signal exited PIDs.
  ACTIVE_PIDS=()

  batch_elapsed=$(elapsed_since "$local_batch_start")

  # Report results
  succeeded=$(( ${#run_batch[@]} - ${#failed[@]} ))
  if [ "$succeeded" -gt 0 ]; then
    log_ok "$succeeded task(s) succeeded ($batch_elapsed)"
  fi

  if [ ${#failed[@]} -gt 0 ]; then
    log_fail "${#failed[@]} task(s) failed"
    for f in "${failed[@]}"; do
      RETRIES[$f]=$(( ${RETRIES[$f]:-0} + 1 ))
      report_failure "$f" "${RETRIES[$f]}" "$MAX_RETRIES"
      if [ "${RETRIES[$f]}" -le "$MAX_RETRIES" ]; then
        log_task "$f" "will retry (attempt ${RETRIES[$f]}/${MAX_RETRIES})"
      else
        log_task "$f" "${RED}GAVE UP${RST} after ${MAX_RETRIES} retries"
      fi
    done
  fi

  # Build merge list (exclude failed)
  merge_list=()
  for task_id in "${run_batch[@]}"; do
    is_failed=false
    for f in "${failed[@]}"; do
      if [ "$task_id" = "$f" ]; then is_failed=true; break; fi
    done
    if [ "$is_failed" = false ]; then
      merge_list+=("$task_id")
    fi
  done

  # Merge or open PRs for successful tasks
  if [ ${#merge_list[@]} -gt 0 ]; then
    if [ "$MODE" = "pr" ]; then
      open_prs "${merge_list[@]}"
      log_ok "PR mode: one batch complete. Review and merge the PRs, then re-run ralph."
      flush_artifacts "chore(ralph): PR-mode batch $batch_num artifacts"
      rm -rf "$LOCK_DIR"
      exit 0
    fi

    merge_tasks "${merge_list[@]}"

    # Handle tasks that failed during merge (source conflicts)
    for mf in "${merge_failed[@]}"; do
      RETRIES[$mf]=$(( ${RETRIES[$mf]:-0} + 1 ))
      report_failure "$mf" "${RETRIES[$mf]}" "$MAX_RETRIES"
      if [ "${RETRIES[$mf]}" -le "$MAX_RETRIES" ]; then
        log_task "$mf" "merge conflict — will retry on fresh base (attempt ${RETRIES[$mf]}/${MAX_RETRIES})"
      else
        log_task "$mf" "${RED}GAVE UP${RST} after ${MAX_RETRIES} retries (merge conflicts)"
      fi
    done
  fi

  # Flush any straggling artifacts from this batch — failure transcripts,
  # rotated progress logs, updated failed_report.json — so the next retry
  # (in this run or a future one on a clean checkout) has the failure context.
  # Idempotent: a no-op when merge_tasks already committed everything.
  flush_artifacts "chore(ralph): batch $batch_num artifacts (${#failed[@]} failed, ${#merge_list[@]} merged)"
done

log_fail "Reached max iterations ($MAX_ITERATIONS). $(count_pending) tasks remaining. Elapsed: $(elapsed_since $SCRIPT_START)"

# Final summary
gave_up_count=$(jq '[.[] | select(.gave_up == true)] | length' "$FAILED_REPORT")
if [ "$gave_up_count" -gt 0 ]; then
  log_fail "$gave_up_count task(s) gave up — details: $FAILED_REPORT"
  jq -r '.[] | select(.gave_up == true) | .id + ": " + .title + " (after " + (.attempt|tostring) + " attempts)"' "$FAILED_REPORT" | while read -r line; do
    log_fail "  $line"
  done
fi

flush_artifacts "chore(ralph): final artifacts after max-iteration stop"
rm -rf "$LOCK_DIR"
exit 1
