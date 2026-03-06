"""Phase 5 tests for integration layer and config extensions."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
MEMORY_DIR = BACKEND_DIR / "src" / "agents" / "memory"
CONFIG_DIR = BACKEND_DIR / "src" / "config"


def _load_module(module_name: str, file_path: Path):
    assert file_path.exists(), f"Missing module file: {file_path}"

    spec = importlib.util.spec_from_file_location(module_name, file_path)
    assert spec is not None and spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class FakeEmbeddingProvider:
    def embed(self, text: str) -> list[float]:
        lowered = text.lower()
        return [1.0 if "python" in lowered else 0.0, 1.0 if "project" in lowered else 0.0]

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return [self.embed(text) for text in texts]


class FakeLLMResponse:
    def __init__(self, content: str):
        self.content = content


class FakeLLM:
    def invoke(self, prompt: str):  # noqa: ARG002
        return FakeLLMResponse("Most relevant order: item_py")


def test_phase5_module_files_loadable() -> None:
    _load_module("memory_manager_module", MEMORY_DIR / "memory.py")


def test_memory_manager_integrates_v2_layers_and_legacy(tmp_path) -> None:
    memory_module = _load_module("memory_manager_module", MEMORY_DIR / "memory.py")

    manager = memory_module.MemoryManager(
        base_dir=tmp_path,
        embedding_provider=FakeEmbeddingProvider(),
        llm=FakeLLM(),
        legacy_loader=lambda agent_name=None: {"version": "1.0", "agent": agent_name},
        legacy_updater=lambda messages, thread_id=None, agent_name=None: True,
        enable_legacy=True,
    )

    manager.store_conversation({"id": "res_1", "type": "conversation", "content": "hello"})
    manager.store_item({"id": "item_py", "content": "Python memory for project", "category": "knowledge", "confidence": 0.9})
    manager.store_item({"id": "item_misc", "content": "General context note", "category": "context", "confidence": 0.7})

    search_result = manager.search("python project", top_k=2)

    assert search_result["mode"] in {"fast", "deep"}
    assert search_result["results"]
    assert search_result["results"][0]["id"] == "item_py"

    item_after = manager.item_layer.get("item_py")
    assert item_after is not None
    assert item_after["access_count"] >= 1

    data = manager.get_memory_data(agent_name="agent-a")
    assert data["version"] == "2.0"
    assert "items" in data and len(data["items"]) >= 2
    assert "categories" in data and "knowledge" in data["categories"]
    assert "legacy" in data and data["legacy"]["version"] == "1.0"

    updated = manager.update_legacy_from_conversation([{"role": "user", "content": "hi"}], thread_id="t1")
    assert updated is True


def test_memory_config_supports_new_fields_with_backward_compatibility() -> None:
    config_module = _load_module("memory_config_module", CONFIG_DIR / "memory_config.py")

    # Backward-compatible old config payload should still parse.
    old_style = config_module.MemoryConfig(enabled=True, storage_path="memory.json")
    assert old_style.enabled is True
    assert old_style.vector_weight == 0.5
    assert old_style.bm25_k1 == 1.5

    # New fields should be configurable.
    new_style = config_module.MemoryConfig(
        enabled=True,
        embedding_provider="openai",
        embedding_model="text-embedding-3-small",
        vector_weight=0.6,
        bm25_weight=0.4,
        bm25_k1=1.8,
        bm25_b=0.7,
        evolution_enabled=True,
        evolution_interval_hours=12,
        merge_similarity_threshold=0.9,
        staleness_threshold_days=120,
    )

    assert new_style.embedding_provider == "openai"
    assert new_style.vector_weight == 0.6
    assert new_style.bm25_weight == 0.4
    assert new_style.evolution_enabled is True
    assert new_style.evolution_interval_hours == 12
    assert new_style.merge_similarity_threshold == 0.9
    assert new_style.staleness_threshold_days == 120


def test_memory_manager_applies_runtime_config_to_layers(tmp_path) -> None:
    memory_module = _load_module("memory_manager_module_runtime", MEMORY_DIR / "memory.py")

    manager = memory_module.MemoryManager(
        base_dir=tmp_path,
        embedding_provider=FakeEmbeddingProvider(),
        llm=FakeLLM(),
        enable_legacy=False,
        config={
            "vector_weight": 0.9,
            "bm25_weight": 0.1,
            "bm25_k1": 2.2,
            "bm25_b": 0.2,
            "proactive_enabled": False,
            "evolution_enabled": False,
            "merge_similarity_threshold": 0.93,
        },
    )

    assert manager.item_layer._hybrid_search.vector_weight == 0.9  # noqa: SLF001
    assert manager.item_layer._hybrid_search.bm25_weight == 0.1  # noqa: SLF001
    assert manager.item_layer._bm25.k1 == 2.2  # noqa: SLF001
    assert manager.item_layer._bm25.b == 0.2  # noqa: SLF001
    assert manager.dual_retriever is None
    assert manager.evolver is None


def test_memory_manager_store_item_reassigns_category_without_residue(tmp_path) -> None:
    memory_module = _load_module("memory_manager_module_category", MEMORY_DIR / "memory.py")

    manager = memory_module.MemoryManager(
        base_dir=tmp_path,
        embedding_provider=FakeEmbeddingProvider(),
        llm=FakeLLM(),
        enable_legacy=False,
    )

    manager.store_item({"id": "same_id", "content": "first", "category": "context", "confidence": 0.8})
    manager.store_item({"id": "same_id", "content": "updated", "category": "project", "confidence": 0.9})

    context_ids = [item["id"] for item in manager.category_layer.get_items("context")]
    project_ids = [item["id"] for item in manager.category_layer.get_items("project")]
    assert "same_id" not in context_ids
    assert "same_id" in project_ids


def test_memory_queue_uses_manager_update_path(tmp_path) -> None:  # noqa: ARG001
    import types

    queue_module = _load_module("memory_queue_module_phase5", MEMORY_DIR / "queue.py")
    queue = queue_module.MemoryUpdateQueue()
    mock_update = MagicMock(return_value=True)

    src_module = types.ModuleType("src")
    agents_module = types.ModuleType("src.agents")
    memory_pkg = types.ModuleType("src.agents.memory")
    memory_module = types.ModuleType("src.agents.memory.memory")
    memory_module.update_memory_from_conversation = mock_update
    src_module.agents = agents_module
    agents_module.memory = memory_pkg
    memory_pkg.memory = memory_module

    with (
        patch.object(
            queue_module,
            "get_memory_config",
            return_value=SimpleNamespace(enabled=True, debounce_seconds=1),
        ),
        patch.dict(
            sys.modules,
            {
                "src": src_module,
                "src.agents": agents_module,
                "src.agents.memory": memory_pkg,
                "src.agents.memory.memory": memory_module,
            },
            clear=False,
        ),
    ):
        queue.add(
            thread_id="thread-1",
            messages=[{"type": "human", "content": "hello"}, {"type": "ai", "content": "world"}],
            agent_name="agent-a",
        )
        queue.flush()

    assert mock_update.call_count == 1
    kwargs = mock_update.call_args.kwargs
    assert kwargs["thread_id"] == "thread-1"
    assert kwargs["agent_name"] == "agent-a"
