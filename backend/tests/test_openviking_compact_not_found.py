from __future__ import annotations

import pytest

from src.agents.memory.openviking_runtime import OpenVikingRuntime
from src.config.paths import Paths


@pytest.mark.unit
def test_BE_CORE_MEM_408_compact_tolerates_remote_not_found(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "src.agents.memory.openviking_runtime.get_paths",
        lambda: Paths(base_dir=tmp_path),
    )
    runtime = OpenVikingRuntime()

    runtime._sqlite_index.upsert_resource(
        agent_name=None,
        memory_id="m-old",
        uri="viking://manifest/m-old",
        summary="old",
        score=0.8,
        status="active",
    )
    runtime._sqlite_index.upsert_resource(
        agent_name=None,
        memory_id="m-new",
        uri="viking://manifest/m-new",
        summary="new",
        score=0.8,
        status="active",
    )

    def _rm(*, uri: str, agent_name):
        raise RuntimeError(f"remove: /default/manifest/{uri.split('/')[-1]}: not found")

    monkeypatch.setattr(runtime, "_openviking_rm", _rm)

    result = runtime.compact_memory(ratio=0.5, scope="global", agent_name=None)

    assert result["removed_count"] == 1
    assert runtime._sqlite_index.get_resource(agent_name=None, memory_id="m-old") is None
    assert runtime._sqlite_index.get_resource(agent_name=None, memory_id="m-new") is not None


@pytest.mark.unit
def test_BE_CORE_MEM_409_forget_tolerates_remote_not_found(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "src.agents.memory.openviking_runtime.get_paths",
        lambda: Paths(base_dir=tmp_path),
    )
    runtime = OpenVikingRuntime()

    runtime._sqlite_index.upsert_resource(
        agent_name=None,
        memory_id="m1",
        uri="viking://manifest/m1",
        summary="demo",
        score=0.8,
        status="active",
    )

    monkeypatch.setattr(
        runtime,
        "_openviking_rm",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("not found")),
    )

    result = runtime.forget_memory(memory_id="m1", scope="global", agent_name=None)

    assert result["deleted"] is True
    assert runtime._sqlite_index.get_resource(agent_name=None, memory_id="m1") is None

