#!/bin/bash
# Pack frontend for Electron distribution

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_SRC="$SCRIPT_DIR/../frontend"
FRONTEND_DEST="$SCRIPT_DIR/frontend"

echo "Packing frontend..."
echo "  Source: $FRONTEND_SRC"
echo "  Destination: $FRONTEND_DEST"

# Clean existing frontend
if [ -d "$FRONTEND_DEST" ]; then
  echo "Cleaning existing frontend..."
  rm -rf "$FRONTEND_DEST"
fi

# Build frontend
echo "Building frontend..."
cd "$FRONTEND_SRC"
pnpm run build

# Copy build output
echo "Copying frontend build..."
mkdir -p "$FRONTEND_DEST"
cp -r .next/standalone/* "$FRONTEND_DEST/"
cp -r .next/static "$FRONTEND_DEST/.next/"
cp -r public "$FRONTEND_DEST/"

echo "Frontend packed successfully at: $FRONTEND_DEST"
