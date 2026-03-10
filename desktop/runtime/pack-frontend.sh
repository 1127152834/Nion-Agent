#!/bin/bash
# Pack frontend for Electron distribution

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FRONTEND_SRC="$REPO_ROOT/frontend"
FRONTEND_DEST="$SCRIPT_DIR/frontend"

echo "Packing frontend..."
echo "  Source: $FRONTEND_SRC"
echo "  Destination: $FRONTEND_DEST"

if [ ! -d "$FRONTEND_SRC" ]; then
  echo "Frontend source directory not found: $FRONTEND_SRC" >&2
  exit 1
fi

# Clean existing frontend
if [ -d "$FRONTEND_DEST" ]; then
  echo "Cleaning existing frontend..."
  rm -rf "$FRONTEND_DEST"
fi

# Build frontend
echo "Building frontend..."
cd "$FRONTEND_SRC"
NEXT_PUBLIC_BACKEND_BASE_URL="http://localhost:8001" NEXT_PUBLIC_LANGGRAPH_BASE_URL="http://localhost:8001/api/langgraph" NEXT_PUBLIC_IS_ELECTRON="1" NION_DESKTOP_BUILD="1" SKIP_ENV_VALIDATION="1" pnpm run build

# Copy build output
echo "Copying frontend build..."
mkdir -p "$FRONTEND_DEST"
cp -r .next/standalone/* "$FRONTEND_DEST/"
cp -r .next/static "$FRONTEND_DEST/.next/"
cp -r public "$FRONTEND_DEST/"

echo "Frontend packed successfully at: $FRONTEND_DEST"
