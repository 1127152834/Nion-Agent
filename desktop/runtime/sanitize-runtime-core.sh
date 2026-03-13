#!/bin/bash
# Sanitize runtime core assets before packaging.
# This prevents accidental shipping of developer/runtime state (e.g. backend/.nion).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$SCRIPT_DIR/core"

if [ ! -d "$CORE_DIR" ]; then
  echo "Runtime core directory not found, skipping sanitize: $CORE_DIR"
  exit 0
fi

echo "Sanitizing runtime core: $CORE_DIR"

# Never ship local runtime state/cache inside the app bundle.
rm -rf "$CORE_DIR/backend/.nion" || true
rm -rf "$CORE_DIR/backend/.langgraph_api" || true
rm -rf "$CORE_DIR/backend/.pytest_cache" || true
rm -rf "$CORE_DIR/backend/.ruff_cache" || true

# Remove Python bytecode caches to keep bundle deterministic and smaller.
find "$CORE_DIR" -type d -name "__pycache__" -prune -exec rm -rf {} + 2>/dev/null || true
find "$CORE_DIR" -type f -name "*.pyc" -delete 2>/dev/null || true
find "$CORE_DIR" -type f -name "*.pyo" -delete 2>/dev/null || true

# Optional: prune large test suites in Python site-packages to reduce bundle size.
# Keep default OFF to avoid surprising runtime regressions.
if [ "${NION_DESKTOP_PRUNE_PYTHON_TESTS:-0}" = "1" ]; then
  if [ -d "$CORE_DIR/python" ]; then
    find "$CORE_DIR/python" -type d \( -name "tests" -o -name "test" \) -prune -exec rm -rf {} + 2>/dev/null || true
  fi
fi

if [ -d "$CORE_DIR/backend/.nion" ]; then
  echo "ERROR: backend/.nion exists after sanitization. Refusing to package." >&2
  exit 1
fi

if [ -d "$CORE_DIR/backend/.langgraph_api" ]; then
  echo "ERROR: backend/.langgraph_api exists after sanitization. Refusing to package." >&2
  exit 1
fi

echo "Runtime core sanitized."

