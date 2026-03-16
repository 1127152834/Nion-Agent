from __future__ import annotations

import os

import pytest

from nion.agents.memory.openviking_provider import OpenVikingMemoryProvider
from nion.agents.memory.openviking_runtime import OpenVikingRuntime
from nion.config.paths import Paths


class _Resource:
    def __init__(self, uri: str, score: float):
        self.uri = uri
        self.score = score


class _Results:
    def __init__(self, resources: list[_Resource]):
        self.resources = resources


@pytest.mark.unit
def test_BE_CORE_OVFS_201_fs_find_passes_params_and_abstract_best_effort(monkeypatch, tmp_path):
    runtime = OpenVikingRuntime()
    runtime._paths = Paths(base_dir=tmp_path)

    ensure_calls: list[str | None] = []

    def _ensure(agent_name: str | None):
        ensure_calls.append(agent_name)
        return (tmp_path, tmp_path / f"{agent_name or 'global'}.json")

    monkeypatch.setattr(runtime, "_ensure_openviking_scope", _ensure)

    class _DummyClient:
        def __init__(self):
            self.find_calls: list[tuple[str, str, int, float | None]] = []
            self.abstract_calls: list[str] = []
            self.closed = False

        def find(self, query: str, target_uri: str = "", limit: int = 10, score_threshold: float | None = None):
            self.find_calls.append((query, target_uri, limit, score_threshold))
            return _Results([_Resource("viking://r1", 0.9), _Resource("viking://r2", 0.1)])

        def abstract(self, uri: str) -> str:
            self.abstract_calls.append(uri)
            if uri.endswith("r2"):
                raise RuntimeError("abstract missing")
            return f"abs:{uri}"

        def close(self):
            self.closed = True

    dummy = _DummyClient()
    monkeypatch.setattr(runtime, "_build_openviking_client", lambda agent_name: dummy)

    os.environ["OPENVIKING_CONFIG_FILE"] = "original-config.json"
    rows = runtime.fs_find(
        query="hello",
        limit=2,
        target_uri="viking://resources",
        score_threshold=0.4,
        agent_name="_default",
    )

    assert ensure_calls == [None]
    assert dummy.find_calls == [("hello", "viking://resources", 2, 0.4)]
    assert rows == [
        {"uri": "viking://r1", "score": 0.9, "abstract": "abs:viking://r1"},
        {"uri": "viking://r2", "score": 0.1, "abstract": ""},
    ]
    assert dummy.closed is True
    assert os.environ["OPENVIKING_CONFIG_FILE"] == "original-config.json"


@pytest.mark.unit
def test_BE_CORE_OVFS_202_fs_search_forwards_filter_json(monkeypatch, tmp_path):
    runtime = OpenVikingRuntime()
    runtime._paths = Paths(base_dir=tmp_path)

    monkeypatch.setattr(runtime, "_ensure_openviking_scope", lambda agent_name: (tmp_path, tmp_path / "agent-x.json"))

    class _DummyClient:
        def __init__(self):
            self.search_calls: list[dict[str, object]] = []
            self.closed = False

        def search(
            self,
            query: str,
            target_uri: str = "",
            session=None,
            session_id=None,
            limit: int = 10,
            score_threshold: float | None = None,
            filter: dict | None = None,
        ):
            self.search_calls.append(
                {
                    "query": query,
                    "target_uri": target_uri,
                    "limit": limit,
                    "score_threshold": score_threshold,
                    "filter": filter,
                }
            )
            return _Results([_Resource("viking://s1", 0.7)])

        def abstract(self, uri: str) -> str:
            return f"abs:{uri}"

        def close(self):
            self.closed = True

    dummy = _DummyClient()
    monkeypatch.setattr(runtime, "_build_openviking_client", lambda agent_name: dummy)

    rows = runtime.fs_search(
        query="search",
        limit=3,
        target_uri="viking://resources",
        score_threshold=0.12,
        filter_json={"tier": "profile"},
        agent_name="agent-x",
    )

    assert dummy.search_calls == [
        {
            "query": "search",
            "target_uri": "viking://resources",
            "limit": 3,
            "score_threshold": 0.12,
            "filter": {"tier": "profile"},
        }
    ]
    assert rows == [{"uri": "viking://s1", "score": 0.7, "abstract": "abs:viking://s1"}]
    assert dummy.closed is True


@pytest.mark.unit
def test_BE_CORE_OVFS_203_provider_fs_wrappers_forward_to_runtime(monkeypatch):
    runtime = OpenVikingRuntime()
    provider = OpenVikingMemoryProvider(runtime)

    calls: list[tuple[str, dict[str, object]]] = []

    monkeypatch.setattr(runtime, "fs_overview", lambda **kwargs: calls.append(("overview", kwargs)) or "ok")
    monkeypatch.setattr(runtime, "fs_stat", lambda **kwargs: calls.append(("stat", kwargs)) or {"ok": True})

    assert provider.fs_overview(uri="viking://resources/nion") == "ok"
    assert provider.fs_stat(uri="viking://resources/nion/file.md") == {"ok": True}
    assert calls == [
        ("overview", {"uri": "viking://resources/nion", "agent_name": None}),
        ("stat", {"uri": "viking://resources/nion/file.md", "agent_name": None}),
    ]

