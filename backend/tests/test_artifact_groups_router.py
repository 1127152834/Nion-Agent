import io
import zipfile
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.gateway.routers import artifact_groups
from src.gateway.routers.artifact_groups import ArtifactGroup


def _make_client() -> TestClient:
    app = FastAPI()
    app.include_router(artifact_groups.router)
    return TestClient(app)


def test_list_artifact_groups_returns_groups():
    group = ArtifactGroup(
        id="g1",
        name="article",
        artifacts=["a.md", "b.png"],
        created_at=1,
        description=None,
        metadata=None,
    )

    with (
        _make_client() as client,
        patch.object(
            artifact_groups,
            "_load_thread_artifact_groups",
            AsyncMock(return_value=[group]),
        ),
    ):
        response = client.get("/api/threads/thread-1/artifact-groups")

    assert response.status_code == 200
    payload = response.json()
    assert payload["groups"][0]["id"] == "g1"
    assert payload["groups"][0]["name"] == "article"


def test_create_artifact_group_dedupes_artifacts():
    save_mock = AsyncMock(return_value=None)

    with (
        _make_client() as client,
        patch.object(
            artifact_groups,
            "_load_thread_artifact_groups",
            AsyncMock(return_value=[]),
        ),
        patch.object(artifact_groups, "_save_thread_artifact_groups", save_mock),
    ):
        response = client.post(
            "/api/threads/thread-1/artifact-groups",
            json={
                "name": "Article Group",
                "artifacts": ["a.md", "a.md", "b.png"],
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Article Group"
    assert payload["artifacts"] == ["a.md", "b.png"]
    assert save_mock.await_count == 1


def test_update_artifact_group_updates_fields():
    existing_group = ArtifactGroup(
        id="g1",
        name="old",
        artifacts=["a.md"],
        created_at=1000,
        description=None,
        metadata=None,
    )
    save_mock = AsyncMock(return_value=None)

    with (
        _make_client() as client,
        patch.object(
            artifact_groups,
            "_load_thread_artifact_groups",
            AsyncMock(return_value=[existing_group]),
        ),
        patch.object(artifact_groups, "_save_thread_artifact_groups", save_mock),
    ):
        response = client.put(
            "/api/threads/thread-1/artifact-groups/g1",
            json={
                "name": "new-name",
                "artifacts": ["b.md", "b.md", "c.png"],
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "g1"
    assert payload["name"] == "new-name"
    assert payload["artifacts"] == ["b.md", "c.png"]
    assert save_mock.await_count == 1


def test_delete_artifact_group_removes_group():
    existing_group = ArtifactGroup(
        id="g1",
        name="old",
        artifacts=["a.md"],
        created_at=1000,
        description=None,
        metadata=None,
    )
    save_mock = AsyncMock(return_value=None)

    with (
        _make_client() as client,
        patch.object(
            artifact_groups,
            "_load_thread_artifact_groups",
            AsyncMock(return_value=[existing_group]),
        ),
        patch.object(artifact_groups, "_save_thread_artifact_groups", save_mock),
    ):
        response = client.delete("/api/threads/thread-1/artifact-groups/g1")

    assert response.status_code == 200
    assert response.json() == {"success": True}
    assert save_mock.await_count == 1


def test_delete_artifact_group_not_found():
    with (
        _make_client() as client,
        patch.object(
            artifact_groups,
            "_load_thread_artifact_groups",
            AsyncMock(return_value=[]),
        ),
    ):
        response = client.delete("/api/threads/thread-1/artifact-groups/missing")

    assert response.status_code == 404


def test_replace_artifact_groups():
    save_mock = AsyncMock(return_value=None)

    with (
        _make_client() as client,
        patch.object(artifact_groups, "_save_thread_artifact_groups", save_mock),
    ):
        response = client.put(
            "/api/threads/thread-1/artifact-groups",
            json={
                "groups": [
                    {
                        "id": "g1",
                        "name": "article",
                        "artifacts": ["a.md", "a.md", "b.png"],
                        "created_at": 1000,
                    },
                    {
                        "id": "g2",
                        "name": "  ",
                        "artifacts": ["x.md"],
                        "created_at": 2000,
                    },
                ]
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["groups"]) == 1
    assert payload["groups"][0]["id"] == "g1"
    assert payload["groups"][0]["artifacts"] == ["a.md", "b.png"]
    assert save_mock.await_count == 1


def test_download_artifact_group_returns_zip(tmp_path):
    article_path = tmp_path / "article.md"
    article_path.write_text("# hello", encoding="utf-8")
    cover_path = tmp_path / "cover.png"
    cover_path.write_bytes(b"fake-png-bytes")

    group = ArtifactGroup(
        id="g1",
        name="AI Article",
        artifacts=[
            "/mnt/user-data/outputs/article.md",
            "mnt/user-data/outputs/cover.png",
        ],
        created_at=1000,
        description=None,
        metadata=None,
    )

    def _resolve_path(_thread_id: str, artifact_path: str):
        mapping = {
            "/mnt/user-data/outputs/article.md": article_path,
            "mnt/user-data/outputs/cover.png": cover_path,
        }
        return mapping[artifact_path]

    with (
        _make_client() as client,
        patch.object(
            artifact_groups,
            "_load_thread_artifact_groups",
            AsyncMock(return_value=[group]),
        ),
        patch.object(artifact_groups, "resolve_thread_virtual_path", side_effect=_resolve_path),
    ):
        response = client.get("/api/threads/thread-1/artifact-groups/g1/download")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "AI-Article.zip" in response.headers["content-disposition"]

    zip_data = io.BytesIO(response.content)
    with zipfile.ZipFile(zip_data, mode="r") as archive:
        assert sorted(archive.namelist()) == ["outputs/article.md", "outputs/cover.png"]
        assert archive.read("outputs/article.md") == b"# hello"
        assert archive.read("outputs/cover.png") == b"fake-png-bytes"


def test_download_artifact_group_not_found():
    with (
        _make_client() as client,
        patch.object(
            artifact_groups,
            "_load_thread_artifact_groups",
            AsyncMock(return_value=[]),
        ),
    ):
        response = client.get("/api/threads/thread-1/artifact-groups/missing/download")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


def test_download_artifact_group_without_downloadable_files(tmp_path):
    group = ArtifactGroup(
        id="g1",
        name="empty",
        artifacts=["mnt/user-data/outputs/missing.md"],
        created_at=1000,
        description=None,
        metadata=None,
    )

    missing_path = tmp_path / "missing.md"

    with (
        _make_client() as client,
        patch.object(
            artifact_groups,
            "_load_thread_artifact_groups",
            AsyncMock(return_value=[group]),
        ),
        patch.object(artifact_groups, "resolve_thread_virtual_path", return_value=missing_path),
    ):
        response = client.get("/api/threads/thread-1/artifact-groups/g1/download")

    assert response.status_code == 404
    assert response.json()["detail"] == "No downloadable artifacts found in this group"
