from __future__ import annotations


def test_start_session_builds_command_via_resolver(monkeypatch):
    from src.cli import interactive_session as mod

    built: dict = {}

    def fake_resolve(tool_id: str, argv: list[str]) -> list[str]:
        built["tool_id"] = tool_id
        built["argv"] = argv
        return ["/bin/echo", *argv]

    # Avoid real fork/pty in unit test
    monkeypatch.setattr(mod, "pty", type("P", (), {"openpty": staticmethod(lambda: (100, 101))})())
    monkeypatch.setattr(mod.os, "fork", lambda: 12345)
    monkeypatch.setattr(mod.os, "close", lambda *_: None)
    monkeypatch.setattr(mod, "resolve_managed_cli_command", fake_resolve)

    def _close_task(coro):
        coro.close()
        return None

    monkeypatch.setattr(mod.asyncio, "create_task", _close_task)

    mgr = mod.CLIInteractiveSessionManager()
    session = mgr.start_session(session_id="sid", tool_id="xhs-cli", argv=["login"], output_callback=None)

    assert built == {"tool_id": "xhs-cli", "argv": ["login"]}
    assert session.command[:2] == ["/bin/echo", "login"]
