from __future__ import annotations

import json
import os

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
        runtime._sqlite_index,
        "list_resources",
        lambda **kwargs: [
            {
                "memory_id": "fact-1",
                "summary": "hello memory",
                "status": "active",
            }
        ],
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


@pytest.mark.unit
def test_BE_CORE_MEM_306_commit_session_degrades_to_local_only_when_openviking_unavailable(monkeypatch):
    runtime = OpenVikingRuntime()
    upsert_called: list[dict] = []

    monkeypatch.setattr(
        runtime,
        "_build_openviking_client",
        lambda agent_name: (_ for _ in ()).throw(RuntimeError("OpenViking import failed")),
    )
    monkeypatch.setattr(runtime, "_upsert_runtime_indexes", lambda **kwargs: upsert_called.append(kwargs))

    result = runtime.commit_session(
        thread_id="thread-fallback",
        messages=[
            {"role": "user", "content": "你好我叫张天成"},
            {"role": "assistant", "content": "很高兴认识你"},
        ],
        agent_name=None,
    )

    assert result["status"] == "committed_local_only"
    assert result["message_count"] == 2
    assert "degraded_reason" in result
    assert len(upsert_called) == 1
    assert upsert_called[0]["thread_id"] == "thread-fallback"


@pytest.mark.unit
def test_BE_CORE_MEM_307_upsert_runtime_indexes_stores_resource_without_embedding(monkeypatch):
    runtime = OpenVikingRuntime()

    resources: list[dict] = []
    vectors: list[dict] = []
    monkeypatch.setattr(runtime, "_resolve_local_embedding_model", lambda: (False, None))
    monkeypatch.setattr(runtime._sqlite_index, "upsert_resource", lambda **kwargs: resources.append(kwargs))
    monkeypatch.setattr(runtime._sqlite_index, "upsert_vector", lambda **kwargs: vectors.append(kwargs))

    runtime._upsert_runtime_indexes(
        thread_id="thread-ledger",
        messages=[{"role": "user", "content": "用户名字是张天成"}],
        agent_name=None,
    )

    assert len(resources) == 1
    assert resources[0]["summary"] == "用户名字是张天成"
    assert vectors == []


@pytest.mark.unit
def test_BE_CORE_MEM_308_search_memory_falls_back_to_local_ledger(monkeypatch):
    runtime = OpenVikingRuntime()
    set_memory_config(MemoryConfig(retrieval_mode="find", rerank_mode="off"))

    monkeypatch.setattr(
        runtime,
        "_openviking_find",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("openviking unavailable")),
    )
    monkeypatch.setattr(
        runtime._sqlite_index,
        "list_resources",
        lambda **kwargs: [
            {
                "memory_id": "mem-zhang",
                "uri": "viking://session/thread-x/mem-zhang",
                "summary": "用户名字是张天成，喜欢编程。",
                "updated_at": "2026-03-12T12:00:00Z",
                "last_used_at": "",
                "created_at": "2026-03-12T12:00:00Z",
            }
        ],
    )

    rows = runtime.search_memory(query="你知道我叫什么", limit=3, agent_name=None)

    assert len(rows) == 1
    assert rows[0]["id"] == "mem-zhang"
    assert rows[0]["retrieval_route"] == "ledger"


@pytest.mark.unit
def test_BE_CORE_MEM_309_get_memory_items_exposes_layered_metadata(monkeypatch):
    runtime = OpenVikingRuntime()
    monkeypatch.setattr(
        runtime._sqlite_index,
        "list_resources",
        lambda **kwargs: [
            {
                "memory_id": "mem-profile-1",
                "uri": "viking://manifest/mem-profile-1",
                "summary": "我叫张天成，来自杭州",
                "score": 0.97,
                "status": "active",
                "use_count": 2,
                "last_used_at": "2026-03-12T12:30:00Z",
                "source_thread_id": "thread-1",
                "created_at": "2026-03-12T12:00:00Z",
                "updated_at": "2026-03-12T12:30:00Z",
                "scope": "global",
                "metadata": {
                    "tier": "profile",
                    "source": "auto",
                    "quality_score": 0.97,
                    "decision_reason": "high_value_memory",
                    "retention_policy": "long_term_locked",
                    "evidence": {"write_evidence_id": "act_abc"},
                },
            }
        ],
    )

    items = runtime.get_memory_items(scope="global", agent_name=None)

    assert len(items) == 1
    item = items[0]
    assert item["tier"] == "profile"
    assert item["source"] == "auto"
    assert item["quality"] == pytest.approx(0.97)
    assert item["quality_score"] == pytest.approx(0.97)
    assert item["decision_reason"] == "high_value_memory"
    assert item["evidence"]["write_evidence_id"] == "act_abc"
    assert item["retention_policy"] == "long_term_locked"


@pytest.mark.unit
def test_BE_CORE_MEM_310_openviking_client_context_restores_config_env(monkeypatch, tmp_path):
    runtime = OpenVikingRuntime()
    runtime._paths = Paths(base_dir=tmp_path)

    original = "original-config.json"
    os.environ["OPENVIKING_CONFIG_FILE"] = original

    class _DummyClient:
        def close(self):
            return None

    monkeypatch.setattr(runtime, "_build_openviking_client", lambda agent_name: _DummyClient())

    _, conf_a = runtime._ensure_openviking_scope("agent-a")
    _, conf_b = runtime._ensure_openviking_scope("agent-b")

    with runtime._openviking_client("agent-a"):
        assert os.environ["OPENVIKING_CONFIG_FILE"] == str(conf_a)
    assert os.environ["OPENVIKING_CONFIG_FILE"] == original

    with runtime._openviking_client("agent-b"):
        assert os.environ["OPENVIKING_CONFIG_FILE"] == str(conf_b)
    assert os.environ["OPENVIKING_CONFIG_FILE"] == original
