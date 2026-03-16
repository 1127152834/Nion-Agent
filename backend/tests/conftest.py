"""Test configuration for the backend test suite."""

import sys
from pathlib import Path

import pytest

# Make both `nion` (harness) and `app` importable from any working directory.
backend_root = Path(__file__).parent.parent
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "packages" / "harness"))


@pytest.fixture
def anyio_backend():
    # Keep the test suite runnable without installing trio.
    return "asyncio"
