#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "${ROOT_DIR}/.." && pwd)"

STAGE=""
CHANGE=""
RUN_FRONTEND=0
RUN_ELECTRON=0
BACKEND_TESTS=()

usage() {
  cat <<USAGE
Usage: scripts/memoh/stage-closeout.sh --stage <phase> --change <change> [options]

Options:
  --backend-test <path>   Add one pytest path or selector
  --frontend-typecheck    Run frontend pnpm typecheck
  --electron-verify       Run scripts/verify-electron.sh
  --help                  Show this message
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage)
      STAGE="$2"
      shift 2
      ;;
    --change)
      CHANGE="$2"
      shift 2
      ;;
    --backend-test)
      BACKEND_TESTS+=("$2")
      shift 2
      ;;
    --frontend-typecheck)
      RUN_FRONTEND=1
      shift
      ;;
    --electron-verify)
      RUN_ELECTRON=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$STAGE" || -z "$CHANGE" ]]; then
  echo "Error: --stage and --change are required" >&2
  usage
  exit 1
fi

echo "[stage-closeout] stage: $STAGE"
TASK_GATE_ARGS=(--change "$CHANGE")
if [[ ${#BACKEND_TESTS[@]} -gt 0 ]]; then
  for test_path in "${BACKEND_TESTS[@]}"; do
    TASK_GATE_ARGS+=(--backend-test "$test_path")
  done
fi
if [[ "$RUN_FRONTEND" -eq 1 ]]; then
  TASK_GATE_ARGS+=(--frontend-typecheck)
fi
if [[ "$RUN_ELECTRON" -eq 1 ]]; then
  TASK_GATE_ARGS+=(--electron-verify)
fi
"$ROOT_DIR/scripts/memoh/task-gate.sh" "${TASK_GATE_ARGS[@]}"

echo "[stage-closeout] git status summary"
(
  cd "$ROOT_DIR"
  git status --short
)

echo "[stage-closeout] reminder: complete code review, update migration log, then archive change if DoD is met"
