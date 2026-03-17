#!/bin/bash
# Build Python runtime for Electron distribution
# This script creates a standalone Python environment with all backend dependencies

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PYTHON_DIR="$SCRIPT_DIR/python"
BACKEND_DIR="$REPO_ROOT/backend"

# Configuration
PYTHON_VERSION="${NION_DESKTOP_PYTHON_VERSION:-3.12}"
BACKEND_EXTRAS="${NION_DESKTOP_BACKEND_EXTRAS:-aio-sandbox,provisioner,image-search}"
PIP_VERSION="${NION_DESKTOP_PIP_VERSION:-25.3}"

echo "Building Python runtime..."
echo "  Python version: $PYTHON_VERSION"
echo "  Backend extras: $BACKEND_EXTRAS"
echo "  Output directory: $PYTHON_DIR"
echo "  Backend source: $BACKEND_DIR"

if [ ! -d "$BACKEND_DIR" ]; then
  echo "Backend source directory not found: $BACKEND_DIR" >&2
  exit 1
fi

# Clean existing runtime
if [ -d "$PYTHON_DIR" ]; then
  echo "Cleaning existing Python runtime..."
  rm -rf "$PYTHON_DIR"
fi

# Create Python environment using uv
echo "Creating Python environment with uv..."
cd "$BACKEND_DIR"
uv venv "$PYTHON_DIR" --python "$PYTHON_VERSION"

VENV_PYTHON="$PYTHON_DIR/bin/python"
if [ ! -x "$VENV_PYTHON" ]; then
  echo "Expected venv python not found or not executable: $VENV_PYTHON" >&2
  exit 1
fi

# NOTE: Do not call the global `pip` executable here.
# On some machines, `pip` may point to a system Python that is broken or has invalid code signature,
# which will crash the runtime build (dyld error) and block full Electron packaging.
#
# We instead force-install/upgrade pip inside the venv using uv, explicitly targeting the venv
# interpreter.
echo "Installing pip==$PIP_VERSION into the venv..."
uv pip install --python "$VENV_PYTHON" --upgrade "pip==$PIP_VERSION"

# Install backend dependencies with extras.
# Use non-editable install so packaged runtime does not depend on source absolute paths.
echo "Installing backend dependencies..."
if [ -n "$BACKEND_EXTRAS" ]; then
  uv pip install --python "$VENV_PYTHON" ".[$BACKEND_EXTRAS]"
else
  uv pip install --python "$VENV_PYTHON" "."
fi

# Verify installation
echo "Verifying installation..."
"$VENV_PYTHON" -c 'from importlib.metadata import version; print("LangGraph version:", version("langgraph"))'
"$VENV_PYTHON" -c 'from importlib.metadata import version; print("FastAPI version:", version("fastapi"))'

echo "Python runtime built successfully at: $PYTHON_DIR"
