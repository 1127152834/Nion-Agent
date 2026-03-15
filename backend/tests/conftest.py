"""Test configuration for the backend test suite.

Why this exists:
- Ensure the backend package root is importable so `import src.*` works
  regardless of the current working directory when running pytest.
"""

import sys
from pathlib import Path

import pytest

# Make `src` importable from any working directory.
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture
def anyio_backend():
    # Keep the test suite runnable without installing trio.
    return "asyncio"
