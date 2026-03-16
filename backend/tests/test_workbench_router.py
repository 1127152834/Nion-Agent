import base64
import io
import json
import subprocess
import uuid
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.gateway.path_utils import resolve_thread_virtual_path
from app.gateway.routers.workbench import _helpers as workbench_helpers
from app.gateway.routers.workbench import marketplace as workbench_marketplace
from app.gateway.routers.workbench import plugin_studio as workbench_plugin_studio
from app.gateway.routers.workbench import plugins as workbench_plugins
from app.gateway.routers.workbench.models import PluginTestCommandStep, PluginTestRequest, PluginTestResponse, PluginTestStepResult
from nion.config.paths import Paths

PluginTestCommandStep.model_rebuild()
PluginTestRequest.model_rebuild()
PluginTestStepResult.model_rebuild()
PluginTestResponse.model_rebuild()


def _make_client() -> TestClient:
    app = FastAPI()
    app.include_router(workbench_plugins.router)
    app.include_router(workbench_marketplace.router)
    app.include_router(workbench_plugin_studio.router)
    return TestClient(app)


def test_plugin_test_step_handles_timeout_without_500(tmp_path: Path):
    with (
        _make_client() as client,
        patch.object(workbench_plugins, "_resolve_cwd", return_value=("/mnt/user-data/workspace", tmp_path)),
        patch.object(workbench_plugins, "resolve_thread_virtual_path", return_value=tmp_path),
        patch.object(
            workbench_plugins.subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired(
                cmd="sleep 10",
                timeout=1,
                output="partial output",
                stderr="timeout stderr",
            ),
        ),
    ):
        response = client.post(
            "/api/workbench/plugins/demo/test",
            json={
                "thread_id": "thread-1",
                "command_steps": [
                    {
                        "id": "step-timeout",
                        "command": "sleep 10",
                        "cwd": "/mnt/user-data/workspace",
                        "timeout_seconds": 1,
                    }
                ],
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["passed"] is False
    assert len(payload["steps"]) == 1
    assert payload["steps"][0]["id"] == "step-timeout"
    assert payload["steps"][0]["passed"] is False
    assert "timed out" in (payload["steps"][0]["message"] or "").lower()


def test_plugin_test_step_handles_invalid_cwd_as_failed_step():
    with (
        _make_client() as client,
        patch.object(
            workbench_plugins,
            "_resolve_cwd",
            side_effect=HTTPException(status_code=404, detail="Workbench cwd not found"),
        ),
    ):
        response = client.post(
            "/api/workbench/plugins/demo/test",
            json={
                "thread_id": "thread-1",
                "command_steps": [
                    {
                        "id": "step-cwd",
                        "command": "pwd",
                        "cwd": "/mnt/user-data/not-found",
                    }
                ],
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["passed"] is False
    assert len(payload["steps"]) == 1
    assert payload["steps"][0]["id"] == "step-cwd"
    assert payload["steps"][0]["passed"] is False
    assert payload["steps"][0]["message"] == "Workbench cwd not found"


def test_plugin_test_step_accepts_virtual_path_match(tmp_path: Path):
    with (
        _make_client() as client,
        patch.object(workbench_plugins, "_resolve_cwd", return_value=("/mnt/user-data/workspace", tmp_path)),
        patch.object(workbench_plugins, "resolve_thread_virtual_path", return_value=tmp_path),
        patch.object(
            workbench_plugins.subprocess,
            "run",
            return_value=subprocess.CompletedProcess(
                args=["/bin/zsh", "-lc", "pwd"],
                returncode=0,
                stdout=f"{tmp_path}\n",
                stderr="",
            ),
        ),
    ):
        response = client.post(
            "/api/workbench/plugins/demo/test",
            json={
                "thread_id": "thread-1",
                "command_steps": [
                    {
                        "id": "step-virtual",
                        "command": "pwd",
                        "cwd": "/mnt/user-data/workspace",
                        "expect_contains": ["/mnt/user-data/workspace"],
                    }
                ],
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["passed"] is True
    assert payload["steps"][0]["passed"] is True


def test_plugin_test_thread_endpoint_creates_sandbox_dirs(tmp_path: Path):
    ensure_thread_mock = AsyncMock(return_value=None)
    with (
        _make_client() as client,
        patch.object(workbench_plugins, "get_paths", return_value=Paths(tmp_path), create=True),
        patch.object(workbench_plugins, "_ensure_langgraph_thread_for_plugin_test", ensure_thread_mock),
    ):
        response = client.post("/api/workbench/plugins/test-thread")

    assert response.status_code == 200
    payload = response.json()
    thread_id = payload["thread_id"]
    assert str(uuid.UUID(thread_id)) == thread_id
    ensure_thread_mock.assert_awaited_once_with(thread_id, best_effort=True)
    assert (tmp_path / "threads" / thread_id / "user-data" / "workspace").is_dir()


def test_plugin_test_thread_endpoint_still_returns_thread_when_langgraph_create_fails(tmp_path: Path):
    async def _ensure_thread_stub(thread_id: str, *, best_effort: bool = False) -> None:
        if best_effort:
            return
        raise HTTPException(status_code=502, detail="upstream failed")

    with (
        _make_client() as client,
        patch.object(workbench_plugins, "get_paths", return_value=Paths(tmp_path), create=True),
        patch.object(
            workbench_plugins,
            "_ensure_langgraph_thread_for_plugin_test",
            AsyncMock(side_effect=_ensure_thread_stub),
        ),
    ):
        response = client.post("/api/workbench/plugins/test-thread")

    assert response.status_code == 200
    payload = response.json()
    thread_id = payload["thread_id"]
    assert str(uuid.UUID(thread_id)) == thread_id
    assert (tmp_path / "threads" / thread_id / "user-data" / "workspace").is_dir()


def test_marketplace_endpoints_list_detail_download(tmp_path: Path):
    repo_root = tmp_path / "repo"
    package_file = repo_root / "frontend" / "public" / "workbench-plugins" / "demo.nwp"
    readme_file = repo_root / "backend" / "data" / "workbench_marketplace" / "docs" / "demo" / "README.md"
    asset_dir = repo_root / "backend" / "data" / "workbench_marketplace" / "assets"
    demo_asset = asset_dir / "demo" / "preview.svg"
    catalog_file = repo_root / "backend" / "data" / "workbench_marketplace" / "catalog.json"

    package_file.parent.mkdir(parents=True, exist_ok=True)
    package_file.write_bytes(b"fake")
    readme_file.parent.mkdir(parents=True, exist_ok=True)
    readme_file.write_text("# Demo Plugin\n\nhello", encoding="utf-8")
    demo_asset.parent.mkdir(parents=True, exist_ok=True)
    demo_asset.write_text("<svg></svg>", encoding="utf-8")
    catalog_file.parent.mkdir(parents=True, exist_ok=True)
    catalog_file.write_text(
        """
{
  "plugins": [
    {
      "id": "demo-plugin",
      "name": "Demo Plugin",
      "description": "Demo",
      "version": "0.1.0",
      "package_path": "frontend/public/workbench-plugins/demo.nwp",
      "readme_path": "backend/data/workbench_marketplace/docs/demo/README.md",
      "demo_images": ["demo/preview.svg"]
    }
  ]
}
""".strip(),
        encoding="utf-8",
    )

    with (
        _make_client() as client,
        patch.object(workbench_marketplace, "_repo_root_dir", return_value=repo_root),
        patch.object(workbench_marketplace, "_marketplace_catalog_file", return_value=catalog_file),
        patch.object(workbench_marketplace, "_marketplace_assets_dir", return_value=asset_dir),
    ):
        list_resp = client.get("/api/workbench/marketplace/plugins")
        assert list_resp.status_code == 200
        plugins = list_resp.json()["plugins"]
        assert len(plugins) == 1
        assert plugins[0]["id"] == "demo-plugin"

        detail_resp = client.get("/api/workbench/marketplace/plugins/demo-plugin")
        assert detail_resp.status_code == 200
        detail = detail_resp.json()
        assert detail["id"] == "demo-plugin"
        assert "readme_markdown" in detail
        assert detail["demo_image_urls"]

        download_resp = client.get("/api/workbench/marketplace/plugins/demo-plugin/download")
        assert download_resp.status_code == 200
        assert download_resp.content == b"fake"


def test_plugin_studio_requires_auto_and_manual_before_package(tmp_path: Path):
    paths = Paths(tmp_path)
    with (
        _make_client() as client,
        patch.object(workbench_plugin_studio, "get_paths", return_value=paths, create=True),
        patch.object(workbench_helpers, "get_paths", return_value=paths, create=True),
        patch("app.gateway.path_utils.get_paths", return_value=paths),
        patch.object(workbench_helpers, "_ensure_langgraph_thread_for_plugin_test", AsyncMock(return_value=None)),
    ):
        chat_thread_id = "plugin-assistant-thread-001"
        create_resp = client.post(
            "/api/workbench/plugin-studio/sessions",
            json={
                "plugin_name": "Code Viewer",
                "description": "demo",
                "chat_thread_id": chat_thread_id,
            },
        )
        assert create_resp.status_code == 200
        create_payload = create_resp.json()
        session_id = create_payload["session_id"]
        assert create_payload["chat_thread_id"] == chat_thread_id
        assert create_payload["preview_thread_id"]

        generate_resp = client.post(f"/api/workbench/plugin-studio/sessions/{session_id}/generate", json={})
        assert generate_resp.status_code == 200

        package_without_auto = client.post(f"/api/workbench/plugin-studio/sessions/{session_id}/package")
        assert package_without_auto.status_code == 409

        auto_verify_resp = client.post(f"/api/workbench/plugin-studio/sessions/{session_id}/verify/auto")
        assert auto_verify_resp.status_code == 200
        auto_payload = auto_verify_resp.json()
        assert auto_payload["passed"] is True
        step_ids = {step["id"] for step in auto_payload["steps"]}
        assert "entry_exists" in step_ids
        assert "runtime_valid" in step_ids
        assert "version_valid" in step_ids
        assert "plugin_id_match" in step_ids
        assert "readme_exists" in step_ids

        package_without_manual = client.post(f"/api/workbench/plugin-studio/sessions/{session_id}/package")
        assert package_without_manual.status_code == 409

        manual_verify_resp = client.post(
            f"/api/workbench/plugin-studio/sessions/{session_id}/verify/manual",
            json={"passed": True, "note": "looks good"},
        )
        assert manual_verify_resp.status_code == 200
        assert manual_verify_resp.json()["manual_verified"] is True

        package_resp = client.post(f"/api/workbench/plugin-studio/sessions/{session_id}/package")
        assert package_resp.status_code == 200
        payload = package_resp.json()
        assert payload["package_download_url"].endswith("/package/download")

        download_resp = client.get(payload["package_download_url"])
        assert download_resp.status_code == 200
        assert download_resp.content


def test_plugin_studio_auto_verify_fails_when_entry_missing(tmp_path: Path):
    paths = Paths(tmp_path)
    with (
        _make_client() as client,
        patch.object(workbench_plugin_studio, "get_paths", return_value=paths, create=True),
        patch.object(workbench_helpers, "get_paths", return_value=paths, create=True),
        patch("app.gateway.path_utils.get_paths", return_value=paths),
    ):
        create_resp = client.post(
            "/api/workbench/plugin-studio/sessions",
            json={
                "plugin_name": "Contract Checker",
                "description": "demo",
            },
        )
        assert create_resp.status_code == 200
        session_id = create_resp.json()["session_id"]

        generate_resp = client.post(f"/api/workbench/plugin-studio/sessions/{session_id}/generate", json={})
        assert generate_resp.status_code == 200

        entry_file = tmp_path / "workbench-plugin-studio" / "sessions" / session_id / "plugin-src" / "index.html"
        assert entry_file.exists() is True
        entry_file.unlink()

        auto_verify_resp = client.post(f"/api/workbench/plugin-studio/sessions/{session_id}/verify/auto")
        assert auto_verify_resp.status_code == 200
        auto_payload = auto_verify_resp.json()
        assert auto_payload["passed"] is False
        entry_step = next(step for step in auto_payload["steps"] if step["id"] == "entry_exists")
        assert entry_step["passed"] is False


def test_plugin_studio_draft_updates_workflow_and_match_rules(tmp_path: Path):
    paths = Paths(tmp_path)
    with (
        _make_client() as client,
        patch.object(workbench_plugin_studio, "get_paths", return_value=paths, create=True),
        patch.object(workbench_helpers, "get_paths", return_value=paths, create=True),
        patch("app.gateway.path_utils.get_paths", return_value=paths),
    ):
        create_resp = client.post(
            "/api/workbench/plugin-studio/sessions",
            json={
                "plugin_name": "Workflow Draft",
                "description": "",
            },
        )
        assert create_resp.status_code == 200
        session_id = create_resp.json()["session_id"]

        patch_resp = client.patch(
            f"/api/workbench/plugin-studio/sessions/{session_id}/draft",
            json={
                "description": "插件草稿描述",
                "draft_version": "0.1.3",
                "match_rules": {
                    "allowAll": False,
                    "kind": "file",
                    "extensions": ["tsx"],
                },
                "workflow_state": {
                    "goal": "做一个调试插件",
                    "target_user": "前端工程师",
                    "plugin_scope": "代码编辑与预览",
                    "entry_points": ["右键打开"],
                    "core_actions": ["打开", "保存"],
                    "file_match_mode": "file",
                    "layout_template": "vscode",
                    "visual_style": "light",
                    "responsive_rules": "移动端可用",
                },
            },
        )
        assert patch_resp.status_code == 200
        payload = patch_resp.json()
        assert payload["description"] == "插件草稿描述"
        assert payload["draft_version"] == "0.1.3"
        assert payload["workflow_stage"] == "generate"
        assert payload["match_rules"]["extensions"] == ["tsx"]


def test_plugin_studio_draft_updates_chat_thread_id(tmp_path: Path):
    paths = Paths(tmp_path)
    with (
        _make_client() as client,
        patch.object(workbench_plugin_studio, "get_paths", return_value=paths, create=True),
        patch.object(workbench_helpers, "get_paths", return_value=paths, create=True),
        patch("app.gateway.path_utils.get_paths", return_value=paths),
    ):
        create_resp = client.post(
            "/api/workbench/plugin-studio/sessions",
            json={
                "plugin_name": "Workflow Draft",
                "description": "",
            },
        )
        assert create_resp.status_code == 200
        session_id = create_resp.json()["session_id"]

        patch_resp = client.patch(
            f"/api/workbench/plugin-studio/sessions/{session_id}/draft",
            json={
                "chat_thread_id": "plugin-assistant-chat-thread-002",
            },
        )
        assert patch_resp.status_code == 200
        payload = patch_resp.json()
        assert payload["chat_thread_id"] == "plugin-assistant-chat-thread-002"


def test_plugin_studio_test_material_import_and_delete(tmp_path: Path):
    paths = Paths(tmp_path)
    with (
        _make_client() as client,
        patch.object(workbench_plugin_studio, "get_paths", return_value=paths, create=True),
        patch.object(workbench_helpers, "get_paths", return_value=paths, create=True),
        patch("app.gateway.path_utils.get_paths", return_value=paths),
        patch.object(workbench_helpers, "_ensure_langgraph_thread_for_plugin_test", AsyncMock(return_value=None)),
    ):
        create_resp = client.post(
            "/api/workbench/plugin-studio/sessions",
            json={"plugin_name": "Material Plugin"},
        )
        assert create_resp.status_code == 200
        session_id = create_resp.json()["session_id"]

        encoded = base64.b64encode(b"console.log('demo')").decode("ascii")
        import_resp = client.post(
            f"/api/workbench/plugin-studio/sessions/{session_id}/test-materials/import",
            json={
                "entries": [
                    {
                        "path": "fixtures/demo.tsx",
                        "content_base64": encoded,
                        "source": "upload",
                    }
                ],
                "selected_path": "fixtures/demo.tsx",
            },
        )
        assert import_resp.status_code == 200
        imported = import_resp.json()
        assert imported["selected_test_material_path"]
        assert any(item["kind"] == "file" for item in imported["test_materials"])

        selected_path = imported["selected_test_material_path"]
        delete_resp = client.request(
            "DELETE",
            f"/api/workbench/plugin-studio/sessions/{session_id}/test-materials",
            json={
                "path": selected_path,
            },
        )
        assert delete_resp.status_code == 200
        deleted = delete_resp.json()
        assert deleted["test_materials"] == []
        assert deleted["selected_test_material_path"] is None


def test_plugin_studio_source_import_auto_restores_fixtures(tmp_path: Path):
    paths = Paths(tmp_path)
    with (
        _make_client() as client,
        patch.object(workbench_plugin_studio, "get_paths", return_value=paths, create=True),
        patch.object(workbench_helpers, "get_paths", return_value=paths, create=True),
        patch("app.gateway.path_utils.get_paths", return_value=paths),
        patch.object(workbench_helpers, "_ensure_langgraph_thread_for_plugin_test", AsyncMock(return_value=None)),
    ):
        create_resp = client.post(
            "/api/workbench/plugin-studio/sessions",
            json={"plugin_name": "Import Fixture Plugin"},
        )
        assert create_resp.status_code == 200
        session_id = create_resp.json()["session_id"]

        package_buffer = io.BytesIO()
        with zipfile.ZipFile(package_buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(
                "manifest.json",
                json.dumps(
                    {
                        "id": "import-fixture-plugin",
                        "name": "Import Fixture Plugin",
                        "version": "0.1.0",
                        "description": "fixture import test",
                        "entry": "index.html",
                        "runtime": "iframe",
                        "fixtures": ["fixtures/sample-project"],
                    },
                    ensure_ascii=False,
                ),
            )
            zf.writestr("index.html", "<!doctype html><html><body>ok</body></html>")
            zf.writestr("fixtures/sample-project/src/main.tsx", "console.log('fixture');")

        import_resp = client.post(
            f"/api/workbench/plugin-studio/sessions/{session_id}/source/import",
            json={
                "package_base64": base64.b64encode(package_buffer.getvalue()).decode("ascii"),
                "filename": "import-fixture-plugin.nwp",
                "linked_plugin_id": "import-fixture-plugin",
                "plugin_name": "Import Fixture Plugin",
                "description": "fixture import test",
            },
        )
        assert import_resp.status_code == 200
        imported = import_resp.json()
        assert imported["preview_thread_id"]
        assert imported["selected_test_material_path"] == "/mnt/user-data/workspace/fixtures/sample-project"
        material_paths = {item["path"] for item in imported["test_materials"]}
        assert "/mnt/user-data/workspace/fixtures/sample-project/src/main.tsx" in material_paths

        preview_thread_id = imported["preview_thread_id"]
        fixture_file = resolve_thread_virtual_path(
            preview_thread_id,
            "/mnt/user-data/workspace/fixtures/sample-project/src/main.tsx",
        )
        assert fixture_file.exists() is True


def test_plugin_studio_workspace_seed_copies_source_and_materials(tmp_path: Path):
    paths = Paths(tmp_path)
    with (
        _make_client() as client,
        patch.object(workbench_plugin_studio, "get_paths", return_value=paths, create=True),
        patch.object(workbench_helpers, "get_paths", return_value=paths, create=True),
        patch("app.gateway.path_utils.get_paths", return_value=paths),
        patch.object(workbench_helpers, "_ensure_langgraph_thread_for_plugin_test", AsyncMock(return_value=None)),
    ):
        create_resp = client.post(
            "/api/workbench/plugin-studio/sessions",
            json={"plugin_name": "Workspace Seed Plugin"},
        )
        assert create_resp.status_code == 200
        payload = create_resp.json()
        session_id = payload["session_id"]

        generate_resp = client.post(f"/api/workbench/plugin-studio/sessions/{session_id}/generate", json={})
        assert generate_resp.status_code == 200

        material_resp = client.post(
            f"/api/workbench/plugin-studio/sessions/{session_id}/test-materials/import",
            json={
                "thread_id": payload["preview_thread_id"],
                "entries": [
                    {
                        "path": "fixtures/sample-project/src/demo.tsx",
                        "content_base64": base64.b64encode(b"console.log('seed');").decode("ascii"),
                        "source": "upload",
                    }
                ],
                "selected_path": "fixtures/sample-project/src/demo.tsx",
            },
        )
        assert material_resp.status_code == 200

        seed_resp = client.post(
            f"/api/workbench/plugin-studio/sessions/{session_id}/workspace/seed",
            json={
                "thread_id": "chat-thread-seed-001",
                "include_test_materials": True,
            },
        )
        assert seed_resp.status_code == 200
        seeded = seed_resp.json()
        assert seeded["thread_id"] == "chat-thread-seed-001"
        assert seeded["source_root"] == "/mnt/user-data/workspace/plugin-src"
        assert seeded["test_materials_root"] == "/mnt/user-data/workspace/fixtures"

        seeded_manifest = resolve_thread_virtual_path(
            "chat-thread-seed-001",
            "/mnt/user-data/workspace/plugin-src/manifest.json",
        )
        assert seeded_manifest.exists() is True

        seeded_fixture = resolve_thread_virtual_path(
            "chat-thread-seed-001",
            "/mnt/user-data/workspace/fixtures/sample-project/src/demo.tsx",
        )
        assert seeded_fixture.exists() is True


def test_plugin_studio_workspace_pull_overwrites_session_source(tmp_path: Path):
    paths = Paths(tmp_path)
    with (
        _make_client() as client,
        patch.object(workbench_plugin_studio, "get_paths", return_value=paths, create=True),
        patch.object(workbench_helpers, "get_paths", return_value=paths, create=True),
        patch("app.gateway.path_utils.get_paths", return_value=paths),
    ):
        create_resp = client.post(
            "/api/workbench/plugin-studio/sessions",
            json={"plugin_name": "Workspace Pull Plugin"},
        )
        assert create_resp.status_code == 200
        session_id = create_resp.json()["session_id"]

        generate_resp = client.post(f"/api/workbench/plugin-studio/sessions/{session_id}/generate", json={})
        assert generate_resp.status_code == 200

        chat_thread_id = "chat-thread-pull-001"
        workspace_entry = resolve_thread_virtual_path(
            chat_thread_id,
            "/mnt/user-data/workspace/plugin-src/index.html",
        )
        workspace_entry.parent.mkdir(parents=True, exist_ok=True)
        workspace_entry.write_text("<!doctype html><html><body>updated from workspace</body></html>", encoding="utf-8")

        workspace_manifest = resolve_thread_virtual_path(
            chat_thread_id,
            "/mnt/user-data/workspace/plugin-src/manifest.json",
        )
        workspace_manifest.write_text(
            json.dumps(
                {
                    "id": "workspace-pull-plugin",
                    "name": "Workspace Pull Plugin",
                    "version": "0.1.0",
                    "entry": "index.html",
                    "runtime": "iframe",
                    "description": "updated",
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        pull_resp = client.post(
            f"/api/workbench/plugin-studio/sessions/{session_id}/workspace/pull",
            json={
                "thread_id": chat_thread_id,
            },
        )
        assert pull_resp.status_code == 200
        pulled = pull_resp.json()
        assert pulled["plugin_name"] == "Workspace Pull Plugin"
        assert pulled["description"] == "updated"

        session_entry = tmp_path / "workbench-plugin-studio" / "sessions" / session_id / "plugin-src" / "index.html"
        assert "updated from workspace" in session_entry.read_text(encoding="utf-8")


def test_plugin_studio_source_package_returns_session_files(tmp_path: Path):
    paths = Paths(tmp_path)
    with (
        _make_client() as client,
        patch.object(workbench_plugin_studio, "get_paths", return_value=paths, create=True),
        patch.object(workbench_helpers, "get_paths", return_value=paths, create=True),
        patch("app.gateway.path_utils.get_paths", return_value=paths),
    ):
        create_resp = client.post(
            "/api/workbench/plugin-studio/sessions",
            json={"plugin_name": "Draft Package Plugin"},
        )
        assert create_resp.status_code == 200
        session_id = create_resp.json()["session_id"]

        generate_resp = client.post(f"/api/workbench/plugin-studio/sessions/{session_id}/generate", json={})
        assert generate_resp.status_code == 200

        entry_file = tmp_path / "workbench-plugin-studio" / "sessions" / session_id / "plugin-src" / "index.html"
        entry_file.write_text("<!doctype html><html><body>draft package</body></html>", encoding="utf-8")

        source_resp = client.get(f"/api/workbench/plugin-studio/sessions/{session_id}/source/package")
        assert source_resp.status_code == 200
        payload = source_resp.json()
        assert payload["manifest"]["entry"] == "index.html"
        assert payload["files"]["index.html"]["encoding"] == "text"
        assert "draft package" in payload["files"]["index.html"]["content"]


def test_plugin_studio_publish_applies_match_rules_and_fixtures(tmp_path: Path):
    paths = Paths(tmp_path)
    with (
        _make_client() as client,
        patch.object(workbench_plugin_studio, "get_paths", return_value=paths, create=True),
        patch.object(workbench_helpers, "get_paths", return_value=paths, create=True),
        patch("app.gateway.path_utils.get_paths", return_value=paths),
    ):
        create_resp = client.post(
            "/api/workbench/plugin-studio/sessions",
            json={"plugin_name": "Publish Mapping"},
        )
        assert create_resp.status_code == 200
        session_id = create_resp.json()["session_id"]

        generate_resp = client.post(f"/api/workbench/plugin-studio/sessions/{session_id}/generate", json={})
        assert generate_resp.status_code == 200

        patch_resp = client.patch(
            f"/api/workbench/plugin-studio/sessions/{session_id}/draft",
            json={
                "match_rules": {
                    "allowAll": False,
                    "kind": "file",
                    "extensions": ["tsx"],
                },
                "workflow_state": {
                    "goal": "目标",
                    "target_user": "用户",
                    "plugin_scope": "范围",
                    "entry_points": ["入口"],
                    "core_actions": ["动作1", "动作2"],
                    "file_match_mode": "file",
                    "layout_template": "layout",
                    "visual_style": "style",
                    "responsive_rules": "rules",
                },
            },
        )
        assert patch_resp.status_code == 200

        encoded = base64.b64encode(b"<div>fixture</div>").decode("ascii")
        material_resp = client.post(
            f"/api/workbench/plugin-studio/sessions/{session_id}/test-materials/import",
            json={
                "thread_id": "plugin-publish-thread-001",
                "entries": [
                    {
                        "path": "fixtures/demo.tsx",
                        "content_base64": encoded,
                        "source": "upload",
                    }
                ],
                "selected_path": "fixtures/demo.tsx",
            },
        )
        assert material_resp.status_code == 200

        publish_resp = client.post(
            f"/api/workbench/plugin-studio/sessions/{session_id}/publish",
            json={
                "version": "0.1.1",
                "release_notes": "发布说明",
                "description": "发布描述",
                "conversation_snapshot": "",
                "auto_download": False,
            },
        )
        assert publish_resp.status_code == 200

        manifest_path = tmp_path / "workbench-plugin-studio" / "sessions" / session_id / "plugin-src" / "manifest.json"
        manifest_payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert manifest_payload["targets"][0]["kind"] == "file"
        assert manifest_payload["targets"][0]["extensions"] == ["tsx"]
        assert manifest_payload["fixtures"] == ["fixtures/demo.tsx"]
        fixture_file = tmp_path / "workbench-plugin-studio" / "sessions" / session_id / "plugin-src" / "fixtures" / "demo.tsx"
        assert fixture_file.exists() is True
