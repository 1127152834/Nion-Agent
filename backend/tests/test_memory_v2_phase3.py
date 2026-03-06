"""Phase 3 tests for proactive retrieval and self-evolving memory."""

from __future__ import annotations

import importlib.util
import sys
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


class FakeHybridSearch:
    def __init__(self, results: list[dict]):
        self._results = results

    def search(self, query: str, query_embedding: list[float], top_k: int = 5):
        return self._results[:top_k]


class FakeLLMResponse:
    def __init__(self, content: str):
        self.content = content


class FakeLLM:
    def __init__(self, content: str):
        self._content = content

    def invoke(self, prompt: str):  # noqa: ARG002
        return FakeLLMResponse(self._content)


class FakeItemLayer:
    def __init__(self, items: list[dict]):
        self._items = {item["id"]: dict(item) for item in items}

    def list_items(self) -> list[dict]:
        return [dict(item) for item in self._items.values()]

    def store(self, item: dict):
        self._items[item["id"]] = dict(item)
        return dict(item)

    def delete(self, item_id: str) -> bool:
        return self._items.pop(item_id, None) is not None


class FakeCategoryLayer:
    def __init__(self):
        self._items_by_category: dict[str, list[dict]] = {}

    def add_item(self, item: dict):
        category = str(item.get("category", "context"))
        bucket = self._items_by_category.setdefault(category, [])
        bucket = [entry for entry in bucket if entry.get("id") != item.get("id")]
        bucket.append(dict(item))
        self._items_by_category[category] = bucket
        return item

    def remove_item(self, category: str, item_id: str):
        key = str(category)
        bucket = self._items_by_category.get(key, [])
        self._items_by_category[key] = [entry for entry in bucket if entry.get("id") != item_id]
        return True

    def remove_item_globally(self, item_id: str):
        for category, bucket in list(self._items_by_category.items()):
            self._items_by_category[category] = [
                entry for entry in bucket if entry.get("id") != item_id
            ]
        return True

    def get_items(self, category: str) -> list[dict]:
        return [dict(item) for item in self._items_by_category.get(category, [])]


def test_phase3_module_files_loadable() -> None:
    _load_module("memory_proactive_dual_mode", "proactive/dual_mode.py")
    _load_module("memory_evolving_self_evolver", "evolving/self_evolver.py")


def test_dual_mode_uses_fast_mode_for_high_confidence() -> None:
    dual_module = _load_module("memory_proactive_dual_mode", "proactive/dual_mode.py")

    retriever = dual_module.DualModeRetriever(
        hybrid_search=FakeHybridSearch(
            [{"id": "item_1", "content": "python memory", "fused_score": 0.95}]
        ),
        llm=FakeLLM("No deep reasoning needed"),
        fast_threshold=0.7,
        deep_threshold=0.3,
    )

    result = retriever.retrieve("python", [1.0, 0.0])

    assert result["mode"] == dual_module.RetrievalMode.FAST_CONTEXT.value
    assert result["results"][0]["id"] == "item_1"


def test_dual_mode_uses_deep_mode_for_low_confidence() -> None:
    dual_module = _load_module("memory_proactive_dual_mode", "proactive/dual_mode.py")

    candidates = [
        {"id": "item_1", "content": "old memory", "fused_score": 0.2},
        {"id": "item_2", "content": "new relevant memory", "fused_score": 0.19},
    ]

    retriever = dual_module.DualModeRetriever(
        hybrid_search=FakeHybridSearch(candidates),
        llm=FakeLLM("Most relevant order: item_2, item_1"),
        fast_threshold=0.7,
        deep_threshold=0.3,
    )

    result = retriever.retrieve("why new memory matters", [0.1, 0.9])

    assert result["mode"] == dual_module.RetrievalMode.DEEP_REASONING.value
    assert result["results"][0]["id"] == "item_2"
    assert result["reasoning"]


def test_self_evolver_records_usage_and_handles_stale_items() -> None:
    evolve_module = _load_module("memory_evolving_self_evolver", "evolving/self_evolver.py")

    old_time = (datetime.now(UTC) - timedelta(days=120)).isoformat()
    items = [
        {
            "id": "item_old_low",
            "content": "legacy preference about editor",
            "category": "preference",
            "confidence": 0.4,
            "access_count": 1,
            "created_at": old_time,
            "last_accessed": old_time,
        },
        {
            "id": "item_old_high",
            "content": "critical project context",
            "category": "project",
            "confidence": 0.95,
            "access_count": 12,
            "created_at": old_time,
            "last_accessed": old_time,
        },
    ]

    item_layer = FakeItemLayer(items)
    engine = evolve_module.SelfEvolvingEngine(
        item_layer=item_layer,
        category_layer=FakeCategoryLayer(),
        llm=FakeLLM("merged memory"),
        config={"staleness_threshold_days": 90},
    )

    engine.record_query("python memory", category="knowledge")
    trends = engine.analyze_topic_trends(time_window_days=365)

    report = engine.evolve()

    assert engine.usage_pattern.query_patterns["python"] >= 1
    assert "python" in trends or isinstance(trends, list)
    assert "metrics" in report
    action_types = {action["type"] for action in report["actions"]}
    assert "degrade" in action_types
    assert "mark_stale" in action_types


def test_self_evolver_can_merge_similar_items() -> None:
    evolve_module = _load_module("memory_evolving_self_evolver", "evolving/self_evolver.py")

    now = datetime.now(UTC).isoformat()
    items = [
        {
            "id": "item_a",
            "content": "python project memory context",
            "category": "context",
            "confidence": 0.8,
            "access_count": 2,
            "created_at": now,
            "last_accessed": now,
        },
        {
            "id": "item_b",
            "content": "python project memory details",
            "category": "context",
            "confidence": 0.85,
            "access_count": 3,
            "created_at": now,
            "last_accessed": now,
        },
    ]

    item_layer = FakeItemLayer(items)
    category_layer = FakeCategoryLayer()
    for item in items:
        category_layer.add_item(item)
    engine = evolve_module.SelfEvolvingEngine(
        item_layer=item_layer,
        category_layer=category_layer,
        llm=FakeLLM("merged memory summary"),
        config={
            "merge_similarity_threshold": 0.5,
            "max_items_before_compress": 999,
            "redundancy_threshold": 0.99,
        },
    )

    report = engine.evolve()

    merge_actions = [action for action in report["actions"] if action["type"] == "merge"]
    assert len(merge_actions) == 1
    assert merge_actions[0]["from"] == ["item_a", "item_b"]

    # Hard-delete source items after merge to avoid duplicate pollution.
    assert "item_a" not in item_layer._items  # noqa: SLF001
    assert "item_b" not in item_layer._items  # noqa: SLF001

    # Category layer should contain merged item and clean source item ids.
    context_ids = [item["id"] for item in category_layer.get_items("context")]
    assert "item_a" not in context_ids
    assert "item_b" not in context_ids
    assert any(item_id.startswith("merged_") for item_id in context_ids)
