from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from src.agents.memory.core import MemoryReadRequest
from src.agents.memory.structured_runtime import StructuredFsRuntime
from src.config.paths import Paths


def _make_runtime(base_dir: Path) -> StructuredFsRuntime:
    with patch("src.agents.memory.structured_runtime.get_paths", return_value=Paths(base_dir=base_dir)):
        return StructuredFsRuntime()


def _memory_payload(content: str, confidence: float = 0.6) -> dict:
    return {
        "user": {
            "workContext": {"summary": "", "updatedAt": ""},
            "personalContext": {"summary": "", "updatedAt": ""},
            "topOfMind": {"summary": "", "updatedAt": ""},
        },
        "history": {
            "recentMonths": {"summary": "", "updatedAt": ""},
            "earlierContext": {"summary": "", "updatedAt": ""},
            "longTermBackground": {"summary": "", "updatedAt": ""},
        },
        "facts": [
            {
                "id": "",
                "content": content,
                "category": "context",
                "confidence": confidence,
                "createdAt": "",
                "source": "thread-x",
            }
        ],
    }


def test_scope_isolation_between_global_and_agent(tmp_path: Path):
    runtime = _make_runtime(tmp_path)

    runtime.save_memory_data(_memory_payload("global fact"), agent_name=None, thread_id="t-global")
    runtime.save_memory_data(
        _memory_payload("agent fact", confidence=0.55),
        agent_name="planner",
        thread_id="t-agent",
    )

    global_data = runtime.get_memory_data(MemoryReadRequest(agent_name=None))
    agent_data = runtime.get_memory_data(MemoryReadRequest(agent_name="planner"))

    assert [fact["content"] for fact in global_data["facts"]] == ["global fact"]
    assert [fact["content"] for fact in agent_data["facts"]] == ["agent fact"]

    global_manifest = tmp_path / "memory" / "index" / "manifest.json"
    agent_manifest = tmp_path / "agents" / "planner" / "memory" / "index" / "manifest.json"
    assert global_manifest.exists()
    assert agent_manifest.exists()


def test_governance_queue_and_realtime_promotion(tmp_path: Path):
    runtime = _make_runtime(tmp_path)

    runtime.save_memory_data(
        _memory_payload("Alice likes tea", confidence=0.92),
        agent_name="planner",
        thread_id="t1",
    )
    runtime.save_memory_data(
        _memory_payload("Bob likes basketball", confidence=0.75),
        agent_name="planner",
        thread_id="t2",
    )

    global_data = runtime.get_memory_data(MemoryReadRequest(agent_name=None))
    global_contents = [fact["content"] for fact in global_data["facts"]]
    assert "Alice likes tea" in global_contents
    assert "Bob likes basketball" not in global_contents

    status_before = runtime.get_governance_status()
    assert status_before["pending_count"] >= 1

    result = runtime.run_governance()
    assert result["promoted"] >= 1
    assert result["pending_count"] == 0

    global_data_after = runtime.reload_memory_data(MemoryReadRequest(agent_name=None))
    global_contents_after = [fact["content"] for fact in global_data_after["facts"]]
    assert "Bob likes basketball" in global_contents_after


def test_conflict_marks_entries_contested(tmp_path: Path):
    runtime = _make_runtime(tmp_path)

    runtime.save_memory_data(
        _memory_payload("Alice likes tea", confidence=0.95),
        agent_name="researcher",
        thread_id="t1",
    )
    runtime.save_memory_data(
        _memory_payload("Alice likes coffee", confidence=0.95),
        agent_name="researcher",
        thread_id="t2",
    )

    status = runtime.get_governance_status()
    assert status["contested_count"] >= 1

    global_items = runtime.get_memory_items(scope="global")
    contested = [item for item in global_items if item.get("status") == "contested"]
    assert contested
