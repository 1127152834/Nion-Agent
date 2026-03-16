"""Workbench Plugin Studio endpoints."""

from __future__ import annotations

import base64
import io
import json
import shutil
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.gateway.path_utils import resolve_thread_virtual_path
from app.gateway.routers.workbench._helpers import (
    _PLUGIN_STUDIO_LOCK,
    _PLUGIN_STUDIO_WORKSPACE_SOURCE_ROOT,
    _PLUGIN_STUDIO_WORKSPACE_TEST_ROOT,
    _TEXT_FILE_EXTENSIONS,
    _build_targets_from_match_rules,
    _compute_workflow_stage,
    _default_workflow_state,
    _ensure_plugin_studio_preview_thread,
    _increment_patch,
    _is_semver_greater,
    _match_rules_from_manifest,
    _normalize_match_rules,
    _normalize_material_relative_path,
    _normalize_semver,
    _normalize_workflow_state,
    _parse_semver,
    _plugin_studio_session_dir,
    _plugin_studio_test_materials_virtual_root,
    _read_plugin_studio_session,
    _safe_plugin_id,
    _safe_relative_material_path,
    _save_plugin_studio_session,
    _to_non_empty_string,
    _utcnow_iso,
)
from app.gateway.routers.workbench.models import (
    PluginStudioAutoVerifyResponse,
    PluginStudioDraftRequest,
    PluginStudioGenerateRequest,
    PluginStudioImportSourceRequest,
    PluginStudioManualVerifyRequest,
    PluginStudioPackageResponse,
    PluginStudioPublishRequest,
    PluginStudioPublishResponse,
    PluginStudioSessionCreateRequest,
    PluginStudioSessionResponse,
    PluginStudioSourceFileResponse,
    PluginStudioSourcePackageResponse,
    PluginStudioStepReport,
    PluginStudioTestMaterialDeleteRequest,
    PluginStudioTestMaterialImportRequest,
    PluginStudioTestMaterialsResponse,
    PluginStudioWorkspaceSeedResponse,
    PluginStudioWorkspaceSyncRequest,
)
from nion.config.paths import get_paths

router = APIRouter(prefix="/api/workbench/plugin-studio", tags=["workbench"])


# ── Internal helpers ─────────────────────────────────────────────────────────


def _plugin_studio_scaffold_dir(session_id: str) -> Path:
    return _plugin_studio_session_dir(session_id) / "plugin-src"


def _plugin_studio_workspace_source_dir(thread_id: str) -> Path:
    return resolve_thread_virtual_path(thread_id, _PLUGIN_STUDIO_WORKSPACE_SOURCE_ROOT)


def _plugin_studio_package_dir(session_id: str) -> Path:
    directory = _plugin_studio_session_dir(session_id) / "dist"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _plugin_studio_session_file(session_id: str) -> Path:
    return _plugin_studio_session_dir(session_id) / "session.json"


def _reset_directory(path: Path) -> None:
    if path.exists():
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink()
    path.mkdir(parents=True, exist_ok=True)


def _copy_directory_contents(source_dir: Path, target_dir: Path) -> None:
    _reset_directory(target_dir)
    for source_file in sorted(source_dir.rglob("*")):
        if not source_file.is_file():
            continue
        relative = source_file.relative_to(source_dir)
        target_file = (target_dir / relative).resolve()
        try:
            target_file.relative_to(target_dir.resolve())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Unsafe target path during copy: {relative.as_posix()}") from exc
        target_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_file, target_file)


def _load_plugin_studio_manifest_from_source_dir(source_dir: Path) -> dict[str, Any]:
    manifest_file = source_dir / "manifest.json"
    if not manifest_file.exists() or not manifest_file.is_file():
        raise HTTPException(status_code=409, detail="Plugin source missing manifest.json")
    try:
        payload = json.loads(manifest_file.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=409, detail=f"manifest parse failed: {exc}") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=409, detail="manifest payload is invalid")
    return payload


def _sync_plugin_studio_session_metadata_from_source_dir(
    session_payload: dict[str, Any],
    *,
    source_dir: Path,
) -> None:
    manifest_payload = _load_plugin_studio_manifest_from_source_dir(source_dir)

    linked_plugin_id = _safe_plugin_id(str(session_payload.get("linked_plugin_id") or session_payload.get("plugin_id") or manifest_payload.get("id") or session_payload.get("plugin_name") or "plugin"))
    plugin_name = _to_non_empty_string(manifest_payload.get("name")) or _to_non_empty_string(session_payload.get("plugin_name")) or linked_plugin_id
    description = _to_non_empty_string(manifest_payload.get("description")) or _to_non_empty_string(session_payload.get("description"))
    version = _normalize_semver(
        _to_non_empty_string(manifest_payload.get("version")) or str(session_payload.get("current_version") or "0.1.0"),
    )
    match_rules = _match_rules_from_manifest(manifest_payload)

    manifest_payload["id"] = linked_plugin_id
    manifest_payload["name"] = plugin_name
    manifest_payload["version"] = version
    manifest_payload["description"] = description
    if not isinstance(manifest_payload.get("ui"), dict):
        manifest_payload["ui"] = {}
    manifest_payload["ui"]["surface"] = "sidebar-slot"
    raw_initial_width = manifest_payload["ui"].get("initialWidthPercent")
    if not isinstance(raw_initial_width, (int, float)) or raw_initial_width < 10 or raw_initial_width > 90:
        manifest_payload["ui"]["initialWidthPercent"] = 60

    (source_dir / "manifest.json").write_text(
        json.dumps(manifest_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    workflow_state = _normalize_workflow_state(session_payload.get("workflow_state"))
    if not workflow_state.get("goal"):
        workflow_state["goal"] = description
    if not workflow_state.get("plugin_scope"):
        workflow_state["plugin_scope"] = plugin_name
    if not workflow_state.get("entry_points"):
        targets = manifest_payload.get("targets")
        if isinstance(targets, list):
            workflow_state["entry_points"] = [_to_non_empty_string(item.get("kind")) for item in targets if isinstance(item, dict) and _to_non_empty_string(item.get("kind"))][:3]
    if not workflow_state.get("core_actions"):
        capabilities = manifest_payload.get("capabilities")
        if isinstance(capabilities, list):
            workflow_state["core_actions"] = [_to_non_empty_string(item) for item in capabilities if _to_non_empty_string(item)][:3]
    workflow_state["file_match_mode"] = "all_files" if match_rules.get("allowAll") else str(match_rules.get("kind") or "file")

    session_payload["plugin_id"] = linked_plugin_id
    session_payload["linked_plugin_id"] = linked_plugin_id
    session_payload["plugin_name"] = plugin_name
    session_payload["description"] = description
    session_payload["current_version"] = version
    session_payload["draft_version"] = _increment_patch(version)
    session_payload["match_rules"] = match_rules
    session_payload["workflow_state"] = workflow_state
    session_payload["workflow_stage"] = _compute_workflow_stage(workflow_state, "generated")
    session_payload["state"] = "generated"
    session_payload["auto_verified"] = False
    session_payload["manual_verified"] = False
    session_payload["package_rel_path"] = ""
    session_payload["source_mode"] = "imported" if str(session_payload.get("source_mode") or "") == "imported" else "scratch"


def _copy_plugin_studio_test_materials_to_thread_workspace(
    *,
    session_payload: dict[str, Any],
    thread_id: str,
) -> None:
    target_root = resolve_thread_virtual_path(thread_id, _PLUGIN_STUDIO_WORKSPACE_TEST_ROOT)
    _reset_directory(target_root)

    preview_thread_id = _to_non_empty_string(session_payload.get("preview_thread_id"))
    if not preview_thread_id:
        return

    raw_test_materials = session_payload.get("test_materials")
    if not isinstance(raw_test_materials, list):
        return

    for item in raw_test_materials:
        if not isinstance(item, dict) or _to_non_empty_string(item.get("kind")) != "file":
            continue
        relative = _fixture_relative_from_virtual(_to_non_empty_string(item.get("path")))
        if not relative:
            continue
        source_virtual_path = f"/mnt/user-data/workspace/{relative}"
        source_file = resolve_thread_virtual_path(preview_thread_id, source_virtual_path)
        if not source_file.exists() or not source_file.is_file():
            continue
        safe_relative = _normalize_material_relative_path(relative)
        if not safe_relative:
            continue
        target_file = (target_root / safe_relative).resolve()
        try:
            target_file.relative_to(target_root.resolve())
        except ValueError:
            continue
        target_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_file, target_file)


def _read_plugin_studio_source_package(
    session_id: str,
) -> PluginStudioSourcePackageResponse:
    source_dir = _plugin_studio_scaffold_dir(session_id)
    if not source_dir.exists() or not source_dir.is_dir():
        raise HTTPException(status_code=404, detail="Plugin source directory not found")

    manifest_payload = _load_plugin_studio_manifest_from_source_dir(source_dir)
    files: dict[str, PluginStudioSourceFileResponse] = {}
    for file_path in sorted(source_dir.rglob("*")):
        if not file_path.is_file():
            continue
        relative = file_path.relative_to(source_dir).as_posix()
        suffix = file_path.suffix.lower()
        if suffix in _TEXT_FILE_EXTENSIONS:
            try:
                files[relative] = PluginStudioSourceFileResponse(
                    encoding="text",
                    content=file_path.read_text(encoding="utf-8"),
                )
                continue
            except UnicodeDecodeError:
                pass
        files[relative] = PluginStudioSourceFileResponse(
            encoding="base64",
            content=base64.b64encode(file_path.read_bytes()).decode("ascii"),
        )
    return PluginStudioSourcePackageResponse(
        session_id=session_id,
        manifest=manifest_payload,
        files=files,
    )


def _plugin_studio_response(payload: dict[str, Any]) -> PluginStudioSessionResponse:
    session_id = str(payload.get("session_id", ""))
    plugin_id = str(payload.get("plugin_id", ""))
    readme_rel = str(payload.get("readme_rel_path") or "").strip()
    demo_rel_list = payload.get("demo_rel_paths")
    demo_rel_paths = demo_rel_list if isinstance(demo_rel_list, list) else []
    package_rel = str(payload.get("package_rel_path") or "").strip()
    readme_url = f"/api/workbench/plugin-studio/sessions/{session_id}/readme" if readme_rel else None
    demo_urls = [f"/api/workbench/plugin-studio/sessions/{session_id}/assets/{quote(str(rel).lstrip('/'))}" for rel in demo_rel_paths if str(rel).strip()]
    package_download_url = None
    if package_rel:
        package_download_url = f"/api/workbench/plugin-studio/sessions/{session_id}/package/download"
    source_mode = str(payload.get("source_mode") or "scratch")
    if source_mode not in {"scratch", "imported"}:
        source_mode = "scratch"
    workflow_stage = _to_non_empty_string(payload.get("workflow_stage"))
    if workflow_stage not in {"requirements", "interaction", "ui_design", "generate"}:
        workflow_stage = _compute_workflow_stage(
            _normalize_workflow_state(payload.get("workflow_state")),
            str(payload.get("state") or "draft"),
        )
    workflow_state = _normalize_workflow_state(payload.get("workflow_state"))
    draft_version = _normalize_semver(
        _to_non_empty_string(payload.get("draft_version")) or str(payload.get("current_version") or "0.1.0"),
        fallback=_normalize_semver(str(payload.get("current_version") or "0.1.0")),
    )
    match_rules = _normalize_match_rules(payload.get("match_rules"))
    raw_test_materials = payload.get("test_materials")
    test_materials = []
    if isinstance(raw_test_materials, list):
        for item in raw_test_materials:
            if not isinstance(item, dict):
                continue
            path = _to_non_empty_string(item.get("path"))
            kind = _to_non_empty_string(item.get("kind")) or "file"
            source = _to_non_empty_string(item.get("source")) or "upload"
            if not path:
                continue
            test_materials.append(
                {
                    "path": path,
                    "kind": kind if kind in {"file", "directory"} else "file",
                    "source": source if source in {"upload", "zip"} else "upload",
                }
            )

    return PluginStudioSessionResponse(
        session_id=session_id,
        plugin_id=plugin_id,
        plugin_name=str(payload.get("plugin_name", plugin_id)),
        chat_thread_id=str(payload.get("chat_thread_id") or "") or None,
        preview_thread_id=_to_non_empty_string(payload.get("preview_thread_id")) or None,
        description=str(payload.get("description", "")),
        state=str(payload.get("state", "draft")),  # type: ignore[arg-type]
        auto_verified=bool(payload.get("auto_verified", False)),
        manual_verified=bool(payload.get("manual_verified", False)),
        current_version=_normalize_semver(str(payload.get("current_version") or "0.1.0")),
        release_notes=str(payload.get("release_notes") or "") or None,
        source_mode=source_mode,  # type: ignore[arg-type]
        linked_plugin_id=str(payload.get("linked_plugin_id") or "") or None,
        published_at=str(payload.get("published_at") or "") or None,
        created_at=str(payload.get("created_at", _utcnow_iso())),
        updated_at=str(payload.get("updated_at", _utcnow_iso())),
        readme_url=readme_url,
        demo_image_urls=demo_urls,
        package_download_url=package_download_url,
        workflow_stage=workflow_stage,  # type: ignore[arg-type]
        workflow_state=workflow_state,
        draft_version=draft_version,
        match_rules=match_rules,
        test_materials=test_materials,
        selected_test_material_path=_to_non_empty_string(payload.get("selected_test_material_path")) or None,
    )


def _render_plugin_studio_scaffold(session_payload: dict[str, Any]) -> None:
    session_id = str(session_payload["session_id"])
    plugin_id = str(session_payload["plugin_id"])
    plugin_name = str(session_payload["plugin_name"])
    description = str(session_payload.get("description") or "")
    scaffold_dir = _plugin_studio_scaffold_dir(session_id)
    assets_dir = scaffold_dir / "assets"
    docs_demo_dir = scaffold_dir / "docs" / "demo"
    assets_dir.mkdir(parents=True, exist_ok=True)
    docs_demo_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        "id": plugin_id,
        "name": plugin_name,
        "version": _normalize_semver(str(session_payload.get("current_version") or "0.1.0")),
        "description": description or f"{plugin_name} generated by Plugin Assistant.",
        "entry": "index.html",
        "runtime": "iframe",
        "targets": [{"kind": "file", "priority": 85}],
        "capabilities": ["file.read", "file.write", "dir.list", "toast", "state.persist"],
        "docs": {
            "readme_path": "README.md",
            "demo_images": ["docs/demo/overview.svg"],
        },
        "verification": {"level": "auto_manual"},
        "provenance": {"source": "assistant"},
        "ui": {"surface": "sidebar-slot", "initialWidthPercent": 60},
    }

    (scaffold_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (scaffold_dir / "index.html").write_text(
        """<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Plugin Assistant Scaffold</title>
    <link rel="stylesheet" href="./assets/main.css" />
  </head>
  <body>
    <main class="app">
      <h1 id="title">Plugin Assistant</h1>
      <p id="desc">Generated plugin scaffold is ready.</p>
      <button id="toastBtn" type="button">测试提示</button>
    </main>
    <script src="./assets/main.js"></script>
  </body>
</html>
""",
        encoding="utf-8",
    )
    (assets_dir / "main.css").write_text(
        """:root {
  color-scheme: light dark;
  /* nion-scaffold:theme-ready */
  --wb-bg: #ffffff;
  --wb-text: #1f2937;
  --wb-border: #d1d5db;
  --wb-muted: #6b7280;
  --wb-primary: #2563eb;
}
html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  background: var(--wb-bg);
  color: var(--wb-text);
  font-family: "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif;
}
.app {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  box-sizing: border-box;
}
#title {
  margin: 0;
}
#desc {
  margin: 0;
  color: var(--wb-muted);
}
#toastBtn {
  width: fit-content;
  border: 1px solid var(--wb-border);
  border-radius: 10px;
  padding: 8px 12px;
  background: var(--wb-bg);
  color: var(--wb-text);
  cursor: pointer;
}
#toastBtn:hover {
  border-color: var(--wb-primary);
}
/* nion-scaffold:responsive-ready */
@media (max-width: 640px) {
  .app {
    min-height: 100%;
    padding: 12px;
    gap: 10px;
  }
  #toastBtn {
    width: 100%;
  }
}
""",
        encoding="utf-8",
    )
    (assets_dir / "main.js").write_text(
        f"""(function() {{
  const bridge = window.NionWorkbench;
  const title = document.getElementById("title");
  const desc = document.getElementById("desc");
  const btn = document.getElementById("toastBtn");
  const theme = bridge && typeof bridge === "object" ? bridge.theme : null;

  if (theme && typeof theme === "object") {{
    const mode = theme.mode === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    const tokens = theme.tokens && typeof theme.tokens === "object" ? theme.tokens : {{}};
    const tokenMap = {{
      "--wb-bg": tokens.background,
      "--wb-text": tokens.foreground,
      "--wb-border": tokens.border,
      "--wb-muted": tokens["muted-foreground"],
      "--wb-primary": tokens.primary,
    }};
    Object.entries(tokenMap).forEach(([key, value]) => {{
      if (typeof value === "string" && value.trim()) {{
        document.documentElement.style.setProperty(key, value.trim());
      }}
    }});
  }}

  if (title) title.textContent = {plugin_name!r};
  if (desc) desc.textContent = {description!r} || "Generated scaffold is responsive and theme-aware by default.";
  if (btn) {{
    btn.addEventListener("click", function() {{
      if (bridge && typeof bridge.call === "function") {{
        bridge.call("toast", {{ message: "插件脚手架运行正常", type: "success" }});
      }}
    }});
  }}
}})();
""",
        encoding="utf-8",
    )
    (scaffold_dir / "README.md").write_text(
        f"""# {plugin_name}

{description or "该插件由插件生成助手自动创建，可在右侧插件插槽中运行。"}

## 使用说明

1. 在插件市场或本地安装 `.nwp` 包。
2. 在聊天页右侧切换到"操作台"模式。
3. 选择该插件并开始调试。

## 发布前硬性检查项

- 必须支持响应式自适应：在窄宽度容器下仍可用。
- 必须跟随系统主题：light/dark 均保持可读与层级一致。
- 禁止依赖固定绝对宽高；优先流式布局与断点策略。

## 验证门禁

- 自动验证：检查 manifest/入口/文档/演示图是否完整。
- 人工确认：手动体验通过后才能打包下载。

## 演示图

![插件演示](docs/demo/overview.svg)
""",
        encoding="utf-8",
    )
    (docs_demo_dir / "overview.svg").write_text(
        f"""<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f6f8ff"/>
      <stop offset="100%" stop-color="#e9eefc"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="720" fill="url(#bg)"/>
  <rect x="80" y="80" width="1040" height="560" rx="20" fill="#ffffff" stroke="#dbe4ff" stroke-width="2"/>
  <text x="130" y="170" font-size="40" fill="#1f2a44" font-family="Arial, sans-serif">{plugin_name}</text>
  <text x="130" y="220" font-size="26" fill="#526085" font-family="Arial, sans-serif">{description or "插件生成助手演示图"}</text>
  <rect x="130" y="280" width="260" height="48" rx="10" fill="#3156d3"/>
  <text x="170" y="312" font-size="22" fill="#ffffff" font-family="Arial, sans-serif">Sidebar Slot Ready</text>
</svg>
""",
        encoding="utf-8",
    )

    session_payload["readme_rel_path"] = "README.md"
    session_payload["demo_rel_paths"] = ["docs/demo/overview.svg"]


def _plugin_studio_step(step_id: str, passed: bool, message: str) -> dict[str, Any]:
    return {"id": step_id, "passed": passed, "message": message}


def _refresh_plugin_studio_artifact_refs(session_payload: dict[str, Any]) -> None:
    session_id = str(session_payload["session_id"])
    source_dir = _plugin_studio_scaffold_dir(session_id)
    readme_file = source_dir / "README.md"
    session_payload["readme_rel_path"] = "README.md" if readme_file.exists() else ""
    demo_paths = sorted(file_path.relative_to(source_dir).as_posix() for file_path in source_dir.glob("docs/demo/*") if file_path.is_file())
    session_payload["demo_rel_paths"] = demo_paths


def _run_plugin_studio_auto_verify(session_payload: dict[str, Any]) -> tuple[bool, list[dict[str, Any]]]:
    session_id = str(session_payload["session_id"])
    source_dir = _plugin_studio_scaffold_dir(session_id)
    manifest_file = source_dir / "manifest.json"
    steps: list[dict[str, Any]] = [
        _plugin_studio_step("source_exists", source_dir.exists() and source_dir.is_dir(), "plugin source directory exists"),
        _plugin_studio_step("manifest_exists", manifest_file.exists(), "manifest.json exists"),
    ]
    if not manifest_file.exists():
        return False, steps

    manifest_payload: dict[str, Any] = {}
    try:
        loaded_payload = json.loads(manifest_file.read_text(encoding="utf-8"))
        manifest_payload = loaded_payload if isinstance(loaded_payload, dict) else {}
    except Exception as exc:
        steps.append(_plugin_studio_step("manifest_parse", False, f"manifest parse failed: {exc}"))
        return False, steps

    entry_name = str(manifest_payload.get("entry") or "").strip()
    runtime = str(manifest_payload.get("runtime") or "").strip()
    manifest_version = str(manifest_payload.get("version") or "").strip()
    entry_file = source_dir / entry_name if entry_name else source_dir / "index.html"
    steps.append(_plugin_studio_step("entry_declared", bool(entry_name), "manifest.entry declared"))
    steps.append(_plugin_studio_step("entry_exists", entry_file.exists(), f"entry file exists: {entry_name or 'index.html'}"))
    steps.append(_plugin_studio_step("runtime_valid", runtime == "iframe", "manifest.runtime is iframe"))
    steps.append(_plugin_studio_step("version_valid", _parse_semver(manifest_version) is not None, "manifest.version is semver"))
    steps.append(
        _plugin_studio_step(
            "plugin_id_match",
            str(manifest_payload.get("id") or "").strip() == str(session_payload.get("plugin_id") or "").strip(),
            "manifest.id matches session plugin id",
        ),
    )

    docs_payload = manifest_payload.get("docs") if isinstance(manifest_payload.get("docs"), dict) else {}
    readme_file = source_dir / str(docs_payload.get("readme_path") or "README.md")
    steps.append(_plugin_studio_step("readme_exists", readme_file.exists(), "README file exists"))

    demo_images = []
    docs_config = docs_payload
    if isinstance(docs_config, dict) and isinstance(docs_config.get("demo_images"), list):
        demo_images = [str(item).strip() for item in docs_config.get("demo_images", []) if str(item).strip()]
    if demo_images:
        all_demo_exists = True
        for demo_path in demo_images:
            demo_file = source_dir / demo_path
            exists = demo_file.exists() and demo_file.is_file()
            all_demo_exists = all_demo_exists and exists
            steps.append(_plugin_studio_step(f"demo:{demo_path}", exists, f"demo image exists: {demo_path}"))
        steps.append(_plugin_studio_step("demo_images_valid", all_demo_exists, "manifest demo images exist"))
    else:
        steps.append(_plugin_studio_step("demo_images_optional", True, "no demo image declared"))

    passed = all(bool(item["passed"]) for item in steps)
    return passed, steps


def _build_plugin_studio_package(session_payload: dict[str, Any]) -> Path:
    session_id = str(session_payload["session_id"])
    plugin_id = str(session_payload["plugin_id"])
    source_dir = _plugin_studio_scaffold_dir(session_id)
    if not source_dir.exists() or not source_dir.is_dir():
        raise HTTPException(status_code=409, detail="Plugin source is missing, run generate first")

    package_dir = _plugin_studio_package_dir(session_id)
    package_path = package_dir / f"{plugin_id}.nwp"
    with zipfile.ZipFile(package_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for file_path in source_dir.rglob("*"):
            if not file_path.is_file():
                continue
            arcname = file_path.relative_to(source_dir).as_posix()
            zf.write(file_path, arcname=arcname)
    return package_path


def _safe_zip_member_path(name: str) -> str | None:
    normalized = name.replace("\\", "/").strip()
    if not normalized or normalized.endswith("/"):
        return None
    normalized = normalized.lstrip("/")
    if not normalized:
        return None
    parts = [part for part in normalized.split("/") if part and part != "."]
    if not parts:
        return None
    if any(part == ".." for part in parts):
        raise HTTPException(status_code=400, detail=f"Unsafe path in package: {name}")
    return "/".join(parts)


def _collect_test_material_records(
    *,
    root_dir: Path,
    root_virtual_path: str,
    source_map: dict[str, str],
) -> list[dict[str, str]]:
    file_entries: list[dict[str, str]] = []
    directory_sources: dict[str, set[str]] = {}

    for file_path in sorted(root_dir.rglob("*")):
        if not file_path.is_file():
            continue
        relative = file_path.relative_to(root_dir).as_posix()
        virtual_path = f"{root_virtual_path}/{relative}"
        source = source_map.get(relative, "upload")
        file_entries.append(
            {
                "path": virtual_path,
                "kind": "file",
                "source": source if source in {"upload", "zip"} else "upload",
            }
        )
        parts = relative.split("/")
        if len(parts) > 1:
            for idx in range(1, len(parts)):
                dir_key = "/".join(parts[:idx])
                source_set = directory_sources.setdefault(dir_key, set())
                source_set.add(source)

    directory_entries: list[dict[str, str]] = []
    for relative_dir in sorted(directory_sources.keys()):
        source_set = directory_sources[relative_dir]
        source = "zip" if "zip" in source_set else "upload"
        directory_entries.append(
            {
                "path": f"{root_virtual_path}/{relative_dir}",
                "kind": "directory",
                "source": source,
            }
        )

    return [*directory_entries, *file_entries]


def _import_plugin_studio_test_materials(
    *,
    session_payload: dict[str, Any],
    payload: PluginStudioTestMaterialImportRequest,
    thread_id: str | None = None,
) -> None:
    session_id = str(session_payload["session_id"])
    root_virtual = _plugin_studio_test_materials_virtual_root(session_id)
    resolved_thread_id = (
        _to_non_empty_string(thread_id)
        or _to_non_empty_string(payload.thread_id)
        or _to_non_empty_string(
            session_payload.get("preview_thread_id"),
        )
    )
    if not resolved_thread_id:
        raise HTTPException(
            status_code=422,
            detail={"stage": "test_materials", "message": "Missing preview thread id"},
        )
    root_dir = resolve_thread_virtual_path(resolved_thread_id.strip(), root_virtual)
    root_dir.mkdir(parents=True, exist_ok=True)

    existing_source_map: dict[str, str] = {}
    existing_materials = session_payload.get("test_materials")
    if isinstance(existing_materials, list):
        for item in existing_materials:
            if not isinstance(item, dict):
                continue
            if item.get("kind") != "file":
                continue
            path = _to_non_empty_string(item.get("path"))
            source = _to_non_empty_string(item.get("source")) or "upload"
            prefix = f"{root_virtual}/"
            if path.startswith(prefix):
                relative = path[len(prefix) :]
                if relative:
                    existing_source_map[relative] = source

    for entry in payload.entries:
        relative_path = _normalize_material_relative_path(entry.path)
        if not relative_path:
            continue
        target = (root_dir / relative_path).resolve()
        try:
            target.relative_to(root_dir.resolve())
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail={"stage": "test_materials", "message": f"Unsafe target path: {entry.path}"},
            ) from exc
        try:
            decoded = base64.b64decode(entry.content_base64, validate=True)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=422,
                detail={"stage": "test_materials", "message": f"Invalid base64 content for {entry.path}"},
            ) from exc
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(decoded)
        existing_source_map[relative_path] = entry.source

    records = _collect_test_material_records(
        root_dir=root_dir,
        root_virtual_path=root_virtual,
        source_map=existing_source_map,
    )
    session_payload["test_materials"] = records

    selected_relative = _to_non_empty_string(payload.selected_path)
    if selected_relative:
        safe_selected = _normalize_material_relative_path(selected_relative)
        if not safe_selected:
            session_payload["selected_test_material_path"] = ""
            return
        session_payload["selected_test_material_path"] = f"{root_virtual}/{safe_selected}"
    elif not _to_non_empty_string(session_payload.get("selected_test_material_path")):
        first_file = next((item for item in records if item.get("kind") == "file"), None)
        session_payload["selected_test_material_path"] = first_file.get("path") if first_file else ""


def _delete_plugin_studio_test_material(
    *,
    session_payload: dict[str, Any],
    payload: PluginStudioTestMaterialDeleteRequest,
    thread_id: str | None = None,
) -> None:
    session_id = str(session_payload["session_id"])
    root_virtual = _plugin_studio_test_materials_virtual_root(session_id)
    resolved_thread_id = (
        _to_non_empty_string(thread_id)
        or _to_non_empty_string(payload.thread_id)
        or _to_non_empty_string(
            session_payload.get("preview_thread_id"),
        )
    )
    if not resolved_thread_id:
        raise HTTPException(
            status_code=422,
            detail={"stage": "test_materials", "message": "Missing preview thread id"},
        )
    root_dir = resolve_thread_virtual_path(resolved_thread_id.strip(), root_virtual)
    root_dir.mkdir(parents=True, exist_ok=True)

    target_path = _to_non_empty_string(payload.path)
    prefix = f"{root_virtual}/"
    if target_path.startswith(prefix):
        relative = target_path[len(prefix) :]
    else:
        relative = _safe_relative_material_path(target_path)
    relative = _safe_relative_material_path(relative)
    candidate = (root_dir / relative).resolve()
    try:
        candidate.relative_to(root_dir.resolve())
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"stage": "test_materials", "message": f"Unsafe material path: {payload.path}"},
        ) from exc
    if candidate.is_file():
        candidate.unlink()
    elif candidate.is_dir():
        shutil.rmtree(candidate, ignore_errors=True)
    else:
        raise HTTPException(
            status_code=404,
            detail={"stage": "test_materials", "message": "Test material not found"},
        )

    source_map: dict[str, str] = {}
    raw_test_materials = session_payload.get("test_materials")
    if isinstance(raw_test_materials, list):
        for item in raw_test_materials:
            if not isinstance(item, dict):
                continue
            if item.get("kind") != "file":
                continue
            file_path = _to_non_empty_string(item.get("path"))
            source = _to_non_empty_string(item.get("source")) or "upload"
            if file_path.startswith(prefix):
                rel = file_path[len(prefix) :]
                if rel and rel != relative:
                    source_map[rel] = source

    records = _collect_test_material_records(
        root_dir=root_dir,
        root_virtual_path=root_virtual,
        source_map=source_map,
    )
    session_payload["test_materials"] = records
    selected_path = _to_non_empty_string(session_payload.get("selected_test_material_path"))
    if not selected_path or selected_path == f"{root_virtual}/{relative}" or not any(item.get("path") == selected_path for item in records):
        first_file = next((item for item in records if item.get("kind") == "file"), None)
        session_payload["selected_test_material_path"] = first_file.get("path") if first_file else ""


def _collect_fixture_entries_from_scaffold(
    *,
    source_dir: Path,
    fixture_specs: list[str],
) -> tuple[list[dict[str, Any]], str | None]:
    entries: list[dict[str, Any]] = []
    seen_paths: set[str] = set()
    selected_path: str | None = None

    for raw_fixture in fixture_specs:
        try:
            safe_fixture = _safe_relative_material_path(raw_fixture)
        except HTTPException:
            continue
        candidate = (source_dir / safe_fixture).resolve()
        try:
            candidate.relative_to(source_dir.resolve())
        except ValueError:
            continue
        if not candidate.exists():
            continue

        if candidate.is_file():
            if safe_fixture not in seen_paths:
                entries.append(
                    {
                        "path": safe_fixture,
                        "source": "zip",
                        "content": candidate.read_bytes(),
                    }
                )
                seen_paths.add(safe_fixture)
            if selected_path is None:
                selected_path = safe_fixture
            continue

        if not candidate.is_dir():
            continue

        relative_files: list[str] = []
        for nested_file in sorted(candidate.rglob("*")):
            if not nested_file.is_file():
                continue
            nested_relative = f"{safe_fixture}/{nested_file.relative_to(candidate).as_posix()}"
            if nested_relative in seen_paths:
                continue
            entries.append(
                {
                    "path": nested_relative,
                    "source": "zip",
                    "content": nested_file.read_bytes(),
                }
            )
            seen_paths.add(nested_relative)
            relative_files.append(nested_relative)
        if selected_path is None and relative_files:
            selected_path = safe_fixture

    return entries, selected_path


def _fixture_relative_from_virtual(path_value: str) -> str | None:
    normalized = _to_non_empty_string(path_value)
    if not normalized:
        return None
    prefix = "/mnt/user-data/workspace/"
    if normalized.startswith(prefix):
        relative = normalized[len(prefix) :]
    elif normalized.startswith("/mnt/user-data/workspace"):
        relative = normalized.replace("/mnt/user-data/workspace", "", 1).lstrip("/")
    else:
        relative = normalized.lstrip("/")
    if not relative:
        return None
    try:
        safe_relative = _safe_relative_material_path(relative)
    except HTTPException:
        return None
    if not safe_relative.startswith("fixtures/"):
        return None
    return safe_relative


def _sync_session_fixtures_into_scaffold(session_payload: dict[str, Any], source_dir: Path) -> list[str]:
    preview_thread_id = _to_non_empty_string(session_payload.get("preview_thread_id"))
    if not preview_thread_id:
        return []

    material_files: list[str] = []
    raw_materials = session_payload.get("test_materials")
    if isinstance(raw_materials, list):
        for item in raw_materials:
            if not isinstance(item, dict):
                continue
            if _to_non_empty_string(item.get("kind")) != "file":
                continue
            relative = _fixture_relative_from_virtual(_to_non_empty_string(item.get("path")))
            if relative:
                material_files.append(relative)

    if not material_files:
        return []

    deduped_files: list[str] = []
    seen_files: set[str] = set()
    for relative in material_files:
        if relative in seen_files:
            continue
        seen_files.add(relative)
        deduped_files.append(relative)

    packaged_files: list[str] = []
    for relative in deduped_files:
        source_virtual_path = f"/mnt/user-data/workspace/{relative}"
        source_file = resolve_thread_virtual_path(preview_thread_id, source_virtual_path)
        if not source_file.exists() or not source_file.is_file():
            continue
        target_file = (source_dir / relative).resolve()
        try:
            target_file.relative_to(source_dir.resolve())
        except ValueError:
            continue
        target_file.parent.mkdir(parents=True, exist_ok=True)
        target_file.write_bytes(source_file.read_bytes())
        packaged_files.append(relative)

    selected_path = _fixture_relative_from_virtual(_to_non_empty_string(session_payload.get("selected_test_material_path")))
    ordered: list[str] = []
    if selected_path:
        ordered.append(selected_path)
    for relative in packaged_files:
        if relative not in ordered:
            ordered.append(relative)
    return ordered


def _import_plugin_studio_source(
    session_payload: dict[str, Any],
    payload: PluginStudioImportSourceRequest,
    *,
    preview_thread_id: str,
) -> None:
    session_id = str(session_payload["session_id"])
    source_dir = _plugin_studio_scaffold_dir(session_id)
    if source_dir.exists():
        shutil.rmtree(source_dir, ignore_errors=True)
    source_dir.mkdir(parents=True, exist_ok=True)

    try:
        package_bytes = base64.b64decode(payload.package_base64, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid package_base64: {exc}") from exc

    extracted_files = 0
    try:
        with zipfile.ZipFile(io.BytesIO(package_bytes)) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                relative = _safe_zip_member_path(info.filename)
                if not relative:
                    continue
                target = (source_dir / relative).resolve()
                try:
                    target.relative_to(source_dir)
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail=f"Unsafe package path: {info.filename}") from exc
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info, "r") as file_handle:
                    target.write_bytes(file_handle.read())
                extracted_files += 1
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail=f"Invalid plugin package format: {exc}") from exc

    if extracted_files == 0:
        raise HTTPException(status_code=400, detail="Imported package is empty")

    manifest_file = source_dir / "manifest.json"
    if not manifest_file.exists():
        raise HTTPException(status_code=400, detail="Imported package missing manifest.json")

    try:
        manifest_payload = json.loads(manifest_file.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Imported manifest is invalid: {exc}") from exc
    if not isinstance(manifest_payload, dict):
        raise HTTPException(status_code=400, detail="Imported manifest payload is invalid")

    linked_plugin_id = _safe_plugin_id(payload.linked_plugin_id or str(session_payload.get("plugin_id") or manifest_payload.get("id") or session_payload.get("plugin_name") or "plugin"))
    plugin_name = (payload.plugin_name or str(manifest_payload.get("name") or session_payload.get("plugin_name") or linked_plugin_id)).strip()
    description = (payload.description if payload.description is not None else str(manifest_payload.get("description") or session_payload.get("description") or "")).strip()
    version = _normalize_semver(str(manifest_payload.get("version") or session_payload.get("current_version") or "0.1.0"))
    match_rules = _match_rules_from_manifest(manifest_payload)

    manifest_payload["id"] = linked_plugin_id
    manifest_payload["name"] = plugin_name
    manifest_payload["version"] = version
    manifest_payload["description"] = description
    if not isinstance(manifest_payload.get("ui"), dict):
        manifest_payload["ui"] = {}
    manifest_payload["ui"]["surface"] = "sidebar-slot"
    raw_initial_width = manifest_payload["ui"].get("initialWidthPercent")
    if not isinstance(raw_initial_width, (int, float)) or raw_initial_width < 10 or raw_initial_width > 90:
        manifest_payload["ui"]["initialWidthPercent"] = 60
    manifest_file.write_text(json.dumps(manifest_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    workflow_state = _normalize_workflow_state(session_payload.get("workflow_state"))
    if not workflow_state.get("goal"):
        workflow_state["goal"] = description
    if not workflow_state.get("plugin_scope"):
        workflow_state["plugin_scope"] = plugin_name
    if not workflow_state.get("entry_points"):
        targets = manifest_payload.get("targets")
        if isinstance(targets, list):
            workflow_state["entry_points"] = [_to_non_empty_string(item.get("kind")) for item in targets if isinstance(item, dict) and _to_non_empty_string(item.get("kind"))][:3]
    if not workflow_state.get("core_actions"):
        capabilities = manifest_payload.get("capabilities")
        if isinstance(capabilities, list):
            workflow_state["core_actions"] = [_to_non_empty_string(item) for item in capabilities if _to_non_empty_string(item)][:3]
    workflow_state["file_match_mode"] = "all_files" if match_rules.get("allowAll") else str(match_rules.get("kind") or "file")

    session_payload["plugin_id"] = linked_plugin_id
    session_payload["plugin_name"] = plugin_name
    session_payload["description"] = description
    session_payload["current_version"] = version
    session_payload["draft_version"] = _increment_patch(version)
    session_payload["source_mode"] = "imported"
    session_payload["linked_plugin_id"] = linked_plugin_id
    session_payload["state"] = "generated"
    session_payload["auto_verified"] = False
    session_payload["manual_verified"] = False
    session_payload["package_rel_path"] = ""
    session_payload["release_notes"] = ""
    session_payload["published_at"] = ""
    session_payload["match_rules"] = match_rules
    session_payload["workflow_state"] = workflow_state
    session_payload["workflow_stage"] = "requirements"
    session_payload["preview_thread_id"] = preview_thread_id

    fixture_specs = [_to_non_empty_string(item) for item in (manifest_payload.get("fixtures") if isinstance(manifest_payload.get("fixtures"), list) else []) if _to_non_empty_string(item)]
    if fixture_specs:
        fixture_entries, selected_fixture_path = _collect_fixture_entries_from_scaffold(
            source_dir=source_dir,
            fixture_specs=fixture_specs,
        )
        if fixture_entries:
            root_virtual = _plugin_studio_test_materials_virtual_root(session_id)
            root_dir = resolve_thread_virtual_path(preview_thread_id, root_virtual)
            root_dir.mkdir(parents=True, exist_ok=True)
            existing_source_map: dict[str, str] = {}
            existing_materials = session_payload.get("test_materials")
            if isinstance(existing_materials, list):
                for item in existing_materials:
                    if not isinstance(item, dict):
                        continue
                    if item.get("kind") != "file":
                        continue
                    path = _to_non_empty_string(item.get("path"))
                    source = _to_non_empty_string(item.get("source")) or "upload"
                    prefix = f"{root_virtual}/"
                    if path.startswith(prefix):
                        relative = path[len(prefix) :]
                        if relative:
                            existing_source_map[relative] = source

            for entry in fixture_entries:
                relative_path = _normalize_material_relative_path(str(entry["path"]))
                if not relative_path:
                    continue
                target = (root_dir / relative_path).resolve()
                try:
                    target.relative_to(root_dir.resolve())
                except ValueError as exc:
                    raise HTTPException(
                        status_code=422,
                        detail={"stage": "test_materials", "message": f"Unsafe target path: {entry['path']}"},
                    ) from exc
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(entry["content"])
                existing_source_map[relative_path] = "zip"

            records = _collect_test_material_records(
                root_dir=root_dir,
                root_virtual_path=root_virtual,
                source_map=existing_source_map,
            )
            session_payload["test_materials"] = records
            if selected_fixture_path:
                safe_selected = _normalize_material_relative_path(selected_fixture_path)
                if safe_selected:
                    session_payload["selected_test_material_path"] = f"{root_virtual}/{safe_selected}"
            elif not _to_non_empty_string(session_payload.get("selected_test_material_path")):
                first_file = next((item for item in records if item.get("kind") == "file"), None)
                session_payload["selected_test_material_path"] = first_file.get("path") if first_file else ""

    _refresh_plugin_studio_artifact_refs(session_payload)


def _apply_plugin_studio_publish_changes(
    session_payload: dict[str, Any],
    payload: PluginStudioPublishRequest,
) -> None:
    session_id = str(session_payload["session_id"])
    source_dir = _plugin_studio_scaffold_dir(session_id)
    if not source_dir.exists() or not source_dir.is_dir():
        _render_plugin_studio_scaffold(session_payload)

    manifest_file = source_dir / "manifest.json"
    if not manifest_file.exists():
        raise HTTPException(status_code=409, detail={"stage": "generate", "message": "Plugin source missing manifest.json"})

    try:
        loaded_manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=409, detail={"stage": "generate", "message": f"manifest parse failed: {exc}"}) from exc
    manifest_payload = loaded_manifest if isinstance(loaded_manifest, dict) else {}

    version = _normalize_semver(payload.version)
    plugin_id = str(session_payload["plugin_id"])
    plugin_name = str(session_payload["plugin_name"])
    description = payload.description.strip()

    manifest_payload["id"] = plugin_id
    manifest_payload["name"] = plugin_name
    manifest_payload["version"] = version
    manifest_payload["description"] = description
    manifest_payload["runtime"] = "iframe"
    match_rules = _normalize_match_rules(session_payload.get("match_rules"))
    manifest_payload["targets"] = _build_targets_from_match_rules(match_rules)
    if not isinstance(manifest_payload.get("provenance"), dict):
        manifest_payload["provenance"] = {}
    manifest_payload["provenance"]["source"] = "assistant"
    if not isinstance(manifest_payload.get("verification"), dict):
        manifest_payload["verification"] = {}
    manifest_payload["verification"]["level"] = "auto_manual"
    if not isinstance(manifest_payload.get("ui"), dict):
        manifest_payload["ui"] = {}
    manifest_payload["ui"]["surface"] = "sidebar-slot"
    raw_initial_width = manifest_payload["ui"].get("initialWidthPercent")
    if not isinstance(raw_initial_width, (int, float)) or raw_initial_width < 10 or raw_initial_width > 90:
        manifest_payload["ui"]["initialWidthPercent"] = 60

    fixture_paths = _sync_session_fixtures_into_scaffold(session_payload, source_dir)
    if fixture_paths:
        manifest_payload["fixtures"] = fixture_paths
    else:
        manifest_payload["fixtures"] = []

    if not isinstance(manifest_payload.get("docs"), dict):
        manifest_payload["docs"] = {}
    manifest_payload["docs"]["readme_path"] = str(manifest_payload["docs"].get("readme_path") or "README.md")
    manifest_file.write_text(json.dumps(manifest_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    readme_path = source_dir / str(manifest_payload["docs"]["readme_path"])
    readme_path.parent.mkdir(parents=True, exist_ok=True)
    existing_readme = readme_path.read_text(encoding="utf-8") if readme_path.exists() else f"# {plugin_name}\n\n{description}\n"
    release_marker = f"### v{version} "
    release_block = f"\n\n## 发布记录\n\n### v{version} ({datetime.now(UTC).date().isoformat()})\n\n{payload.release_notes.strip()}\n"
    if "## 发布记录" not in existing_readme:
        updated_readme = existing_readme.rstrip() + release_block
    elif release_marker not in existing_readme:
        updated_readme = existing_readme.rstrip() + f"\n\n### v{version} ({datetime.now(UTC).date().isoformat()})\n\n{payload.release_notes.strip()}\n"
    else:
        updated_readme = existing_readme
    readme_path.write_text(updated_readme.rstrip() + "\n", encoding="utf-8")

    if payload.conversation_snapshot.strip():
        trace_dir = source_dir / ".plugin-assistant"
        trace_dir.mkdir(parents=True, exist_ok=True)
        trace_file = trace_dir / f"conversation-{version}.md"
        trace_file.write_text(payload.conversation_snapshot.strip() + "\n", encoding="utf-8")

    session_payload["description"] = description
    session_payload["release_notes"] = payload.release_notes.strip()
    session_payload["current_version"] = version
    session_payload["draft_version"] = _increment_patch(version)
    session_payload["workflow_stage"] = "generate"
    _refresh_plugin_studio_artifact_refs(session_payload)


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.post(
    "/sessions",
    response_model=PluginStudioSessionResponse,
    summary="Create plugin studio session",
)
async def create_plugin_studio_session(payload: PluginStudioSessionCreateRequest) -> PluginStudioSessionResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_id = uuid.uuid4().hex
        plugin_id = _safe_plugin_id(payload.plugin_id or payload.plugin_name)
        now = _utcnow_iso()
        session_payload: dict[str, Any] = {
            "session_id": session_id,
            "plugin_id": plugin_id,
            "plugin_name": payload.plugin_name.strip(),
            "chat_thread_id": (payload.chat_thread_id or "").strip(),
            "preview_thread_id": "",
            "description": payload.description.strip(),
            "state": "draft",
            "auto_verified": False,
            "manual_verified": False,
            "current_version": "0.1.0",
            "release_notes": "",
            "source_mode": "scratch",
            "linked_plugin_id": "",
            "published_at": "",
            "created_at": now,
            "updated_at": now,
            "readme_rel_path": "",
            "demo_rel_paths": [],
            "package_rel_path": "",
            "manual_note": "",
            "workflow_stage": "requirements",
            "workflow_state": {
                **_default_workflow_state(),
                "goal": payload.description.strip(),
                "plugin_scope": payload.plugin_name.strip(),
            },
            "draft_version": "0.1.1",
            "match_rules": _normalize_match_rules({}),
            "test_materials": [],
            "selected_test_material_path": "",
        }
        await _ensure_plugin_studio_preview_thread(session_payload)
        _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


@router.get(
    "/sessions/{session_id}",
    response_model=PluginStudioSessionResponse,
    summary="Get plugin studio session",
)
async def get_plugin_studio_session(session_id: str) -> PluginStudioSessionResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        if not _to_non_empty_string(session_payload.get("preview_thread_id")):
            await _ensure_plugin_studio_preview_thread(session_payload)
            _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


@router.post(
    "/sessions/{session_id}/generate",
    response_model=PluginStudioSessionResponse,
    summary="Generate plugin scaffold in session",
)
async def generate_plugin_studio_session(
    session_id: str,
    payload: PluginStudioGenerateRequest,
) -> PluginStudioSessionResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        if payload.description is not None:
            session_payload["description"] = payload.description.strip()
        _render_plugin_studio_scaffold(session_payload)
        session_payload["state"] = "generated"
        session_payload["auto_verified"] = False
        session_payload["manual_verified"] = False
        session_payload["source_mode"] = "scratch"
        session_payload["package_rel_path"] = ""
        session_payload["release_notes"] = ""
        session_payload["published_at"] = ""
        session_payload["draft_version"] = _increment_patch(_normalize_semver(str(session_payload.get("current_version") or "0.1.0")))
        workflow_state = _normalize_workflow_state(session_payload.get("workflow_state"))
        if payload.description is not None:
            workflow_state["goal"] = payload.description.strip()
        if not workflow_state.get("plugin_scope"):
            workflow_state["plugin_scope"] = str(session_payload.get("plugin_name") or "")
        session_payload["workflow_state"] = workflow_state
        session_payload["workflow_stage"] = "requirements"
        _refresh_plugin_studio_artifact_refs(session_payload)
        _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


@router.post(
    "/sessions/{session_id}/source/import",
    response_model=PluginStudioSessionResponse,
    summary="Import plugin source package into plugin studio session",
)
async def import_plugin_studio_session_source(
    session_id: str,
    payload: PluginStudioImportSourceRequest,
) -> PluginStudioSessionResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        if payload.plugin_name is not None:
            session_payload["plugin_name"] = payload.plugin_name.strip()
        if payload.description is not None:
            session_payload["description"] = payload.description.strip()
        preview_thread_id = await _ensure_plugin_studio_preview_thread(
            session_payload,
            preferred_thread_id=_to_non_empty_string(payload.thread_id),
        )
        _import_plugin_studio_source(
            session_payload,
            payload,
            preview_thread_id=preview_thread_id,
        )
        _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


@router.get(
    "/sessions/{session_id}/source/package",
    response_model=PluginStudioSourcePackageResponse,
    summary="Read current plugin studio draft source package",
)
async def read_plugin_studio_source_package(session_id: str) -> PluginStudioSourcePackageResponse:
    _read_plugin_studio_session(session_id)
    return _read_plugin_studio_source_package(session_id)


@router.post(
    "/sessions/{session_id}/workspace/seed",
    response_model=PluginStudioWorkspaceSeedResponse,
    summary="Seed plugin studio source into chat thread workspace",
)
async def seed_plugin_studio_workspace(
    session_id: str,
    payload: PluginStudioWorkspaceSyncRequest,
) -> PluginStudioWorkspaceSeedResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        source_dir = _plugin_studio_scaffold_dir(session_id)
        if not source_dir.exists() or not source_dir.is_dir():
            raise HTTPException(status_code=409, detail="Plugin source is missing, run generate or import first")

        get_paths().ensure_thread_dirs(payload.thread_id)
        target_source_dir = _plugin_studio_workspace_source_dir(payload.thread_id)
        _copy_directory_contents(source_dir, target_source_dir)

        test_materials_root: str | None = None
        if payload.include_test_materials:
            _copy_plugin_studio_test_materials_to_thread_workspace(
                session_payload=session_payload,
                thread_id=payload.thread_id,
            )
            test_materials_root = _PLUGIN_STUDIO_WORKSPACE_TEST_ROOT

    return PluginStudioWorkspaceSeedResponse(
        session_id=session_id,
        thread_id=payload.thread_id,
        source_root=_PLUGIN_STUDIO_WORKSPACE_SOURCE_ROOT,
        test_materials_root=test_materials_root,
    )


@router.post(
    "/sessions/{session_id}/workspace/pull",
    response_model=PluginStudioSessionResponse,
    summary="Pull chat thread workspace source back into plugin studio session",
)
async def pull_plugin_studio_workspace(
    session_id: str,
    payload: PluginStudioWorkspaceSyncRequest,
) -> PluginStudioSessionResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        workspace_source_dir = _plugin_studio_workspace_source_dir(payload.thread_id)
        if not workspace_source_dir.exists() or not workspace_source_dir.is_dir():
            raise HTTPException(status_code=404, detail="Workspace plugin source not found")
        if not (workspace_source_dir / "manifest.json").exists():
            raise HTTPException(status_code=409, detail="Workspace plugin source missing manifest.json")

        target_source_dir = _plugin_studio_scaffold_dir(session_id)
        _copy_directory_contents(workspace_source_dir, target_source_dir)
        _sync_plugin_studio_session_metadata_from_source_dir(
            session_payload,
            source_dir=target_source_dir,
        )
        _refresh_plugin_studio_artifact_refs(session_payload)
        _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


@router.patch(
    "/sessions/{session_id}/draft",
    response_model=PluginStudioSessionResponse,
    summary="Update plugin studio draft metadata",
)
async def update_plugin_studio_draft(
    session_id: str,
    payload: PluginStudioDraftRequest,
) -> PluginStudioSessionResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        if payload.description is not None:
            session_payload["description"] = payload.description.strip()
        if payload.draft_version is not None:
            version = payload.draft_version.strip()
            if _parse_semver(version) is None:
                raise HTTPException(
                    status_code=422,
                    detail={"stage": "version", "message": "Draft version must be semver (x.y.z)"},
                )
            session_payload["draft_version"] = _normalize_semver(version)
        if payload.chat_thread_id is not None:
            session_payload["chat_thread_id"] = payload.chat_thread_id.strip()
        if payload.match_rules is not None:
            normalized_match_rules = _normalize_match_rules(payload.match_rules)
            session_payload["match_rules"] = normalized_match_rules
            workflow_state = _normalize_workflow_state(session_payload.get("workflow_state"))
            workflow_state["file_match_mode"] = "all_files" if normalized_match_rules.get("allowAll") else str(normalized_match_rules.get("kind") or "file")
            session_payload["workflow_state"] = workflow_state
        if payload.workflow_state is not None:
            session_payload["workflow_state"] = _normalize_workflow_state(payload.workflow_state)
        if payload.workflow_stage is not None:
            session_payload["workflow_stage"] = payload.workflow_stage
        if payload.selected_test_material_path is not None:
            selected = _to_non_empty_string(payload.selected_test_material_path)
            session_payload["selected_test_material_path"] = selected

        _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


@router.post(
    "/sessions/{session_id}/test-materials/import",
    response_model=PluginStudioTestMaterialsResponse,
    summary="Import test materials for plugin studio session",
)
async def import_plugin_studio_test_materials(
    session_id: str,
    payload: PluginStudioTestMaterialImportRequest,
) -> PluginStudioTestMaterialsResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        preview_thread_id = await _ensure_plugin_studio_preview_thread(
            session_payload,
            preferred_thread_id=_to_non_empty_string(payload.thread_id),
        )
        _import_plugin_studio_test_materials(
            session_payload=session_payload,
            payload=payload,
            thread_id=preview_thread_id,
        )
        _save_plugin_studio_session(session_id, session_payload)

    return PluginStudioTestMaterialsResponse(
        session_id=session_id,
        test_materials=[
            {
                "path": str(item.get("path") or ""),
                "kind": str(item.get("kind") or "file"),
                "source": str(item.get("source") or "upload"),
            }
            for item in (session_payload.get("test_materials") if isinstance(session_payload.get("test_materials"), list) else [])
            if isinstance(item, dict) and str(item.get("path") or "").strip()
        ],
        selected_test_material_path=_to_non_empty_string(session_payload.get("selected_test_material_path")) or None,
    )


@router.get(
    "/sessions/{session_id}/test-materials",
    response_model=PluginStudioTestMaterialsResponse,
    summary="List plugin studio test materials",
)
async def list_plugin_studio_test_materials(session_id: str) -> PluginStudioTestMaterialsResponse:
    session_payload = _read_plugin_studio_session(session_id)
    return PluginStudioTestMaterialsResponse(
        session_id=session_id,
        test_materials=[
            {
                "path": str(item.get("path") or ""),
                "kind": str(item.get("kind") or "file"),
                "source": str(item.get("source") or "upload"),
            }
            for item in (session_payload.get("test_materials") if isinstance(session_payload.get("test_materials"), list) else [])
            if isinstance(item, dict) and str(item.get("path") or "").strip()
        ],
        selected_test_material_path=_to_non_empty_string(session_payload.get("selected_test_material_path")) or None,
    )


@router.delete(
    "/sessions/{session_id}/test-materials",
    response_model=PluginStudioTestMaterialsResponse,
    summary="Delete plugin studio test material item",
)
async def delete_plugin_studio_test_materials(
    session_id: str,
    payload: PluginStudioTestMaterialDeleteRequest,
) -> PluginStudioTestMaterialsResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        preview_thread_id = await _ensure_plugin_studio_preview_thread(
            session_payload,
            preferred_thread_id=_to_non_empty_string(payload.thread_id),
        )
        _delete_plugin_studio_test_material(
            session_payload=session_payload,
            payload=payload,
            thread_id=preview_thread_id,
        )
        _save_plugin_studio_session(session_id, session_payload)
    return PluginStudioTestMaterialsResponse(
        session_id=session_id,
        test_materials=[
            {
                "path": str(item.get("path") or ""),
                "kind": str(item.get("kind") or "file"),
                "source": str(item.get("source") or "upload"),
            }
            for item in (session_payload.get("test_materials") if isinstance(session_payload.get("test_materials"), list) else [])
            if isinstance(item, dict) and str(item.get("path") or "").strip()
        ],
        selected_test_material_path=_to_non_empty_string(session_payload.get("selected_test_material_path")) or None,
    )


@router.post(
    "/sessions/{session_id}/verify/auto",
    response_model=PluginStudioAutoVerifyResponse,
    summary="Run auto verification for plugin studio session",
)
async def auto_verify_plugin_studio_session(session_id: str) -> PluginStudioAutoVerifyResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        if str(session_payload.get("state")) == "draft":
            raise HTTPException(status_code=409, detail="Session is draft, generate scaffold first")
        passed, steps = _run_plugin_studio_auto_verify(session_payload)
        session_payload["auto_verified"] = passed
        session_payload["manual_verified"] = False if not passed else bool(session_payload.get("manual_verified", False))
        session_payload["state"] = "auto_verified" if passed else "generated"
        session_payload["last_auto_verify"] = {
            "executed_at": _utcnow_iso(),
            "passed": passed,
            "steps": steps,
        }
        _save_plugin_studio_session(session_id, session_payload)

    summary = "Auto verification passed." if passed else "Auto verification failed."
    return PluginStudioAutoVerifyResponse(
        session_id=session_id,
        passed=passed,
        executed_at=_utcnow_iso(),
        summary=summary,
        steps=[PluginStudioStepReport(**step) for step in steps],
    )


@router.post(
    "/sessions/{session_id}/publish",
    response_model=PluginStudioPublishResponse,
    summary="Publish plugin studio session with auto verify/package pipeline",
)
async def publish_plugin_studio_session(
    session_id: str,
    payload: PluginStudioPublishRequest,
) -> PluginStudioPublishResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        version = payload.version.strip()
        if _parse_semver(version) is None:
            raise HTTPException(status_code=422, detail={"stage": "version", "message": "Version must be semver (x.y.z)"})

        current_version = _normalize_semver(str(session_payload.get("current_version") or "0.1.0"))
        if not _is_semver_greater(version, current_version):
            raise HTTPException(
                status_code=422,
                detail={
                    "stage": "version",
                    "message": f"Version must be greater than current version {current_version}",
                },
            )

        _apply_plugin_studio_publish_changes(session_payload, payload)

        passed, steps = _run_plugin_studio_auto_verify(session_payload)
        verify_executed_at = _utcnow_iso()
        session_payload["last_auto_verify"] = {
            "executed_at": verify_executed_at,
            "passed": passed,
            "steps": steps,
        }
        session_payload["auto_verified"] = passed
        if not passed:
            session_payload["manual_verified"] = False
            session_payload["state"] = "generated"
            _save_plugin_studio_session(session_id, session_payload)
            raise HTTPException(
                status_code=422,
                detail={
                    "stage": "auto_verify",
                    "message": "Auto verification failed",
                    "steps": steps,
                },
            )

        session_payload["manual_verified"] = True
        session_payload["manual_note"] = "publish pipeline auto-approved"
        session_payload["state"] = "manual_verified"

        package_path = _build_plugin_studio_package(session_payload)
        packaged_at = _utcnow_iso()
        session_payload["state"] = "packaged"
        session_payload["package_rel_path"] = str(package_path.relative_to(_plugin_studio_session_dir(session_id)))
        session_payload["packaged_at"] = packaged_at
        session_payload["published_at"] = packaged_at
        session_payload["current_version"] = _normalize_semver(version)
        _save_plugin_studio_session(session_id, session_payload)

    verify_summary = "Auto verification passed." if passed else "Auto verification failed."
    verify_report = PluginStudioAutoVerifyResponse(
        session_id=session_id,
        passed=passed,
        executed_at=verify_executed_at,
        summary=verify_summary,
        steps=[PluginStudioStepReport(**step) for step in steps],
    )
    return PluginStudioPublishResponse(
        session=_plugin_studio_response(session_payload),
        plugin_id=str(session_payload["plugin_id"]),
        version=str(session_payload["current_version"]),
        filename=package_path.name,
        package_download_url=f"/api/workbench/plugin-studio/sessions/{session_id}/package/download",
        packaged_at=packaged_at,
        verify_report=verify_report,
    )


@router.post(
    "/sessions/{session_id}/verify/manual",
    response_model=PluginStudioSessionResponse,
    summary="Mark manual verification result for plugin studio session",
)
async def manual_verify_plugin_studio_session(
    session_id: str,
    payload: PluginStudioManualVerifyRequest,
) -> PluginStudioSessionResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        if payload.passed and not bool(session_payload.get("auto_verified", False)):
            raise HTTPException(status_code=409, detail="Auto verification must pass before manual verification")
        session_payload["manual_verified"] = bool(payload.passed)
        session_payload["manual_note"] = payload.note or ""
        if payload.passed:
            session_payload["state"] = "manual_verified"
        else:
            session_payload["state"] = "auto_verified" if bool(session_payload.get("auto_verified", False)) else "generated"
        _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


@router.post(
    "/sessions/{session_id}/package",
    response_model=PluginStudioPackageResponse,
    summary="Package plugin studio session as .nwp",
)
async def package_plugin_studio_session(session_id: str) -> PluginStudioPackageResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        if not bool(session_payload.get("auto_verified", False)):
            raise HTTPException(status_code=409, detail="Auto verification has not passed")
        if not bool(session_payload.get("manual_verified", False)):
            raise HTTPException(status_code=409, detail="Manual verification has not passed")
        package_path = _build_plugin_studio_package(session_payload)
        session_payload["state"] = "packaged"
        session_payload["package_rel_path"] = str(package_path.relative_to(_plugin_studio_session_dir(session_id)))
        packaged_at = _utcnow_iso()
        session_payload["packaged_at"] = packaged_at
        _save_plugin_studio_session(session_id, session_payload)

    return PluginStudioPackageResponse(
        session_id=session_id,
        plugin_id=str(session_payload["plugin_id"]),
        filename=package_path.name,
        package_download_url=f"/api/workbench/plugin-studio/sessions/{session_id}/package/download",
        packaged_at=packaged_at,
    )


@router.get(
    "/sessions/{session_id}/package/download",
    summary="Download packaged plugin studio artifact",
)
async def download_plugin_studio_package(session_id: str) -> FileResponse:
    session_payload = _read_plugin_studio_session(session_id)
    package_rel_path = str(session_payload.get("package_rel_path") or "").strip()
    if not package_rel_path:
        raise HTTPException(status_code=404, detail="Packaged artifact not found")
    package_file = (_plugin_studio_session_dir(session_id) / package_rel_path).resolve()
    try:
        package_file.relative_to(_plugin_studio_session_dir(session_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid package file path") from exc
    if not package_file.exists() or not package_file.is_file():
        raise HTTPException(status_code=404, detail="Packaged artifact file missing")
    return FileResponse(path=package_file, filename=package_file.name, media_type="application/zip")


@router.get(
    "/sessions/{session_id}/readme",
    summary="Read plugin studio generated README",
)
async def read_plugin_studio_readme(session_id: str) -> FileResponse:
    session_payload = _read_plugin_studio_session(session_id)
    readme_rel = str(session_payload.get("readme_rel_path") or "").strip()
    if not readme_rel:
        raise HTTPException(status_code=404, detail="README not generated")
    readme_file = (_plugin_studio_scaffold_dir(session_id) / readme_rel).resolve()
    try:
        readme_file.relative_to(_plugin_studio_scaffold_dir(session_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid readme path") from exc
    if not readme_file.exists() or not readme_file.is_file():
        raise HTTPException(status_code=404, detail="README file missing")
    return FileResponse(path=readme_file, media_type="text/markdown")


@router.get(
    "/sessions/{session_id}/assets/{asset_path:path}",
    summary="Read plugin studio generated demo asset",
)
async def read_plugin_studio_asset(session_id: str, asset_path: str) -> FileResponse:
    normalized = asset_path.lstrip("/")
    if not normalized:
        raise HTTPException(status_code=404, detail="Asset path is empty")
    asset_file = (_plugin_studio_scaffold_dir(session_id) / normalized).resolve()
    try:
        asset_file.relative_to(_plugin_studio_scaffold_dir(session_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid asset path") from exc
    if not asset_file.exists() or not asset_file.is_file():
        raise HTTPException(status_code=404, detail="Asset file missing")
    return FileResponse(path=asset_file)
