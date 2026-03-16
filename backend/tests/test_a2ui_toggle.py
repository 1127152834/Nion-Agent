from __future__ import annotations

from unittest.mock import MagicMock

import pytest


def test_prompt_template_can_disable_a2ui_section() -> None:
    """A2UI toggle must remove the full A2UI system block from the prompt."""
    from nion.agents.lead_agent.prompt import apply_prompt_template

    enabled = apply_prompt_template(a2ui_enabled=True)
    assert "<a2ui_system>" in enabled
    assert "@a2ui-sdk/react/0.8" in enabled

    disabled = apply_prompt_template(a2ui_enabled=False)
    assert "<a2ui_system>" not in disabled
    assert '<a2ui_policy enabled="false">' in disabled
    assert "@a2ui-sdk/react/0.8" not in disabled


def _fake_app_config(*, a2ui_enabled: bool) -> MagicMock:
    cfg = MagicMock()
    cfg.tools = []
    cfg.models = []
    cfg.get_model_config.return_value = None
    cfg.a2ui = MagicMock(enabled=a2ui_enabled)
    return cfg


@pytest.mark.parametrize("enabled", [True, False])
def test_get_available_tools_respects_a2ui_toggle(monkeypatch: pytest.MonkeyPatch, enabled: bool) -> None:
    """When A2UI is disabled, the model must NOT see send_a2ui_json_to_client as an available tool."""
    from nion.tools.tools import get_available_tools

    cfg = _fake_app_config(a2ui_enabled=enabled)
    monkeypatch.setattr("nion.tools.tools.ensure_latest_app_config", lambda **_: cfg)

    # Keep the test isolated from local CLI state (extensions_config.json).
    import nion.cli.runtime_tools as runtime_tools

    monkeypatch.setattr(runtime_tools, "get_cli_tools", lambda **_: [])

    tools = get_available_tools(groups=[], include_mcp=False)
    names = {tool.name for tool in tools}

    if enabled:
        assert "send_a2ui_json_to_client" in names
    else:
        assert "send_a2ui_json_to_client" not in names


@pytest.mark.parametrize("enabled", [True, False])
def test_lead_agent_middlewares_respect_a2ui_toggle(monkeypatch: pytest.MonkeyPatch, enabled: bool) -> None:
    """A2UIMiddleware must be fully skipped when A2UI is disabled."""
    from nion.agents.lead_agent.agent import _build_middlewares
    from nion.agents.middlewares.a2ui_middleware import A2UIMiddleware

    cfg = _fake_app_config(a2ui_enabled=enabled)
    monkeypatch.setattr("nion.agents.lead_agent.agent.get_app_config", lambda: cfg)

    middlewares = _build_middlewares({"configurable": {}}, model_name="test-model")
    has_a2ui = any(isinstance(item, A2UIMiddleware) for item in middlewares)

    assert has_a2ui is enabled
