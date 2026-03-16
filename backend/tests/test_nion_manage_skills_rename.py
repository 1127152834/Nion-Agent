import importlib
import json

import pytest

system_tools = importlib.import_module("nion.tools.builtins.system_manage_tools")


class _Runtime:
    context = {}
    state = {}
    config = {}


@pytest.mark.unit
def test_nion_manage_skills_rename_requires_confirmation() -> None:
    raw = system_tools.nion_manage_tool.func(runtime=_Runtime(), argv=["skills", "rename", "a", "b"])
    payload = json.loads(raw)
    assert payload["success"] is False
    assert payload["requires_confirmation"] is True
    assert payload["confirmation_token"]

