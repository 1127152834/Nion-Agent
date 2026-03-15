from __future__ import annotations

import pytest

from src.agents.memory.scope import (
    normalize_agent_name_for_memory,
    resolve_agent_for_memory_scope,
)


@pytest.mark.unit
def test_BE_CORE_MEM_401_normalize_default_agent_to_global():
    assert normalize_agent_name_for_memory(None) is None
    assert normalize_agent_name_for_memory("") is None
    assert normalize_agent_name_for_memory("   ") is None
    assert normalize_agent_name_for_memory("_default") is None
    assert normalize_agent_name_for_memory(" _default ") is None
    assert normalize_agent_name_for_memory("Alice") == "Alice"


@pytest.mark.unit
def test_BE_CORE_MEM_402_resolve_scope_default_agent_always_maps_to_global():
    assert resolve_agent_for_memory_scope(scope="auto", agent_name="_default") is None
    assert resolve_agent_for_memory_scope(scope="agent", agent_name="_default") is None
    assert resolve_agent_for_memory_scope(scope="global", agent_name="_default") is None


@pytest.mark.unit
def test_BE_CORE_MEM_403_resolve_scope_agent_requires_name_except_default():
    with pytest.raises(ValueError):
        resolve_agent_for_memory_scope(scope="agent", agent_name=None)
    with pytest.raises(ValueError):
        resolve_agent_for_memory_scope(scope="agent", agent_name="")

    assert resolve_agent_for_memory_scope(scope="agent", agent_name="bob") == "bob"
    assert resolve_agent_for_memory_scope(scope="auto", agent_name="bob") == "bob"
    assert resolve_agent_for_memory_scope(scope="global", agent_name="bob") is None

