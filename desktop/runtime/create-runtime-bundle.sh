#!/bin/bash
# Create runtime bundle for Electron distribution

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$SCRIPT_DIR/release"
BUNDLE_NAME="nion-runtime-$(date +%Y%m%d-%H%M%S).tar.gz"

echo "Creating runtime bundle..."
echo "  Output: $RELEASE_DIR/$BUNDLE_NAME"

# Create release directory
mkdir -p "$RELEASE_DIR"

# Create tarball
cd "$SCRIPT_DIR"
tar -czf "$RELEASE_DIR/$BUNDLE_NAME" \
  --exclude='release' \
  python/ backend/ frontend/ core/ optional/ manifest.json

# Calculate SHA256
cd "$RELEASE_DIR"
shasum -a 256 "$BUNDLE_NAME" > "$BUNDLE_NAME.sha256"

echo "Runtime bundle created successfully:"
echo "  Bundle: $RELEASE_DIR/$BUNDLE_NAME"
echo "  SHA256: $RELEASE_DIR/$BUNDLE_NAME.sha256"
cat "$BUNDLE_NAME.sha256"
