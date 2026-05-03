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
TASK_TIMEOUT_SEC=2400
# Reserve the last N seconds of TASK_TIMEOUT_SEC as a soft-deadline buffer.
# When the agent crosses (TASK_TIMEOUT_SEC - SOFT_DEADLINE_BUFFER_SEC) it must
# stop, print a TIMEOUT REPORT to stdout, and exit cleanly so the next retry
# has a real failure note instead of a SIGKILL'd transcript.
SOFT_DEADLINE_BUFFER_SEC=600
PROGRESS_ROTATE_LINES=200
if [ -f "$CONFIG_FILE" ]; then
  source "$CONFIG_FILE"
fi

PRD="$PRD_DIR/prd.json"
# Repo-relative path to prd.json, used for `git add` / `git checkout` /
# pathspec matches against `git diff --name-only` output. With the default
# PRD_DIR=$SCRIPT_DIR this is "scripts/ralph/prd.json", not "prd.json".
PRD_REL="${PRD#$REPO_ROOT/}"
WORKTREE_BASE="$REPO_ROOT/.worktrees"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_DIR_REL="${LOG_DIR#$REPO_ROOT/}"
LOCK_DIR="$REPO_ROOT/.ralph-locks"

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

mkdir -p "$LOG_DIR" "$LOCK_DIR" "$WORKTREE_BASE"

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

# Extract human-readable text from a JSONL stream-json log so failure reports
# and retry prompts stay readable. Falls back to a raw tail when the log isn't
# JSONL (older runs, or non-JSON stderr noise from `timeout` / shell wrappers).
format_log_tail() {
  local logfile="$1"
  local n_lines="${2:-40}"
  [ -s "$logfile" ] || return 0
  local extracted
  extracted=$(jq -R -r 'try (fromjson |
      if .type == "assistant" then
        (.message.content // []) | map(
          if .type == "text" then .text
          elif .type == "tool_use" then "→ " + .name + " " + ((.input // {}) | tostring | .[0:200])
          else empty end
        ) | join("\n")
      elif .type == "user" then
        (.message.content // []) | map(
          if .type == "tool_result" then
            "  ← " + (if (.content | type) == "string" then .content else (.content | tostring) end | .[0:300])
          else empty end
        ) | join("\n")
      elif .type == "result" then
        "RESULT (" + (.subtype // "?") + "): " + (.result // "(no result)")
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
  rm -rf "$LOCK_DIR" 2>/dev/null || true
  exit 130
}

# ============================================================================
# Core helpers
# ============================================================================

report_failure() {
  local task_id="$1"
  local attempt="$2"
  local max="$3"
  local t_title
  t_title=$(jq -r ".${STORIES_FIELD}[] | select(.id == \"$task_id\") | .title" "$PRD")
  local logfile="$LOG_DIR/${task_id}.log"
  local last_lines=""
  if [ -f "$logfile" ]; then
    last_lines=$(format_log_tail "$logfile" 20 | jq -Rs .)
  else
    last_lines='""'
  fi

  local tmp="$FAILED_REPORT.tmp.$$"
  jq --arg id "$task_id" \
     --arg title "$t_title" \
     --argjson attempt "$attempt" \
     --argjson max "$max" \
     --arg time "$(date -Iseconds)" \
     --arg log "$logfile" \
     --argjson tail "$last_lines" \
     '. |= map(select(.id != $id)) + [{
       id: $id,
       title: $title,
       attempt: $attempt,
       max_retries: $max,
       gave_up: ($attempt > $max),
       timestamp: $time,
       logfile: $log,
       last_output: $tail
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

# Stage prd.json + ralph logs and create a commit on BASE_BRANCH so completion
# state and run logs persist across runs. Idempotent — exits cleanly when
# nothing is staged. Caller is responsible for `git push` afterwards.
commit_progress() {
  local message="$1"
  cd "$REPO_ROOT"
  git add "$PRD_REL" "$LOG_DIR_REL" 2>/dev/null || true
  if git diff --cached --quiet 2>/dev/null; then
    return 0
  fi
  git commit -m "$message" >/dev/null || return 1
  log_ok "Committed ralph progress: $message"
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

# Persist a failure note for the next retry attempt. Captures the agent's last
# stdout, plus git status / diff stats from the worktree so the next iteration
# knows what was attempted (file paths, scope) before the worktree was wiped.
# MUST be called before `git worktree remove` — once the worktree is gone, the
# uncommitted diff is unrecoverable.
capture_failure_context() {
  local task_id="$1"
  local worktree_dir="$2"
  local logfile="$3"
  local last_failure_file="$4"
  local reason="$5"

  {
    echo "$reason"
    echo ""
    if [ -d "$worktree_dir/.git" ] || [ -f "$worktree_dir/.git" ]; then
      local status diffstat
      status=$(git -C "$worktree_dir" status --short 2>/dev/null || true)
      diffstat=$(git -C "$worktree_dir" diff --stat 2>/dev/null || true)
      if [ -n "$status" ]; then
        echo "Uncommitted changes in worktree (lost on retry):"
        echo "$status"
        echo ""
      fi
      if [ -n "$diffstat" ]; then
        echo "Diff stats:"
        echo "$diffstat"
        echo ""
      fi
    fi
    if [ -s "$logfile" ]; then
      echo "Last 40 lines of agent output:"
      format_log_tail "$logfile" 40 2>/dev/null || true
    elif [ -f "$logfile" ]; then
      echo "Agent log was empty — process likely killed before any output was flushed."
    fi
  } > "$last_failure_file" 2>/dev/null || true
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
  git worktree add "$worktree_dir" "$branch"

  git_unlock

  # Install dependencies in the worktree
  cd "$worktree_dir"
  log_task "$task_id" "Installing dependencies..."
  eval "$INSTALL_CMD" > "$logfile.npm" 2>&1 || {
    log_task "$task_id" "Dependency install failed (check $logfile.npm)"
  }

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
  3. Do NOT commit partial work. Exit cleanly with no commits — the orchestrator detects 0 commits, captures your TIMEOUT REPORT from stdout, and feeds it to the next retry.
- The 10-minute buffer is reserved for steps 1-3. Do not eat into it with 'just one more thing'.

RULES:
- Work ONLY on task $task_id. Do NOT touch other stories.
- You are already on the correct branch - do NOT switch branches.
- The project PRD is at prd.json (or scripts/ralph/prd.json - check ralph.config).
- After implementing, run quality checks, then commit your changes.
$([ -n "$recent_progress" ] && echo "
RECENT PROGRESS (from prior iterations):
$recent_progress")"

  # Run claude in worktree (wrapped in timeout — kills hung agents)
  log_task "$task_id" "Running claude in worktree (hard ${TASK_TIMEOUT_SEC}s, soft ${soft_deadline_sec}s)..."

  local exit_code=0
  RALPH_TASK_ID="$task_id" \
  RALPH_TIMEOUT_SEC="$TASK_TIMEOUT_SEC" \
  RALPH_SOFT_DEADLINE_SEC="$soft_deadline_sec" \
  RALPH_DEADLINE_EPOCH="$deadline_epoch" \
  timeout --foreground "$TASK_TIMEOUT_SEC" \
    stdbuf -oL claude \
    --model "$MODEL" \
    --dangerously-skip-permissions \
    --print \
    --output-format stream-json \
    --verbose \
    -p "$enriched_prompt" \
    2>&1 | tee "$logfile" || exit_code=$?

  if [ $exit_code -eq 124 ]; then
    log_task "$task_id" "${RED}TIMEOUT${RST} after ${TASK_TIMEOUT_SEC}s — task will be retried"
    capture_failure_context "$task_id" "$worktree_dir" "$logfile" "$last_failure_file" \
      "TIMEOUT after ${TASK_TIMEOUT_SEC}s. Agent was killed mid-run — likely scope too large, infinite loop, or stuck on a single problem. Narrow your approach and commit incrementally."
    git_lock
    cd "$REPO_ROOT"
    git worktree remove "$worktree_dir" --force 2>/dev/null || true
    git branch -D "$branch" 2>/dev/null || true
    git_unlock
    return 1
  fi

  if [ $exit_code -ne 0 ]; then
    log_task "$task_id" "claude exited with code $exit_code (check $logfile)"
  fi

  # Check if there are any commits on this branch beyond base
  cd "$worktree_dir"
  local commits_ahead
  commits_ahead=$(git rev-list "$BASE_BRANCH".."$branch" --count 2>/dev/null || echo "0")

  if [ "$commits_ahead" -eq 0 ]; then
    log_task "$task_id" "${RED}Agent did not commit${RST} — task will be retried"
    capture_failure_context "$task_id" "$worktree_dir" "$logfile" "$last_failure_file" \
      "Agent finished but produced 0 commits. You MUST run 'git commit' before exiting — uncommitted work is discarded."
    git_lock
    cd "$REPO_ROOT"
    git worktree remove "$worktree_dir" --force 2>/dev/null || true
    git branch -D "$branch" 2>/dev/null || true
    git_unlock
    return 1
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
  if ! git push -u origin "$branch"; then
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
  git checkout "$BASE_BRANCH"
  git pull --rebase origin "$BASE_BRANCH" 2>/dev/null || true

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
    if git merge --no-ff --no-edit "$branch" 2>&1; then
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

      if [ ${#needs_human[@]} -gt 0 ]; then
        # Real source conflict — abort merge, mark as failed for retry
        log_task "$task_id" "${RED}Source conflict in ${#needs_human[@]} file(s):${RST} ${needs_human[*]}"
        git merge --abort 2>/dev/null || true
        log_task "$task_id" "Merge aborted — task will retry on fresh base"
        git branch -D "$branch" 2>/dev/null || true
        git push origin --delete "$branch" 2>/dev/null || true
        merge_failed+=("$task_id")
        continue
      fi

      # Only auto-resolvable files — safe to resolve.
      # prd.json: agents must not edit it. A conflict here means the
      # orchestrator updated mark_done on base between when this branch
      # was cut and when it's merging — keep ours unconditionally.
      git checkout --ours "$PRD_REL" 2>/dev/null || true

      # Lock files / generated files: accept theirs
      for af in "${auto_resolvable[@]}"; do
        [ "$af" = "$PRD_REL" ] && continue
        git checkout --theirs "$af" 2>/dev/null || true
      done

      git add -A
      git commit --no-edit -m "merge: $task_id with auto-resolved conflicts" || true
    fi

    # One-line merge summary
    local shortstat files_n ins_n del_n
    shortstat=$(git diff --shortstat HEAD~1 HEAD -- . ":!$PRD_REL" 2>/dev/null || true)
    files_n=$(echo "$shortstat" | grep -oP '\d+ file' | grep -oP '\d+' || echo "0")
    ins_n=$(echo "$shortstat" | grep -oP '\d+ insertion' | grep -oP '\d+' || echo "0")
    del_n=$(echo "$shortstat" | grep -oP '\d+ deletion' | grep -oP '\d+' || echo "0")
    log_ok "Merged $task_id: $t_title ($files_n files, +$ins_n/-$del_n, $merge_status)"

    # Mark done — orchestrator owns the passes field; agents must not touch it.
    mark_done "$task_id"
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

  git push origin "$BASE_BRANCH" || true
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
  git pull --rebase origin "$BASE_BRANCH" 2>/dev/null || true

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
    git push origin "$BASE_BRANCH" || true
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
git checkout "$BASE_BRANCH"
git pull --rebase origin "$BASE_BRANCH" 2>/dev/null || true

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

rm -rf "$LOCK_DIR"
exit 1
