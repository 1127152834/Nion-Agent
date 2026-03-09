from __future__ import annotations

from types import SimpleNamespace

import src.sandbox.tools as tools_module


def test_bash_tool_runs_from_local_thread_workspace(monkeypatch) -> None:
    captured: dict[str, str] = {}

    class DummySandbox:
        def execute_command(self, command: str) -> str:
            captured["command"] = command
            return "ok"

    monkeypatch.setattr(tools_module, "ensure_sandbox_initialized", lambda runtime: DummySandbox())
    monkeypatch.setattr(tools_module, "ensure_thread_directories_exist", lambda runtime: None)
    monkeypatch.setattr(tools_module, "is_local_sandbox", lambda runtime: True)

    runtime = SimpleNamespace(
        state={
            "execution_mode": "host",
            "thread_data": {"workspace_path": "/tmp/host workspace"},
        }
    )

    result = tools_module.bash_tool.func(runtime=runtime, description="show cwd", command="pwd")

    assert result == "ok"
    assert captured["command"] == "cd '/tmp/host workspace' && pwd"


def test_bash_tool_uses_virtual_workspace_for_remote_sandbox(monkeypatch) -> None:
    captured: dict[str, str] = {}

    class DummySandbox:
        def execute_command(self, command: str) -> str:
            captured["command"] = command
            return "ok"

    monkeypatch.setattr(tools_module, "ensure_sandbox_initialized", lambda runtime: DummySandbox())
    monkeypatch.setattr(tools_module, "ensure_thread_directories_exist", lambda runtime: None)
    monkeypatch.setattr(tools_module, "is_local_sandbox", lambda runtime: False)

    runtime = SimpleNamespace(
        state={
            "execution_mode": "sandbox",
            "thread_data": {"workspace_path": "/Users/example/thread-workspace"},
        }
    )

    result = tools_module.bash_tool.func(runtime=runtime, description="show cwd", command="pwd")

    assert result == "ok"
    assert captured["command"] == "cd /mnt/user-data/workspace && pwd"
