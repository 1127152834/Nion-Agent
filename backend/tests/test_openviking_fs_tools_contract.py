from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from nion.tools.builtins.openviking_fs_tools import ovfs_find_tool, ovfs_search_tool, ovfs_stat_tool


class _DummyProvider:
    name = "openviking"

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def fs_find(self, **kwargs):
        self.calls.append(("find", kwargs))
        return [{"uri": "viking://r1", "score": 0.9, "abstract": "ok"}]

    def fs_search(self, **kwargs):
        self.calls.append(("search", kwargs))
        return [{"uri": "viking://s1", "score": 0.8, "abstract": "ok"}]

    def fs_stat(self, **kwargs):
        self.calls.append(("stat", kwargs))
        return {"uri": kwargs.get("uri"), "kind": "file"}


@pytest.mark.unit
def test_BE_CORE_OVFS_TOOLS_301_ovfs_find_resolves_default_agent_to_global(monkeypatch):
    provider = _DummyProvider()
    monkeypatch.setattr("nion.tools.builtins.openviking_fs_tools.get_default_memory_provider", lambda: provider)

    runtime = SimpleNamespace(context={"agent_name": "agent-ctx"}, state={})
    raw = ovfs_find_tool.func(
        runtime=runtime,
        query="hello",
        limit=5,
        target_uri="viking://resources",
        score_threshold=0.12,
        scope="agent",
        agent_name="_default",
    )
    payload = json.loads(raw)

    assert payload["ok"] is True
    assert payload["scope"] == "global"
    assert payload["agent_name"] is None
    assert isinstance(payload["data"], list)
    assert provider.calls == [
        (
            "find",
            {
                "query": "hello",
                "limit": 5,
                "target_uri": "viking://resources",
                "score_threshold": 0.12,
                "agent_name": None,
            },
        )
    ]


@pytest.mark.unit
def test_BE_CORE_OVFS_TOOLS_302_ovfs_search_parses_filter_json(monkeypatch):
    provider = _DummyProvider()
    monkeypatch.setattr("nion.tools.builtins.openviking_fs_tools.get_default_memory_provider", lambda: provider)

    runtime = SimpleNamespace(context={}, state={})
    raw = ovfs_search_tool.func(
        runtime=runtime,
        query="search",
        limit=3,
        target_uri="viking://resources",
        score_threshold=None,
        filter_json='{"tier":"profile"}',
        scope="global",
        agent_name=None,
    )
    payload = json.loads(raw)

    assert payload["ok"] is True
    assert payload["scope"] == "global"
    assert payload["agent_name"] is None
    assert provider.calls == [
        (
            "search",
            {
                "query": "search",
                "limit": 3,
                "target_uri": "viking://resources",
                "score_threshold": None,
                "filter_json": {"tier": "profile"},
                "agent_name": None,
            },
        )
    ]


@pytest.mark.unit
def test_BE_CORE_OVFS_TOOLS_303_errors_when_provider_is_not_openviking(monkeypatch):
    class _OtherProvider:
        name = "sqlite"

    monkeypatch.setattr("nion.tools.builtins.openviking_fs_tools.get_default_memory_provider", lambda: _OtherProvider())

    runtime = SimpleNamespace(context={}, state={})
    raw = ovfs_stat_tool.func(
        runtime=runtime,
        uri="viking://resources/nion/managed/user/USER.md",
        scope="global",
        agent_name=None,
    )
    payload = json.loads(raw)

    assert payload["ok"] is False
    assert "OpenViking provider is not active" in payload["error"]

