from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ChannelPlatform = Literal["lark", "dingtalk", "telegram"]
ChannelMode = Literal["webhook", "stream"]


class ChannelConfigUpsertRequest(BaseModel):
    enabled: bool = False
    mode: ChannelMode = "webhook"
    credentials: dict[str, str] = Field(default_factory=dict)
    default_workspace_id: str | None = Field(default=None, min_length=1, max_length=64)


class ChannelConfigResponse(BaseModel):
    platform: ChannelPlatform
    enabled: bool
    mode: ChannelMode = "webhook"
    credentials: dict[str, str]
    default_workspace_id: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ChannelRuntimeStatusResponse(BaseModel):
    platform: ChannelPlatform
    enabled: bool
    mode: ChannelMode
    proxy_mode: str | None = None
    stream_health: str | None = None
    running: bool
    connected: bool
    active_users: int
    reconnect_count: int
    started_at: str | None = None
    last_ws_connected_at: str | None = None
    last_ws_disconnected_at: str | None = None
    last_event_at: str | None = None
    last_error: str | None = None
    last_error_code: str | None = None
    last_error_at: str | None = None
    last_delivery_path: str | None = None
    last_render_mode: str | None = None
    last_fallback_reason: str | None = None
    last_stream_chunk_at: str | None = None
    last_media_attempted_count: int = 0
    last_media_sent_count: int = 0
    last_media_failed_count: int = 0
    last_media_fallback_reason: str | None = None
    updated_at: str | None = None


class ChannelConnectionTestRequest(BaseModel):
    credentials: dict[str, str] = Field(default_factory=dict)
    timeout_seconds: float = Field(default=8.0, ge=1.0, le=30.0)


class ChannelConnectionTestResponse(BaseModel):
    platform: ChannelPlatform
    success: bool
    message: str
    latency_ms: int | None = None


class ChannelPairingCodeCreateRequest(BaseModel):
    ttl_minutes: int = Field(default=10, ge=1, le=120)


class ChannelPairingCodeResponse(BaseModel):
    id: int
    platform: ChannelPlatform
    code: str
    expires_at: str
    consumed_at: str | None = None
    created_at: str


class ChannelPairRequestResponse(BaseModel):
    id: int
    platform: ChannelPlatform
    code: str
    external_user_id: str
    external_user_name: str | None = None
    chat_id: str
    conversation_type: str | None = None
    source_event_id: str | None = None
    status: Literal["pending", "approved", "rejected"]
    note: str | None = None
    created_at: str
    handled_at: str | None = None
    handled_by: str | None = None


class ChannelPairRequestDecisionRequest(BaseModel):
    handled_by: str | None = Field(default=None, max_length=64)
    note: str | None = Field(default=None, max_length=500)
    workspace_id: str | None = Field(default=None, min_length=1, max_length=64)


class ChannelAuthorizedUserResponse(BaseModel):
    id: int
    platform: ChannelPlatform
    external_user_id: str
    external_user_name: str | None = None
    chat_id: str | None = None
    conversation_type: str | None = None
    workspace_id: str | None = None
    granted_at: str
    revoked_at: str | None = None
    source_request_id: int | None = None


class ChannelAuthorizedUserRevokeRequest(BaseModel):
    handled_by: str | None = Field(default=None, max_length=64)


class ChannelAuthorizedUserRevokeResponse(BaseModel):
    revoked: bool


class ChannelAuthorizedUserWorkspaceUpdateRequest(BaseModel):
    workspace_id: str | None = Field(default=None, min_length=1, max_length=64)


class ChannelWebhookResponse(BaseModel):
    accepted: bool = True
    action: str
    message: str | None = None
    request_id: int | None = None
    thread_id: str | None = None
    workspace_id: str | None = None
    reply_preview: str | None = None
    media_attempted_count: int = 0
    media_sent_count: int = 0
    media_failed_count: int = 0
    media_fallback_reason: str | None = None


class ChannelResetDataRequest(BaseModel):
    confirm_text: str = Field(default="RESET")


class ChannelResetDataResponse(BaseModel):
    platform: ChannelPlatform
    deleted: dict[str, int]
