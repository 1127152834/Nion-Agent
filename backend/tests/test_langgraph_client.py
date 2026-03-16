from __future__ import annotations

import asyncio
from typing import Any

from app.gateway.langgraph_client import cancel_active_thread_runs


class _MockResponse:
    def __init__(self, status_code: int, payload: Any):
        self.status_code = status_code
        self._payload = payload

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> Any:
        return self._payload


class _MockAsyncClient:
    def __init__(self, *, get_response: _MockResponse, post_calls: list[dict[str, Any]], **kwargs):
        self._get_response = get_response
        self._post_calls = post_calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url: str, params: dict[str, Any] | None = None):
        return self._get_response

    async def post(self, url: str, params: dict[str, Any] | None = None):
        self._post_calls.append({"url": url, "params": params})
        return _MockResponse(200, {})


def test_cancel_active_thread_runs_interrupts_non_terminal_runs(monkeypatch):
    post_calls: list[dict[str, Any]] = []

    def _client_factory(*args, **kwargs):
        return _MockAsyncClient(
            get_response=_MockResponse(
                200,
                [
                    {"run_id": "run-pending", "status": "pending"},
                    {"run_id": "run-running", "status": "running"},
                    {"run_id": "run-success", "status": "success"},
                ],
            ),
            post_calls=post_calls,
            **kwargs,
        )

    monkeypatch.setattr("httpx.AsyncClient", _client_factory)

    asyncio.run(cancel_active_thread_runs("thread-1"))

    assert post_calls == [
        {
            "url": "http://localhost:2024/threads/thread-1/runs/run-pending/cancel",
            "params": {"wait": "true", "action": "interrupt"},
        },
        {
            "url": "http://localhost:2024/threads/thread-1/runs/run-running/cancel",
            "params": {"wait": "true", "action": "interrupt"},
        },
    ]
