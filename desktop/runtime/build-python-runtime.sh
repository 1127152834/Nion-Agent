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
# IMPORTANT:
# - The desktop runtime bundle copies backend sources into `runtime/core/backend/` (see pack-backend.sh).
# - At runtime, services are started with `cwd=backend` so Python can import `app.*` from the working directory.
# - Therefore, for the packaged runtime we only need to install *dependencies* into the venv.
# - Installing the backend project itself would require building a wheel. Our backend repository is a "flat layout"
#   with multiple top-level directories (e.g. app/, data/, packages/) and is not meant to be built as a single
#   setuptools-discovered wheel. Attempting to do so breaks full packaging.
#
# Use `uv sync` against backend/uv.lock to install dependencies into the venv, without installing the backend
# project itself. This keeps the runtime deterministic and avoids setuptools package discovery errors.
echo "Installing backend dependencies (uv sync, without installing the backend project)..."

# Make this venv the "active" environment for uv.
export VIRTUAL_ENV="$PYTHON_DIR"
export PATH="$(dirname "$VENV_PYTHON")${PATH:+:${PATH}}"

# NOTE: We intentionally do NOT pass `--extra` flags here.
# The default BACKEND_EXTRAS is used by some repos, but this repo does not define those extras in
# `[project.optional-dependencies]`, and `uv sync --extra ...` would hard-error.
uv sync --active --frozen --no-dev --no-editable --no-install-project

# Verify installation
echo "Verifying installation..."
"$VENV_PYTHON" -c 'from importlib.metadata import version; print("LangGraph version:", version("langgraph"))'
"$VENV_PYTHON" -c 'from importlib.metadata import version; print("FastAPI version:", version("fastapi"))'

echo "Python runtime built successfully at: $PYTHON_DIR"
