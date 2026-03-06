"""Phase 2 tests for memory system v2.0 layer modules."""

from __future__ import annotations

import importlib.util
import sys
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

MEMORY_DIR = Path(__file__).resolve().parents[1] / "src" / "agents" / "memory"


def _load_module(module_name: str, relative_path: str):
    module_path = MEMORY_DIR / relative_path
    assert module_path.exists(), f"Missing module file: {module_path}"

    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None and spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class FakeEmbeddingProvider:
    """Deterministic embedding provider for tests."""

    def embed(self, text: str) -> list[float]:
        lowered = text.lower()
        return [
            1.0 if "python" in lowered else 0.0,
            1.0 if "project" in lowered else 0.0,
        ]

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return [self.embed(text) for text in texts]


def test_phase2_layer_module_files_loadable() -> None:
    _load_module("memory_layers_resource", "layers/resource.py")
    _load_module("memory_layers_item", "layers/item.py")
    _load_module("memory_layers_category", "layers/category.py")


def test_resource_layer_store_and_date_range_query(tmp_path) -> None:
    resource_module = _load_module("memory_layers_resource", "layers/resource.py")
    layer = resource_module.ResourceLayer(base_dir=str(tmp_path))

    old_ts = datetime.now(UTC) - timedelta(days=60)
    new_ts = datetime.now(UTC)

    layer.store({"id": "res_old", "type": "conversation", "content": "old", "created_at": old_ts})
    layer.store({"id": "res_new", "type": "conversation", "content": "new", "created_at": new_ts})

    results = layer.search(start_date=new_ts - timedelta(days=1), end_date=new_ts + timedelta(days=1))
    result_ids = {item["id"] for item in results}

    assert "res_new" in result_ids
    assert "res_old" not in result_ids


def test_item_layer_store_and_hybrid_search(tmp_path) -> None:
    item_module = _load_module("memory_layers_item", "layers/item.py")

    layer = item_module.ItemLayer(base_dir=str(tmp_path), embedding_provider=FakeEmbeddingProvider())

    layer.store({"id": "item_1", "content": "Python embedding best practices", "category": "knowledge", "confidence": 0.9})
    layer.store({"id": "item_2", "content": "Project milestone this week", "category": "project", "confidence": 0.8})

    results = layer.search("python embedding", top_k=2)

    assert results
    assert results[0]["id"] == "item_1"
    assert "fused_score" in results[0]


def test_item_layer_update_access_updates_counters(tmp_path) -> None:
    item_module = _load_module("memory_layers_item", "layers/item.py")

    layer = item_module.ItemLayer(base_dir=str(tmp_path), embedding_provider=FakeEmbeddingProvider())
    layer.store({"id": "item_access", "content": "Python project context", "category": "context", "confidence": 0.9})

    before = layer.get("item_access")
    assert before["access_count"] == 0

    updated = layer.update_access("item_access")
    assert updated is True

    after = layer.get("item_access")
    assert after["access_count"] == 1


def test_item_layer_list_items_thread_safe_under_concurrent_writes(tmp_path) -> None:
    item_module = _load_module("memory_layers_item_threadsafe", "layers/item.py")
    layer = item_module.ItemLayer(base_dir=str(tmp_path), embedding_provider=FakeEmbeddingProvider())
    errors: list[Exception] = []

    def writer() -> None:
        for idx in range(500):
            item_id = f"concurrent_{idx}"
            layer.store(
                {
                    "id": item_id,
                    "content": f"Python project note {idx}",
                    "category": "context",
                    "confidence": 0.8,
                }
            )
            if idx % 2 == 0:
                layer.delete(item_id)

    def reader() -> None:
        for _ in range(1000):
            try:
                snapshot = layer.list_items()
                if snapshot:
                    layer.get(snapshot[0]["id"])
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
                return

    writer_thread = threading.Thread(target=writer)
    reader_threads = [threading.Thread(target=reader), threading.Thread(target=reader)]

    writer_thread.start()
    for thread in reader_threads:
        thread.start()

    writer_thread.join()
    for thread in reader_threads:
        thread.join()

    assert not errors


def test_item_layer_bm25_only_uses_real_item_id_when_vector_mismatch(tmp_path) -> None:
    item_module = _load_module("memory_layers_item_bm25_only", "layers/item.py")

    layer = item_module.ItemLayer(base_dir=str(tmp_path), embedding_provider=FakeEmbeddingProvider())
    layer.store({"id": "item_1", "content": "Python embedding best practices", "category": "knowledge", "confidence": 0.9})

    results = layer.search("python embedding", top_k=3, query_embedding=[1.0, 0.0, 0.0])
    assert results
    assert results[0]["id"] == "item_1"


def test_item_layer_keeps_same_content_with_different_ids(tmp_path) -> None:
    item_module = _load_module("memory_layers_item_same_content", "layers/item.py")

    layer = item_module.ItemLayer(base_dir=str(tmp_path), embedding_provider=FakeEmbeddingProvider())
    layer.store({"id": "item_1", "content": "same content", "category": "context", "confidence": 0.9})
    layer.store({"id": "item_2", "content": "same content", "category": "project", "confidence": 0.8})

    results = layer.search("same", top_k=10, query_embedding=[1.0, 0.0])
    result_ids = {item["id"] for item in results}
    assert result_ids == {"item_1", "item_2"}


def test_category_layer_manage_items_and_render_markdown(tmp_path) -> None:
    category_module = _load_module("memory_layers_category", "layers/category.py")
    layer = category_module.CategoryLayer(base_dir=str(tmp_path))

    layer.add_item({"id": "item_cat_1", "content": "User prefers concise answers", "category": "preference"})
    layer.add_item({"id": "item_cat_2", "content": "User manages project alpha", "category": "project"})

    preference_items = layer.get_items("preference")
    assert len(preference_items) == 1
    assert preference_items[0]["id"] == "item_cat_1"

    markdown = layer.render_markdown("preference")
    assert "# Memory Category: preference" in markdown
    assert "User prefers concise answers" in markdown

    removed = layer.remove_item("preference", "item_cat_1")
    assert removed is True
    assert layer.get_items("preference") == []


def test_category_layer_reassign_cleans_old_category(tmp_path) -> None:
    category_module = _load_module("memory_layers_category_migrate", "layers/category.py")
    layer = category_module.CategoryLayer(base_dir=str(tmp_path))

    layer.add_item({"id": "item_move", "content": "first", "category": "context"})
    layer.add_item({"id": "item_move", "content": "second", "category": "project"})

    context_ids = [item["id"] for item in layer.get_items("context")]
    project_ids = [item["id"] for item in layer.get_items("project")]
    assert "item_move" not in context_ids
    assert "item_move" in project_ids
