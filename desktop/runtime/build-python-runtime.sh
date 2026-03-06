#!/bin/bash
# Build Python runtime for Electron distribution
# This script creates a standalone Python environment with all backend dependencies

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_DIR="$SCRIPT_DIR/python"
BACKEND_DIR="$SCRIPT_DIR/../backend"

# Configuration
PYTHON_VERSION="${NION_DESKTOP_PYTHON_VERSION:-3.12}"
BACKEND_EXTRAS="${NION_DESKTOP_BACKEND_EXTRAS:-aio-sandbox,provisioner,image-search}"
PIP_VERSION="${NION_DESKTOP_PIP_VERSION:-25.3}"

echo "Building Python runtime..."
echo "  Python version: $PYTHON_VERSION"
echo "  Backend extras: $BACKEND_EXTRAS"
echo "  Output directory: $PYTHON_DIR"

# Clean existing runtime
if [ -d "$PYTHON_DIR" ]; then
  echo "Cleaning existing Python runtime..."
  rm -rf "$PYTHON_DIR"
fi

# Create Python environment using uv
echo "Creating Python environment with uv..."
cd "$BACKEND_DIR"
uv venv "$PYTHON_DIR" --python "$PYTHON_VERSION"

# Activate environment
source "$PYTHON_DIR/bin/activate"

# Upgrade pip
echo "Upgrading pip to version $PIP_VERSION..."
pip install --upgrade "pip==$PIP_VERSION"

# Install backend dependencies with extras.
# Use non-editable install so packaged runtime does not depend on source absolute paths.
echo "Installing backend dependencies..."
if [ -n "$BACKEND_EXTRAS" ]; then
  uv pip install ".[$BACKEND_EXTRAS]"
else
  uv pip install "."
fi

# Verify installation
echo "Verifying installation..."
python -c "import langgraph; print(f'LangGraph version: {langgraph.__version__}')"
python -c "import fastapi; print(f'FastAPI version: {fastapi.__version__}')"

echo "Python runtime built successfully at: $PYTHON_DIR"
