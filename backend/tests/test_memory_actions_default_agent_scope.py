from __future__ import annotations

import pytest

import src.agents.memory.actions as actions


class _DummyProvider:
    def __init__(self):
        self.last_agent_name = "unset"

    def query_memory(self, *, query: str, limit: int, agent_name=None):
        self.last_agent_name = agent_name
        return []


@pytest.mark.unit
def test_BE_CORE_MEM_406_query_memory_action_default_agent_maps_to_global(monkeypatch):
    provider = _DummyProvider()
    monkeypatch.setattr(actions, "get_default_memory_provider", lambda: provider)

    actions.query_memory_action(
        query="who am i",
        limit=5,
        scope="auto",
        agent_name=None,
        runtime_agent_name="_default",
    )

    assert provider.last_agent_name is None
