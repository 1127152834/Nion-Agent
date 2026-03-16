from __future__ import annotations

import pytest

from nion.agents.memory.openviking_runtime import OpenVikingRuntime
from nion.config.paths import Paths


@pytest.mark.unit
def test_BE_CORE_MEM_407_default_agent_write_and_hit_use_global(monkeypatch, tmp_path):
    # Ensure runtime uses an isolated sqlite db.
    monkeypatch.setattr(
        "nion.agents.memory.openviking_runtime.get_paths",
        lambda: Paths(base_dir=tmp_path),
    )

    runtime = OpenVikingRuntime()

    # Avoid touching real OpenViking store during unit test; rely on local ledger fallback.
    monkeypatch.setattr(runtime, "_openviking_find", lambda **kwargs: [])

    write = runtime.write_memory_graph(
        thread_id="t1",
        chat_id="t1",
        messages=[
            {"role": "user", "content": "我叫张天成"},
            {"role": "assistant", "content": "好的"},
        ],
        agent_name="_default",
        write_source="tool",
        explicit_write=True,
    )
    assert write["actions"], "should produce at least one memory action"

    global_items = runtime.get_memory_items(scope="global", agent_name=None)
    assert len(global_items) >= 1

    # Backward-compat: even if someone requests scope=agent&_default, it should still see global.
    default_items = runtime.get_memory_items(scope="agent", agent_name="_default")
    assert len(default_items) == len(global_items)

    hits = runtime.search_memory(query="我叫什么名字", limit=5, agent_name=None)
    assert hits, "should hit from local ledger"
    assert any("张天成" in str(hit.get("memory") or hit.get("abstract") or "") for hit in hits)
