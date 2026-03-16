from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, Response
from fastapi.testclient import TestClient

from src.gateway.routers import langgraph_proxy


def _make_client() -> TestClient:
    app = FastAPI()
    app.include_router(langgraph_proxy.router)
    return TestClient(app)


@pytest.mark.integration
def test_BE_GW_LGP_001_delete_thread_cancels_active_runs_before_proxying() -> None:
    cancel_mock = AsyncMock()
    proxy_mock = AsyncMock(return_value=Response(status_code=204))

    with (
        _make_client() as client,
        patch.object(langgraph_proxy, "cancel_active_thread_runs", cancel_mock),
        patch.object(langgraph_proxy, "_proxy_request", proxy_mock),
    ):
        response = client.delete("/api/langgraph/threads/thread-1")

    assert response.status_code == 204
    cancel_mock.assert_awaited_once_with("thread-1")
    proxy_mock.assert_awaited_once()


@pytest.mark.integration
def test_BE_GW_LGP_002_non_delete_requests_skip_run_cancellation() -> None:
    cancel_mock = AsyncMock()
    proxy_mock = AsyncMock(return_value=Response(status_code=200))

    with (
        _make_client() as client,
        patch.object(langgraph_proxy, "cancel_active_thread_runs", cancel_mock),
        patch.object(langgraph_proxy, "_proxy_request", proxy_mock),
    ):
        response = client.get("/api/langgraph/threads/thread-1")

    assert response.status_code == 200
    cancel_mock.assert_not_awaited()
    proxy_mock.assert_awaited_once()


class _FakeUpstreamResponse:
    def __init__(self) -> None:
        self.status_code = 200
        self.headers = {
            "content-type": "text/event-stream; charset=utf-8",
            "connection": "keep-alive",
            "x-upstream": "langgraph",
        }
        self._closed = False

    async def aiter_raw(self):
        for chunk in (
            b'event: message\ndata: {"delta":"hello"}\n\n',
            b'event: message\ndata: {"delta":" world"}\n\n',
        ):
            yield chunk

    async def aclose(self) -> None:
        self._closed = True


class _FakeAsyncClient:
    last_instance: _FakeAsyncClient | None = None

    def __init__(self, *, timeout):
        self.timeout = timeout
        self.response = _FakeUpstreamResponse()
        self.closed = False
        self.sent_headers: dict[str, str] = {}
        self.method = ""
        self.url = ""
        _FakeAsyncClient.last_instance = self

    def build_request(self, *, method, url, params, headers, content):
        _ = params
        _ = content
        self.method = method
        self.url = url
        self.sent_headers = dict(headers)
        return object()

    async def send(self, _request, *, stream):
        assert stream is True
        return self.response

    async def aclose(self) -> None:
        self.closed = True


@pytest.mark.integration
def test_BE_GW_LGP_003_stream_passthrough_forwards_headers_and_closes_upstream() -> None:
    with (
        _make_client() as client,
        patch.object(langgraph_proxy.httpx, "AsyncClient", _FakeAsyncClient),
        patch.object(
            langgraph_proxy,
            "build_langgraph_upstream_url",
            lambda path: f"http://langgraph.internal/{path}",
        ),
    ):
        response = client.get(
            "/api/langgraph/threads/thread-1/runs/stream",
            headers={
                "Authorization": "Bearer test-token",
                "Host": "frontend.local",
                "X-Correlation-Id": "cid-001",
            },
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "x-upstream" in response.headers
    assert b"hello" in response.content
    assert b"world" in response.content

    fake_client = _FakeAsyncClient.last_instance
    assert fake_client is not None
    assert fake_client.method == "GET"
    assert fake_client.url == "http://langgraph.internal/threads/thread-1/runs/stream"
    lowered_headers = {key.lower(): value for key, value in fake_client.sent_headers.items()}
    assert lowered_headers["authorization"] == "Bearer test-token"
    assert lowered_headers["x-correlation-id"] == "cid-001"
    assert "host" not in lowered_headers
    assert fake_client.response._closed is True
    assert fake_client.closed is True
