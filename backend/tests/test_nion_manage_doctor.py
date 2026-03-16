import importlib
import json
from pathlib import Path

import pytest

system_tools = importlib.import_module("nion.tools.builtins.system_manage_tools")


class _Runtime:
    context = {}
    state = {}
    config = {"metadata": {"trace_id": "t1"}}


@pytest.mark.unit
def test_nion_manage_doctor_includes_base_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NION_HOME", str(tmp_path / "home"))
    raw = system_tools.nion_manage_tool.func(runtime=_Runtime(), argv=["doctor"])
    payload = json.loads(raw)
    assert payload["success"] is True
    assert "base_dir" in payload["data"]

