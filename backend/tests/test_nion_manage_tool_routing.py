import importlib
import json

import pytest

system_tools = importlib.import_module("nion.tools.builtins.system_manage_tools")


class _Runtime:
    context = {}
    state = {}
    config = {}


@pytest.mark.unit
def test_nion_manage_help() -> None:
    raw = system_tools.nion_manage_tool.func(runtime=_Runtime(), argv=["help"])
    payload = json.loads(raw)
    assert payload["success"] is True
    assert "Usage:" in payload["message"]


@pytest.mark.unit
def test_nion_manage_unknown_command() -> None:
    raw = system_tools.nion_manage_tool.func(runtime=_Runtime(), argv=["nope"])
    payload = json.loads(raw)
    assert payload["success"] is False

