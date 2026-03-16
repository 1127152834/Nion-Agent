from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from langchain_core.messages import HumanMessage

_middleware_module = pytest.importorskip(
    "src.agents.middlewares.tool_safety_guard_middleware",
    exc_type=ImportError,
)
ToolSafetyGuardMiddleware = _middleware_module.ToolSafetyGuardMiddleware


def _patch_policy(monkeypatch, *, ttl_seconds: int = 300) -> None:
    monkeypatch.setattr(
        ToolSafetyGuardMiddleware,
        "_load_policy",
        staticmethod(
            lambda: {
                "dangerous_patterns": [r"\brm\s+-rf\b"],
                "deny_patterns": [r"\brm\s+-rf\s+/(?:\s|$)"],
                "protected_paths": ["/System"],
                "confirm_ttl_seconds": ttl_seconds,
            }
        ),
    )


def test_evaluate_deny_dangerous_and_allow(monkeypatch) -> None:
    _patch_policy(monkeypatch)
    middleware = ToolSafetyGuardMiddleware()

    deny_decision, _ = middleware._evaluate("bash", {"command": "rm -rf /"})
    ask_decision, _ = middleware._evaluate("bash", {"command": "rm -rf ./tmp"})
    allow_decision, _ = middleware._evaluate("bash", {"command": "echo hello"})

    assert deny_decision == "deny"
    assert ask_decision == "ask"
    assert allow_decision == "allow"


def test_evaluate_protected_path_hits_ask(monkeypatch) -> None:
    _patch_policy(monkeypatch)
    middleware = ToolSafetyGuardMiddleware()

    decision, reason = middleware._evaluate("write_file", {"path": "/System/Library/config.txt"})

    assert decision == "ask"
    assert "受保护路径" in reason


def test_before_agent_confirm_ttl(monkeypatch) -> None:
    _patch_policy(monkeypatch, ttl_seconds=1)
    middleware = ToolSafetyGuardMiddleware()

    pending_signature = "abc123"
    old_asked_at = (datetime.now(UTC) - timedelta(seconds=5)).isoformat()
    state_expired = {
        "tool_safety": {
            "pending_signature": pending_signature,
            "asked_at": old_asked_at,
        },
        "messages": [HumanMessage(content="确认执行")],
    }
    update_expired = middleware.before_agent(state_expired, runtime=SimpleNamespace())
    assert update_expired is not None
    assert update_expired["tool_safety"]["allow_once_signature"] is None

    fresh_asked_at = datetime.now(UTC).isoformat()
    state_fresh = {
        "tool_safety": {
            "pending_signature": pending_signature,
            "asked_at": fresh_asked_at,
        },
        "messages": [HumanMessage(content="确认执行")],
    }
    update_fresh = middleware.before_agent(state_fresh, runtime=SimpleNamespace())
    assert update_fresh is not None
    assert update_fresh["tool_safety"]["allow_once_signature"] == pending_signature


def test_awrap_tool_call_matches_sync_behavior(monkeypatch) -> None:
    _patch_policy(monkeypatch)
    middleware = ToolSafetyGuardMiddleware()

    request = SimpleNamespace(
        state={"execution_mode": "host"},
        tool_call={
            "name": "bash",
            "args": {"command": "rm -rf ./tmp"},
            "id": "call-1",
        },
    )

    async def handler(_request):
        raise AssertionError("dangerous host call should be intercepted before execution")

    result = asyncio.run(middleware.awrap_tool_call(request, handler))

    assert result.goto == "__end__"
    assert result.update["tool_safety"]["pending_signature"]
    assert result.update["clarification"]["status"] == "awaiting_user"
    assert result.update["messages"][0].name == "tool_safety_guard"


def test_awrap_tool_call_delegates_non_host_calls(monkeypatch) -> None:
    _patch_policy(monkeypatch)
    middleware = ToolSafetyGuardMiddleware()

    request = SimpleNamespace(
        state={"execution_mode": "sandbox"},
        tool_call={"name": "bash", "args": {"command": "echo hello"}, "id": "call-2"},
    )

    async def handler(_request):
        return "ok"

    result = asyncio.run(middleware.awrap_tool_call(request, handler))

    assert result == "ok"
