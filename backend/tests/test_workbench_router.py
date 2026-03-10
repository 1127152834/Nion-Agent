import subprocess
import sys
from importlib import util
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from src.config.paths import Paths

_WORKBENCH_PATH = Path(__file__).resolve().parents[1] / "src" / "gateway" / "routers" / "workbench.py"
_WORKBENCH_SPEC = util.spec_from_file_location("workbench_router", _WORKBENCH_PATH)
assert _WORKBENCH_SPEC and _WORKBENCH_SPEC.loader
# Avoid importing the full routers package (brings in langchain deps) in this isolated test.
workbench = util.module_from_spec(_WORKBENCH_SPEC)
sys.modules["workbench_router"] = workbench
_WORKBENCH_SPEC.loader.exec_module(workbench)
workbench.PluginTestCommandStep.model_rebuild()
workbench.PluginTestRequest.model_rebuild()
workbench.PluginTestStepResult.model_rebuild()
workbench.PluginTestResponse.model_rebuild()


def _make_client() -> TestClient:
    app = FastAPI()
    app.include_router(workbench.plugin_router)
    app.include_router(workbench.marketplace_router)
    app.include_router(workbench.plugin_studio_router)
    return TestClient(app)


def test_plugin_test_step_handles_timeout_without_500(tmp_path: Path):
    with (
        _make_client() as client,
        patch.object(workbench, "_resolve_cwd", return_value=("/mnt/user-data/workspace", tmp_path)),
        patch.object(workbench, "resolve_thread_virtual_path", return_value=tmp_path),
        patch.object(
            workbench.subprocess,
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
            workbench,
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
        patch.object(workbench, "_resolve_cwd", return_value=("/mnt/user-data/workspace", tmp_path)),
        patch.object(workbench, "resolve_thread_virtual_path", return_value=tmp_path),
        patch.object(
            workbench.subprocess,
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
    with (
        _make_client() as client,
        patch.object(workbench, "get_paths", return_value=Paths(tmp_path), create=True),
    ):
        response = client.post("/api/workbench/plugins/test-thread")

    assert response.status_code == 200
    payload = response.json()
    thread_id = payload["thread_id"]
    assert thread_id.startswith("workbench-test-")
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
        patch.object(workbench, "_repo_root_dir", return_value=repo_root),
        patch.object(workbench, "_marketplace_catalog_file", return_value=catalog_file),
        patch.object(workbench, "_marketplace_assets_dir", return_value=asset_dir),
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
    with (
        _make_client() as client,
        patch.object(workbench, "get_paths", return_value=Paths(tmp_path), create=True),
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

        generate_resp = client.post(f"/api/workbench/plugin-studio/sessions/{session_id}/generate", json={})
        assert generate_resp.status_code == 200

        package_without_auto = client.post(f"/api/workbench/plugin-studio/sessions/{session_id}/package")
        assert package_without_auto.status_code == 409

        auto_verify_resp = client.post(f"/api/workbench/plugin-studio/sessions/{session_id}/verify/auto")
        assert auto_verify_resp.status_code == 200
        assert auto_verify_resp.json()["passed"] is True

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
