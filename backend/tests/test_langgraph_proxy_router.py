from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, Response
from fastapi.testclient import TestClient

from src.gateway.routers import langgraph_proxy


def _make_client() -> TestClient:
    app = FastAPI()
    app.include_router(langgraph_proxy.router)
    return TestClient(app)


def test_delete_thread_cancels_active_runs_before_proxying() -> None:
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


def test_non_delete_requests_skip_run_cancellation() -> None:
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
