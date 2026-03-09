from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from src.agents.middlewares.runtime_profile_middleware import RuntimeProfileMiddleware
from src.runtime_profile import RuntimeProfileRepository


def _prepare_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("NION_HOME", str(tmp_path))
    monkeypatch.setenv("NION_DESKTOP_RUNTIME", "1")

    from src.config import paths as paths_module

    paths_module._paths = None


def test_before_agent_bootstraps_host_mode_from_runtime_context(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _prepare_environment(monkeypatch, tmp_path)
    host_dir = tmp_path / "host-workdir"
    host_dir.mkdir(parents=True)

    middleware = RuntimeProfileMiddleware()
    runtime = SimpleNamespace(
        context={
            "thread_id": "thread-host-context",
            "execution_mode": "host",
            "host_workdir": str(host_dir),
        }
    )

    result = middleware.before_agent({}, runtime)

    assert result == {
        "execution_mode": "host",
        "host_workdir": str(host_dir.resolve()),
        "runtime_profile_locked": True,
    }

    profile = RuntimeProfileRepository().read("thread-host-context")
    assert profile["execution_mode"] == "host"
    assert profile["host_workdir"] == str(host_dir.resolve())
    assert profile["locked"] is True


def test_state_profile_overrides_runtime_context(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _prepare_environment(monkeypatch, tmp_path)
    host_dir = tmp_path / "host-state"
    host_dir.mkdir(parents=True)

    middleware = RuntimeProfileMiddleware()
    runtime = SimpleNamespace(
        context={
            "thread_id": "thread-state-precedence",
            "execution_mode": "sandbox",
            "host_workdir": None,
        }
    )

    result = middleware.before_agent(
        {
            "execution_mode": "host",
            "host_workdir": str(host_dir),
        },
        runtime,
    )

    assert result is not None
    assert result["execution_mode"] == "host"
    assert result["host_workdir"] == str(host_dir.resolve())


def test_before_agent_returns_memory_session_fields_from_runtime_context(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _prepare_environment(monkeypatch, tmp_path)

    middleware = RuntimeProfileMiddleware()
    runtime = SimpleNamespace(
        context={
            "thread_id": "thread-memory-session-runtime",
            "session_mode": "temporary_chat",
            "memory_read": True,
            "memory_write": False,
        }
    )

    result = middleware.before_agent({}, runtime)

    assert result is not None
    assert result["session_mode"] == "temporary_chat"
    assert result["memory_read"] is True
    assert result["memory_write"] is False


def test_state_memory_session_fields_override_runtime_context(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _prepare_environment(monkeypatch, tmp_path)

    middleware = RuntimeProfileMiddleware()
    runtime = SimpleNamespace(
        context={
            "thread_id": "thread-memory-session-state-precedence",
            "session_mode": "temporary_chat",
            "memory_read": False,
            "memory_write": False,
        }
    )

    result = middleware.before_agent(
        {
            "session_mode": "normal",
            "memory_read": True,
            "memory_write": True,
        },
        runtime,
    )

    assert result is not None
    assert result["session_mode"] == "normal"
    assert result["memory_read"] is True
    assert result["memory_write"] is True
