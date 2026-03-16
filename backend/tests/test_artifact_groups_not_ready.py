from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.gateway.langgraph_client import LangGraphThreadNotReadyError
from src.gateway.routers import artifact_groups


def _make_client() -> TestClient:
    app = FastAPI()
    app.include_router(artifact_groups.router)
    return TestClient(app)


def test_list_artifact_groups_returns_empty_when_thread_state_not_ready() -> None:
    with (
        _make_client() as client,
        patch.object(
            artifact_groups,
            "_load_thread_artifact_groups",
            AsyncMock(side_effect=LangGraphThreadNotReadyError("thread state not ready")),
        ),
    ):
        response = client.get("/api/threads/thread-1/artifact-groups")

    assert response.status_code == 200
    assert response.json() == {"groups": []}
