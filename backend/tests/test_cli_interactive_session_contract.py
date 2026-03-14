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


def test_read_output_loop_invokes_callback_on_event_loop_thread(monkeypatch):
    """Regression: output callbacks must run on the event-loop thread.

    The WebSocket router's output callback schedules websocket.send_json()
    via asyncio.create_task(). If we invoke callbacks in a threadpool executor,
    asyncio.create_task() raises "no running event loop" and the UI terminal
    appears stuck with no output.
    """
    import asyncio

    from src.cli import interactive_session as mod

    mgr = mod.CLIInteractiveSessionManager()
    sid = "sid"
    master_fd = 10
    pid = 123

    mgr._sessions[sid] = mod.InteractiveSession(
        session_id=sid,
        tool_id="xhs-cli",
        command=["/bin/echo", "hello"],
        pid=pid,
        master_fd=master_fd,
        status="running",
        created_at=0.0,
        output_buffer=[],
    )

    called: dict[str, str] = {}

    def cb(_sid: str, data: str):
        # Will raise RuntimeError if executed outside a running event loop.
        asyncio.get_running_loop()
        called["data"] = data

    mgr._output_callbacks[sid] = cb

    waitpid_calls = [(0, 0), (pid, 0)]  # alive, then exited with code 0

    def fake_waitpid(_pid: int, _options: int):
        return waitpid_calls.pop(0)

    monkeypatch.setattr(mod.os, "waitpid", fake_waitpid)

    select_calls = [([master_fd], [], [])]

    def fake_select(_r, _w, _x, _timeout):  # noqa: ANN001
        if select_calls:
            return select_calls.pop(0)
        return ([], [], [])

    monkeypatch.setattr(mod.select, "select", fake_select)

    read_calls = [b"hello\n", b""]

    def fake_read(_fd: int, _n: int):
        return read_calls.pop(0)

    monkeypatch.setattr(mod.os, "read", fake_read)
    monkeypatch.setattr(mod.os, "close", lambda *_: None)

    asyncio.run(mgr._read_output_loop(sid))

    assert called.get("data") == "hello\n"
