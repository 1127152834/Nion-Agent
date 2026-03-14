from __future__ import annotations

import pytest


@pytest.mark.anyio
async def test_ws_init_accepts_tool_id_and_argv(monkeypatch: pytest.MonkeyPatch):
    from src.gateway.routers import cli_interactive as mod

    started: dict = {}

    class FakeWS:
        def __init__(self):
            self.sent = []
            self._accepted = False
            self._rx = [
                {"tool_id": "xhs-cli", "argv": ["login"]},
                {"type": "terminate"},
            ]

        async def accept(self):
            self._accepted = True

        async def receive_json(self):
            return self._rx.pop(0)

        async def send_json(self, payload):
            self.sent.append(payload)

        async def close(self):
            return

    # Stub manager.start_session to avoid real PTY/fork.
    class FakeMgr:
        def start_session(self, *, session_id, tool_id, argv, output_callback):
            started.update({"session_id": session_id, "tool_id": tool_id, "argv": argv})
            return type("S", (), {"session_id": session_id})()

        def send_input(self, *_):
            return True

        def resize_terminal(self, *_):
            return True

        def terminate_session(self, *_):
            return True

        def get_session(self, *_):
            return None

        def cleanup_session(self, *_):
            return None

    monkeypatch.setattr(mod, "get_session_manager", lambda: FakeMgr())
    monkeypatch.setattr(
        mod,
        "get_keychain",
        lambda: type(
            "K",
            (),
            {
                "load_session": lambda *_: None,
                "save_session": lambda *_: None,
            },
        )(),
    )

    ws = FakeWS()
    await mod.stream_cli_session(ws, session_id="sid-1")

    assert ws._accepted is True
    assert started == {"session_id": "sid-1", "tool_id": "xhs-cli", "argv": ["login"]}
    assert any(m.get("type") == "started" for m in ws.sent)
