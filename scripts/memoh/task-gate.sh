#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "${ROOT_DIR}/.." && pwd)"

CHANGE=""
RUN_FRONTEND=0
RUN_ELECTRON=0
BACKEND_TESTS=()

usage() {
  cat <<USAGE
Usage: scripts/memoh/task-gate.sh --change <change> [options]

Options:
  --backend-test <path>   Add one pytest path or selector
  --frontend-typecheck    Run frontend pnpm typecheck
  --electron-verify       Run scripts/verify-electron.sh
  --help                  Show this message
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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

if [[ -z "$CHANGE" ]]; then
  echo "Error: --change is required" >&2
  usage
  exit 1
fi

echo "[task-gate] root: $ROOT_DIR"
echo "[task-gate] validating OpenSpec change: $CHANGE"
(
  cd "$ROOT_DIR"
  openspec validate "$CHANGE" --type change --strict
)

if [[ ${#BACKEND_TESTS[@]} -gt 0 ]]; then
  echo "[task-gate] running backend pytest: ${BACKEND_TESTS[*]}"
  (
    cd "$ROOT_DIR/backend"
    uv run pytest "${BACKEND_TESTS[@]}" -q
  )
fi

if [[ "$RUN_FRONTEND" -eq 1 ]]; then
  echo "[task-gate] running frontend typecheck"
  (
    cd "$ROOT_DIR/frontend"
    pnpm typecheck
  )
fi

if [[ "$RUN_ELECTRON" -eq 1 ]]; then
  echo "[task-gate] running Electron verification"
  (
    cd "$ROOT_DIR"
    ./scripts/verify-electron.sh
  )
fi

echo "[task-gate] running git diff --check"
(
  cd "$ROOT_DIR"
  git diff --check
)

echo "[task-gate] success"
