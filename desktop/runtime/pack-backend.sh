#!/bin/bash
# Pack backend for Electron distribution

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_SRC="$REPO_ROOT/backend"
BACKEND_DEST="$SCRIPT_DIR/backend"

echo "Packing backend..."
echo "  Source: $BACKEND_SRC"
echo "  Destination: $BACKEND_DEST"

if [ ! -d "$BACKEND_SRC" ]; then
  echo "Backend source directory not found: $BACKEND_SRC" >&2
  exit 1
fi

# Clean existing backend
if [ -d "$BACKEND_DEST" ]; then
  echo "Cleaning existing backend..."
  rm -rf "$BACKEND_DEST"
fi

# Create backend directory
mkdir -p "$BACKEND_DEST"

# Copy backend source files.
# Exclude runtime/state/build artifacts so package contents are deterministic.
echo "Copying backend source files..."
rsync -a \
  --exclude='.venv' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.pytest_cache' \
  --exclude='.ruff_cache' \
  --exclude='.mypy_cache' \
  --exclude='.coverage' \
  --exclude='.coverage.*' \
  --exclude='.nion' \
  --exclude='.langgraph_api' \
  --exclude='build' \
  --exclude='dist' \
  --exclude='dist-*' \
  --exclude='*.egg-info' \
  --exclude='reports' \
  --exclude='tests' \
  "$BACKEND_SRC/" "$BACKEND_DEST/"

echo "Backend packed successfully at: $BACKEND_DEST"
