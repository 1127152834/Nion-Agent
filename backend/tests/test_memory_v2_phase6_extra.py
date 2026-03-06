"""Phase 6 tests for remaining memory v2 support modules."""

from __future__ import annotations

import importlib.util
import sys
from datetime import UTC, datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
MEMORY_DIR = BACKEND_DIR / "src" / "agents" / "memory"


def _load_module(module_name: str, relative_path: str):
    module_path = MEMORY_DIR / relative_path
    assert module_path.exists(), f"Missing module file: {module_path}"

    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None and spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_phase6_module_files_loadable() -> None:
    _load_module("memory_config_runtime", "config.py")
    _load_module("memory_proactive_context_loader", "proactive/context_loader.py")
    _load_module("memory_proactive_patterns", "proactive/patterns.py")
    _load_module("memory_evolving_scheduler", "evolving/scheduler.py")
    _load_module("memory_soul_heartbeat", "soul/heartbeat.py")
    _load_module("memory_intention_predictor", "intention/intention_predictor.py")
    _load_module("memory_linker", "linking/memory_linker.py")
    _load_module("memory_storage_manager", "storage/manager.py")


def test_context_preloader_and_pattern_analyzer_work() -> None:
    context_module = _load_module("memory_proactive_context_loader", "proactive/context_loader.py")
    pattern_module = _load_module("memory_proactive_patterns", "proactive/patterns.py")

    class _Manager:
        def search(self, query: str, top_k: int = 5):  # noqa: ARG002
            return {"mode": "fast", "results": [{"id": "item_1", "content": "python memory"}]}

    preloader = context_module.ContextPreloader(memory_manager=_Manager())
    preloaded = preloader.preload("python", top_k=3)

    assert preloaded["results"]
    assert preloaded["results"][0]["id"] == "item_1"

    analyzer = pattern_module.UsagePatternAnalyzer()
    analyzer.record_query("python memory search", category="knowledge")
    analyzer.record_query("python memory debug", category="knowledge")

    top_queries = analyzer.top_queries(1)
    assert top_queries
    assert top_queries[0][0] == "python"

    predicted = analyzer.predict_categories("python memory")
    assert "knowledge" in predicted


def test_evolution_scheduler_and_heartbeat_manager_work(tmp_path) -> None:
    scheduler_module = _load_module("memory_evolving_scheduler", "evolving/scheduler.py")
    workspace_module = _load_module("memory_soul_workspace2", "soul/workspace.py")
    heartbeat_module = _load_module("memory_soul_heartbeat", "soul/heartbeat.py")

    class _Evolver:
        def evolve(self):
            return {"actions": [{"type": "noop"}]}

    scheduler = scheduler_module.MemoryEvolutionScheduler(
        evolver=_Evolver(),
        interval_hours=1,
        query_threshold=2,
    )

    scheduler.record_query()
    scheduler.record_query()
    report = scheduler.run_if_needed(now=datetime.now(UTC))
    assert report is not None

    ws = workspace_module.WorkspaceFiles.create_for_agent("hb-agent", tmp_path)
    ws.set_heartbeat("hourly", ["summarize memory", "cleanup stale"])

    manager = heartbeat_module.HeartbeatManager(workspace_files=ws)
    tasks = manager.get_tasks()
    assert len(tasks) == 2
    assert tasks[0].name == "summarize memory"


def test_intention_predictor_linker_and_storage_manager_work(tmp_path) -> None:
    intention_module = _load_module("memory_intention_predictor", "intention/intention_predictor.py")
    linker_module = _load_module("memory_linker", "linking/memory_linker.py")
    storage_module = _load_module("memory_storage_manager", "storage/manager.py")

    predictor = intention_module.IntentionPredictor()
    intentions = predictor.predict("请帮我总结 memory 并搜索 python 相关偏好")
    assert intentions
    assert intentions[0].confidence > 0

    linker = linker_module.MemoryLinker(similarity_threshold=0.4)
    items = [
        {"id": "a", "content": "python project memory context"},
        {"id": "b", "content": "python project memory detail"},
        {"id": "c", "content": "design token system"},
    ]
    links = linker.build_links(items)
    assert any(link.source_id == "a" and link.target_id == "b" for link in links)

    storage = storage_module.StorageManager(base_dir=tmp_path)
    payload = {"version": "2.0", "items": items}
    snapshot_path = storage.save_snapshot(payload, name="memory-state")
    loaded = storage.load_snapshot(snapshot_path)
    assert loaded["version"] == "2.0"
    assert len(loaded["items"]) == 3
