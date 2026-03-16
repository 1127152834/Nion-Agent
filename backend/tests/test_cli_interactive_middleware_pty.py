from __future__ import annotations

import re

from nion.agents.middlewares.cli_interactive_middleware import CLIInteractiveMiddleware


def test_cli_interactive_middleware_emits_terminal_payload_for_pty(monkeypatch):
    mw = CLIInteractiveMiddleware()

    # Force interactive detection without depending on catalog parsing.
    monkeypatch.setattr(
        mw,
        "_detect_interactive_command",
        lambda tool_id, argv: {
            "pattern": "login",
            "type": "input",
            "prompt": "scan qrcode",
            "input_method": "pty",
        },
    )

    class _Req:
        def __init__(self, tool_call: dict):
            self.tool_call = tool_call

    req = _Req({"name": "cli_xhs-cli", "args": {"argv": ["login"]}, "id": "tc1"})

    def _should_not_call_handler(_):
        raise AssertionError("handler should not be called for PTY interactive CLI")

    result = mw.wrap_tool_call(req, handler=_should_not_call_handler)
    assert hasattr(result, "goto")

    tool_msg = result.update["messages"][0]
    payload = tool_msg.additional_kwargs["cli_interactive"]

    assert payload["status"] == "awaiting_terminal"
    assert payload["tool_id"] == "xhs-cli"
    assert payload["argv"] == ["login"]
    assert re.fullmatch(r"[0-9a-f\\-]{36}", payload["session_id"])
    assert payload["websocket_url"].endswith(f"/api/cli/sessions/{payload['session_id']}/stream")
