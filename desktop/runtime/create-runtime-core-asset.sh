#!/bin/bash
# Create a versioned runtime core bundle asset for slim installers to download.
#
# Output:
#   desktop/runtime/release/nion-runtime-core-{platform}-{arch}-v{version}.tar.gz
#
# Notes:
# - Requires core/ to be prepared first (run prepare-runtime-core.sh).
# - platform/arch default to current Node runtime, but can be overridden via env:
#     NION_RUNTIME_PLATFORM, NION_RUNTIME_ARCH

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$SCRIPT_DIR/release"

VERSION="$(node -e 'console.log(require(process.argv[1]).version)' "$SCRIPT_DIR/../electron/package.json")"
PLATFORM="${NION_RUNTIME_PLATFORM:-$(node -p 'process.platform')}"
ARCH="${NION_RUNTIME_ARCH:-$(node -p 'process.arch')}"

CORE_DIR="$SCRIPT_DIR/core"
MANIFEST="$SCRIPT_DIR/manifest.json"

if [ ! -d "$CORE_DIR" ]; then
  echo "Runtime core directory not found: $CORE_DIR" >&2
  echo "Hint: run ./desktop/runtime/prepare-runtime-core.sh first." >&2
  exit 1
fi

if [ ! -f "$MANIFEST" ]; then
  echo "Runtime manifest not found: $MANIFEST" >&2
  exit 1
fi

mkdir -p "$RELEASE_DIR"

BUNDLE_NAME="nion-runtime-core-${PLATFORM}-${ARCH}-v${VERSION}.tar.gz"
OUT_PATH="$RELEASE_DIR/$BUNDLE_NAME"

echo "Creating runtime core asset..."
echo "  version:  $VERSION"
echo "  platform: $PLATFORM"
echo "  arch:     $ARCH"
echo "  output:   $OUT_PATH"

cd "$SCRIPT_DIR"
tar -czf "$OUT_PATH" core/ manifest.json

cd "$RELEASE_DIR"
shasum -a 256 "$BUNDLE_NAME" > "$BUNDLE_NAME.sha256"

echo "Runtime core asset created:"
echo "  - $OUT_PATH"
echo "  - $OUT_PATH.sha256"

