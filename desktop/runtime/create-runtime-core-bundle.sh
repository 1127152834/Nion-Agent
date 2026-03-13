#!/bin/bash
# Create a stable runtime core bundle for offline installers.
#
# Output:
#   desktop/runtime/bundles/runtime-core.tar.gz
#
# This bundle is embedded into the "full" installer and extracted to ~/.nion/runtime/ on first launch.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$SCRIPT_DIR/core"
MANIFEST="$SCRIPT_DIR/manifest.json"
BUNDLES_DIR="$SCRIPT_DIR/bundles"
OUT_PATH="$BUNDLES_DIR/runtime-core.tar.gz"

if [ ! -d "$CORE_DIR" ]; then
  echo "Runtime core directory not found: $CORE_DIR" >&2
  echo "Hint: run ./desktop/runtime/prepare-runtime-core.sh first." >&2
  exit 1
fi

if [ ! -f "$MANIFEST" ]; then
  echo "Runtime manifest not found: $MANIFEST" >&2
  exit 1
fi

mkdir -p "$BUNDLES_DIR"

echo "Creating offline runtime core bundle..."
echo "  output: $OUT_PATH"

cd "$SCRIPT_DIR"
tar -czf "$OUT_PATH" core/ manifest.json

cd "$BUNDLES_DIR"
shasum -a 256 "$(basename "$OUT_PATH")" > "$(basename "$OUT_PATH").sha256"

echo "Offline runtime core bundle created:"
echo "  - $OUT_PATH"
echo "  - $OUT_PATH.sha256"

