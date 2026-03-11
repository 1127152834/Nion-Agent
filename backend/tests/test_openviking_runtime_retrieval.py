from __future__ import annotations

import json

import pytest

from src.agents.memory.openviking_runtime import OpenVikingRuntime
from src.config.memory_config import MemoryConfig, set_memory_config
from src.config.paths import Paths


def teardown_function() -> None:
    set_memory_config(MemoryConfig())


@pytest.mark.unit
def test_BE_CORE_MEM_301_vector_auto_prefers_vector_results(monkeypatch):
    runtime = OpenVikingRuntime()
    set_memory_config(MemoryConfig(retrieval_mode="vector_auto", rerank_mode="off"))

    monkeypatch.setattr(runtime, "_resolve_local_embedding_model", lambda: (True, "demo-model"))
    monkeypatch.setattr(runtime, "_check_embedding_health", lambda model_name: (True, "ok"))
    monkeypatch.setattr(runtime, "_embed_text_local", lambda text, model_name: [0.3, 0.7])
    monkeypatch.setattr(runtime._sqlite_index, "vector_count", lambda agent_name=None: 2)
    monkeypatch.setattr(
        runtime._sqlite_index,
        "search_vectors",
        lambda **kwargs: [
            {"memory_id": "m1", "thread_id": "t1", "content": "vector hit", "score": 0.93},
        ],
    )

    rows = runtime.search_memory(query="vector query", limit=5, agent_name=None)

    assert len(rows) == 1
    assert rows[0]["retrieval_route"] == "vector"
    assert rows[0]["memory"] == "vector hit"


@pytest.mark.unit
def test_BE_CORE_MEM_302_vector_auto_falls_back_to_find_when_index_empty(monkeypatch):
    runtime = OpenVikingRuntime()
    set_memory_config(MemoryConfig(retrieval_mode="vector_auto", rerank_mode="off"))

    monkeypatch.setattr(runtime, "_resolve_local_embedding_model", lambda: (True, "demo-model"))
    monkeypatch.setattr(runtime, "_check_embedding_health", lambda model_name: (True, "ok"))
    monkeypatch.setattr(runtime._sqlite_index, "vector_count", lambda agent_name=None: 0)
    monkeypatch.setattr(
        runtime,
        "_openviking_find",
        lambda **kwargs: [{"id": "f1", "uri": "viking://session/memory", "score": 0.7, "abstract": "find hit", "memory": "find hit"}],
    )

    rows = runtime.search_memory(query="fallback query", limit=3, agent_name=None)
    status = runtime.get_retrieval_status(agent_name=None)

    assert len(rows) == 1
    assert rows[0]["id"] == "f1"
    assert "vector_index_empty" in status["last_fallback_reason"]


@pytest.mark.unit
def test_BE_CORE_MEM_303_reindex_vectors_reads_structured_facts(monkeypatch):
    runtime = OpenVikingRuntime()
    set_memory_config(MemoryConfig(graph_enabled=True))

    monkeypatch.setattr(runtime, "_resolve_local_embedding_model", lambda: (True, "demo-model"))
    monkeypatch.setattr(runtime, "_check_embedding_health", lambda model_name: (True, "ok"))
    monkeypatch.setattr(runtime, "_embed_text_local", lambda text, model_name: [0.1, 0.9])
    monkeypatch.setattr(runtime._sqlite_index, "clear_vectors", lambda agent_name=None: 0)

    upsert_calls: list[str] = []
    graph_calls: list[str] = []
    monkeypatch.setattr(
        runtime._sqlite_index,
        "upsert_vector",
        lambda **kwargs: upsert_calls.append(kwargs["memory_id"]),
    )
    monkeypatch.setattr(
        runtime._sqlite_index,
        "upsert_graph_from_text",
        lambda **kwargs: graph_calls.append(kwargs["memory_id"]),
    )
    monkeypatch.setattr(
        runtime._structured,
        "get_memory_data",
        lambda request: {"facts": [{"id": "fact-1", "content": "hello memory", "source": "thread-1"}]},
    )

    result = runtime.reindex_vectors(include_agents=False)

    assert result["status"] == "ok"
    assert result["indexed_count"] == 1
    assert upsert_calls == ["fact-1"]
    assert graph_calls == ["fact-1"]


@pytest.mark.unit
def test_BE_CORE_MEM_304_commit_session_uses_sync_client_api(monkeypatch):
    runtime = OpenVikingRuntime()
    calls: list[tuple[str, str, str]] = []
    committed: list[str] = []

    class _DummyClient:
        def add_message(self, session_id: str, role: str, *, content: str):
            calls.append((session_id, role, content))
            return {"session_id": session_id}

        def commit_session(self, session_id: str):
            committed.append(session_id)
            return {"status": "committed"}

        def close(self):
            return None

    monkeypatch.setattr(runtime, "_build_openviking_client", lambda agent_name: _DummyClient())
    monkeypatch.setattr(runtime, "_upsert_runtime_indexes", lambda **kwargs: None)

    result = runtime.commit_session(
        thread_id="thread-1",
        messages=[
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "world"},
        ],
        agent_name=None,
    )

    assert result["status"] == "committed"
    assert result["message_count"] == 2
    assert calls == [("thread-1", "user", "hello"), ("thread-1", "assistant", "world")]
    assert committed == ["thread-1"]


@pytest.mark.unit
def test_BE_CORE_MEM_305_ensure_scope_repairs_invalid_vlm_config(tmp_path):
    runtime = OpenVikingRuntime()
    runtime._paths = Paths(base_dir=tmp_path)

    data_dir, conf_file = runtime._ensure_openviking_scope(None)

    assert data_dir.exists()
    payload = json.loads(conf_file.read_text(encoding="utf-8"))
    dense = payload["embedding"]["dense"]
    assert dense["model"]
    assert dense["provider"] in {"openai", "volcengine", "jina"}

    # Simulate old invalid config: has api_key but missing model -> should be repaired.
    conf_file.write_text(
        json.dumps(
            {
                "embedding": dense,
                "vlm": {
                    "provider": "openai",
                    "model": "",
                    "api_key": "$OPENAI_API_KEY",
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    _, repaired_path = runtime._ensure_openviking_scope(None)
    repaired = json.loads(repaired_path.read_text(encoding="utf-8"))
    assert isinstance(repaired["vlm"], dict)
    if repaired["vlm"]:
        assert repaired["vlm"].get("model")
        assert repaired["vlm"].get("api_key")
