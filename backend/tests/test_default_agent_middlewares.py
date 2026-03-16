from __future__ import annotations

import pytest

from nion.agents.middlewares.memory_middleware import MemoryMiddleware
from nion.agents.middlewares.openviking_context_middleware import OpenVikingContextMiddleware


@pytest.mark.unit
def test_BE_CORE_MEM_404_memory_middleware_normalizes_default_agent_name():
    mw = MemoryMiddleware(agent_name="_default")
    assert mw._agent_name is None  # noqa: SLF001


@pytest.mark.unit
def test_BE_CORE_MEM_405_openviking_context_middleware_normalizes_default_agent_name():
    mw = OpenVikingContextMiddleware(agent_name="_default")
    assert mw._agent_name is None  # noqa: SLF001
