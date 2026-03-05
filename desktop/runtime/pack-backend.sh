#!/bin/bash
# Pack backend for Electron distribution

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_SRC="$SCRIPT_DIR/../backend"
BACKEND_DEST="$SCRIPT_DIR/backend"

echo "Packing backend..."
echo "  Source: $BACKEND_SRC"
echo "  Destination: $BACKEND_DEST"

# Clean existing backend
if [ -d "$BACKEND_DEST" ]; then
  echo "Cleaning existing backend..."
  rm -rf "$BACKEND_DEST"
fi

# Create backend directory
mkdir -p "$BACKEND_DEST"

# Copy backend source files
echo "Copying backend source files..."
rsync -av --exclude='.venv' --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='.pytest_cache' --exclude='.ruff_cache' --exclude='tests' \
  "$BACKEND_SRC/" "$BACKEND_DEST/"

echo "Backend packed successfully at: $BACKEND_DEST"
