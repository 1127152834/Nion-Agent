"""Pydantic models for workbench APIs."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

DEFAULT_CWD = "/mnt/user-data/workspace"
DEFAULT_COMMAND_TIMEOUT_SECONDS = 600
MAX_COMMAND_TIMEOUT_SECONDS = 1800


# ── Session models ──────────────────────────────────────────────────────────


class WorkbenchSessionCreateRequest(BaseModel):
    command: str = Field(..., min_length=1, max_length=4000)
    cwd: str = Field(default=DEFAULT_CWD, min_length=1, max_length=1024)
    timeout_seconds: int = Field(default=DEFAULT_COMMAND_TIMEOUT_SECONDS, ge=1, le=MAX_COMMAND_TIMEOUT_SECONDS)


class WorkbenchSessionCreateResponse(BaseModel):
    session_id: str
    status: Literal["running", "finished", "failed", "stopped", "timeout"]
    thread_id: str
    command: str
    cwd: str
    created_at: str


class WorkbenchSessionStopResponse(BaseModel):
    success: bool
    session_id: str
    status: Literal["running", "finished", "failed", "stopped", "timeout"]


# ── Plugin test models ──────────────────────────────────────────────────────


class PluginTestCommandStep(BaseModel):
    id: str | None = None
    command: str = Field(..., min_length=1, max_length=4000)
    cwd: str = Field(default=DEFAULT_CWD, min_length=1, max_length=1024)
    timeout_seconds: int = Field(default=120, ge=1, le=MAX_COMMAND_TIMEOUT_SECONDS)
    expect_contains: list[str] = Field(default_factory=list)


class PluginTestRequest(BaseModel):
    thread_id: str = Field(..., min_length=1)
    command_steps: list[PluginTestCommandStep] = Field(default_factory=list)


class PluginTestStepResult(BaseModel):
    id: str
    passed: bool
    command: str
    cwd: str
    exit_code: int | None = None
    duration_ms: int
    output_excerpt: str
    message: str | None = None


class PluginTestResponse(BaseModel):
    plugin_id: str
    passed: bool
    executed_at: str
    summary: str
    steps: list[PluginTestStepResult]


class PluginTestThreadResponse(BaseModel):
    thread_id: str
    created_at: str
    workspace_root: str


# ── Marketplace models ──────────────────────────────────────────────────────


class MarketplacePluginListItem(BaseModel):
    id: str
    name: str
    description: str
    version: str
    maintainer: str | None = None
    tags: list[str] = Field(default_factory=list)
    updated_at: str | None = None
    download_url: str
    detail_url: str
    docs_summary: str | None = None


class MarketplacePluginListResponse(BaseModel):
    plugins: list[MarketplacePluginListItem]


class MarketplacePluginDetailResponse(BaseModel):
    id: str
    name: str
    description: str
    version: str
    maintainer: str | None = None
    tags: list[str] = Field(default_factory=list)
    updated_at: str | None = None
    download_url: str
    readme_markdown: str
    demo_image_urls: list[str] = Field(default_factory=list)


# ── Plugin Studio models ───────────────────────────────────────────────────


class PluginStudioSessionCreateRequest(BaseModel):
    plugin_name: str = Field(..., min_length=2, max_length=80)
    plugin_id: str | None = Field(default=None, min_length=2, max_length=64)
    description: str = Field(default="", max_length=400)
    chat_thread_id: str | None = Field(default=None, min_length=1, max_length=200)


class PluginStudioGenerateRequest(BaseModel):
    description: str | None = Field(default=None, max_length=2000)


class PluginStudioImportSourceRequest(BaseModel):
    package_base64: str = Field(..., min_length=8)
    filename: str | None = Field(default=None, max_length=240)
    linked_plugin_id: str | None = Field(default=None, min_length=2, max_length=64)
    plugin_name: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=2000)
    thread_id: str | None = Field(default=None, min_length=1, max_length=200)


class PluginStudioManualVerifyRequest(BaseModel):
    passed: bool = Field(default=True)
    note: str | None = Field(default=None, max_length=1000)


class PluginStudioStepReport(BaseModel):
    id: str
    passed: bool
    message: str


class PluginStudioAutoVerifyResponse(BaseModel):
    session_id: str
    passed: bool
    executed_at: str
    summary: str
    steps: list[PluginStudioStepReport]


class PluginStudioPublishRequest(BaseModel):
    version: str = Field(..., min_length=5, max_length=32)
    release_notes: str = Field(..., min_length=1, max_length=8000)
    description: str = Field(..., min_length=1, max_length=4000)
    conversation_snapshot: str = Field(default="", max_length=20000)
    auto_download: bool = Field(default=False)


class PluginStudioDraftRequest(BaseModel):
    description: str | None = Field(default=None, max_length=4000)
    draft_version: str | None = Field(default=None, min_length=5, max_length=32)
    chat_thread_id: str | None = Field(default=None, min_length=1, max_length=200)
    match_rules: dict[str, Any] | None = None
    workflow_state: dict[str, Any] | None = None
    workflow_stage: Literal["requirements", "interaction", "ui_design", "generate"] | None = None
    selected_test_material_path: str | None = Field(default=None, max_length=2048)


class PluginStudioTestMaterialEntry(BaseModel):
    path: str = Field(..., min_length=1, max_length=512)
    content_base64: str = Field(..., min_length=4)
    source: Literal["upload", "zip"] = "upload"


class PluginStudioTestMaterialImportRequest(BaseModel):
    thread_id: str | None = Field(default=None, min_length=1, max_length=200)
    entries: list[PluginStudioTestMaterialEntry] = Field(default_factory=list, min_length=1, max_length=500)
    selected_path: str | None = Field(default=None, max_length=512)


class PluginStudioTestMaterialDeleteRequest(BaseModel):
    thread_id: str | None = Field(default=None, min_length=1, max_length=200)
    path: str = Field(..., min_length=1, max_length=2048)


class PluginStudioTestMaterialsResponse(BaseModel):
    session_id: str
    test_materials: list[dict[str, str]]
    selected_test_material_path: str | None = None


class PluginStudioSessionResponse(BaseModel):
    session_id: str
    plugin_id: str
    plugin_name: str
    chat_thread_id: str | None = None
    preview_thread_id: str | None = None
    description: str
    state: Literal["draft", "generated", "auto_verified", "manual_verified", "packaged"]
    auto_verified: bool
    manual_verified: bool
    current_version: str
    release_notes: str | None = None
    source_mode: Literal["scratch", "imported"] = "scratch"
    linked_plugin_id: str | None = None
    published_at: str | None = None
    created_at: str
    updated_at: str
    readme_url: str | None = None
    demo_image_urls: list[str] = Field(default_factory=list)
    package_download_url: str | None = None
    workflow_stage: Literal["requirements", "interaction", "ui_design", "generate"] = "requirements"
    workflow_state: dict[str, Any] = Field(default_factory=dict)
    draft_version: str | None = None
    match_rules: dict[str, Any] = Field(default_factory=dict)
    test_materials: list[dict[str, str]] = Field(default_factory=list)
    selected_test_material_path: str | None = None


class PluginStudioPackageResponse(BaseModel):
    session_id: str
    plugin_id: str
    filename: str
    package_download_url: str
    packaged_at: str


class PluginStudioWorkspaceSyncRequest(BaseModel):
    thread_id: str = Field(..., min_length=1, max_length=200)
    include_test_materials: bool = Field(default=True)


class PluginStudioWorkspaceSeedResponse(BaseModel):
    session_id: str
    thread_id: str
    source_root: str
    test_materials_root: str | None = None


class PluginStudioSourceFileResponse(BaseModel):
    encoding: Literal["text", "base64"]
    content: str


class PluginStudioSourcePackageResponse(BaseModel):
    session_id: str
    manifest: dict[str, Any]
    files: dict[str, PluginStudioSourceFileResponse]


class PluginStudioPublishResponse(BaseModel):
    session: PluginStudioSessionResponse
    plugin_id: str
    version: str
    filename: str
    package_download_url: str
    packaged_at: str
    verify_report: PluginStudioAutoVerifyResponse
