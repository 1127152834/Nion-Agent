#!/bin/bash
# Prepare desktop runtime core assets for electron-builder

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$SCRIPT_DIR/core"
OPTIONAL_DIR="$SCRIPT_DIR/optional"

echo "=========================================="
echo "  Preparing Desktop Runtime Core"
echo "=========================================="

# Allow CI/local builds to skip heavyweight runtime bundling when not needed.
if [ "${NION_DESKTOP_SKIP_RUNTIME_PREPARE:-0}" = "1" ]; then
  echo "NION_DESKTOP_SKIP_RUNTIME_PREPARE=1, skipping runtime preparation."
  mkdir -p "$CORE_DIR" "$OPTIONAL_DIR"
  bash "$SCRIPT_DIR/sanitize-runtime-core.sh"
  exit 0
fi

bash "$SCRIPT_DIR/build-python-runtime.sh"
bash "$SCRIPT_DIR/pack-backend.sh"
bash "$SCRIPT_DIR/pack-frontend.sh"

rm -rf "$CORE_DIR"
mkdir -p "$CORE_DIR"
mkdir -p "$OPTIONAL_DIR"

cp -R "$SCRIPT_DIR/python" "$CORE_DIR/python"
cp -R "$SCRIPT_DIR/backend" "$CORE_DIR/backend"
cp -R "$SCRIPT_DIR/frontend" "$CORE_DIR/frontend"

# Remove any runtime/state artifacts that must never ship in installers.
bash "$SCRIPT_DIR/sanitize-runtime-core.sh"

bash "$SCRIPT_DIR/create-runtime-bundle.sh"

echo "Runtime core prepared:"
echo "  - $CORE_DIR/python"
echo "  - $CORE_DIR/backend"
echo "  - $CORE_DIR/frontend"
