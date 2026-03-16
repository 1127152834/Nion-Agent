from __future__ import annotations

import base64
import hashlib
import hmac
import json
import mimetypes
import os
import random
import time
import urllib.parse
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from app.channels.plugins.dingtalk.media_sender import DingTalkMediaSender
from app.channels.repository import ChannelRepository
from app.channels.webhook_service import IncomingWebhookEvent
from nion.config.paths import Paths, get_paths
from nion.runtime_profile import RuntimeProfileRepository, RuntimeProfileValidationError


@dataclass(slots=True)
class ChannelAgentBridgeResult:
    thread_id: str
    reply_text: str
    delivered: bool
    delivery_status: str
    delivery_message: str | None = None
    delivery_path: str | None = None
    render_mode: str | None = None
    fallback_reason: str | None = None
    stream_chunk_count: int = 0
    last_stream_chunk_at: str | None = None
    media_attempted_count: int = 0
    media_sent_count: int = 0
    media_failed_count: int = 0
    media_manifest_json: str | None = None
    media_fallback_reason: str | None = None


@dataclass(slots=True)
class ChannelDeliveryResult:
    delivered: bool
    message: str | None
    delivery_path: str | None = None
    render_mode: str | None = None
    fallback_reason: str | None = None
    stream_chunk_count: int = 0
    last_stream_chunk_at: str | None = None


@dataclass(slots=True)
class ChannelMediaAsset:
    virtual_path: str
    local_path: Path
    file_name: str
    extension: str
    media_kind: str
    size_bytes: int


@dataclass(slots=True)
class ChannelMediaDeliveryReport:
    attempted_count: int = 0
    sent_count: int = 0
    failed_count: int = 0
    manifest_json: str | None = None
    fallback_reason: str | None = None


@dataclass(slots=True)
class ChannelReplyBundle:
    reply_text: str
    artifacts: list[str]


ChannelAgentEventCallback = Callable[[str, str, dict[str, Any]], None]


@dataclass(slots=True)
class _DingTalkAICardSession:
    out_track_id: str
    flow_inputing_started: bool = False
    template_id: str | None = None
    stream_api_available: bool = True


@dataclass(slots=True)
class _LarkEditableSession:
    message_id: str


_DINGTALK_AI_CARD_TEMPLATE_ID = "382e4302-551d-4880-bf29-a30acfab2e71.schema"
_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
_VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v"}


def _safe_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if value is None:
        return ""
    return str(value).strip()


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


def _env_flag(name: str, *, default: bool) -> bool:
    raw = _safe_text(os.getenv(name)).lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on", "enabled"}


def _env_int(name: str, *, default: int, min_value: int, max_value: int) -> int:
    raw = _safe_text(os.getenv(name))
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(min_value, min(max_value, value))


def _extract_text_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                text = item.strip()
                if text:
                    parts.append(text)
                continue
            if not isinstance(item, dict):
                continue
            text = _safe_text(item.get("text"))
            if text:
                parts.append(text)
        return "\n".join(parts).strip()
    if isinstance(content, dict):
        for key in ("text", "content", "message"):
            text = _safe_text(content.get(key))
            if text:
                return text
    return ""


def _extract_text_content_preserve(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if not isinstance(item, dict):
                continue
            text_value = item.get("text")
            if isinstance(text_value, str):
                parts.append(text_value)
        return "".join(parts)
    if isinstance(content, dict):
        for key in ("text", "content", "message"):
            text_value = content.get(key)
            if isinstance(text_value, str):
                return text_value
    return ""


def _is_assistant_like_payload(payload: dict[str, Any]) -> bool:
    role_or_type = _safe_text(payload.get("role") or payload.get("type")).lower().replace("_", "")
    if role_or_type in {"assistant", "ai", "aimessage", "aimessagechunk"}:
        return True
    if any(token in role_or_type for token in ("human", "tool", "system")):
        return False
    if "ai" in role_or_type and "message" in role_or_type:
        return True

    payload_id = payload.get("id")
    if isinstance(payload_id, list):
        lowered = "/".join(str(part).lower().replace("_", "") for part in payload_id)
        if "aimessage" in lowered:
            return True
        if any(token in lowered for token in ("humanmessage", "toolmessage", "systemmessage")):
            return False
    return role_or_type in {"", "messagechunk"}


def _merge_stream_text(current: str, incoming: str) -> str:
    if not incoming:
        return current
    if not current:
        return incoming
    if incoming == current:
        return current
    if incoming.startswith(current):
        return incoming
    if current.endswith(incoming):
        return current
    return f"{current}{incoming}"


def _extract_last_assistant_text(response_payload: dict[str, Any]) -> str | None:
    if isinstance(response_payload.get("__error__"), dict):
        error_block = response_payload["__error__"]
        error_type = _safe_text(error_block.get("error")) or "run_error"
        error_message = _safe_text(error_block.get("message")) or "unknown error"
        raise RuntimeError(f"{error_type}: {error_message}")

    message_arrays: list[list[Any]] = []
    values = response_payload.get("values")
    if isinstance(values, dict) and isinstance(values.get("messages"), list):
        message_arrays.append(values["messages"])
    if isinstance(response_payload.get("messages"), list):
        message_arrays.append(response_payload["messages"])

    for messages in message_arrays:
        for message in reversed(messages):
            if not isinstance(message, dict):
                continue
            role = _safe_text(message.get("type") or message.get("role")).lower()
            if role not in {"ai", "assistant"}:
                continue
            text = _extract_text_content(message.get("content"))
            if text:
                return text
    return None


def _extract_message_chunk_text(payload: dict[str, Any]) -> str:
    if not _is_assistant_like_payload(payload):
        return ""
    return _extract_text_content_preserve(payload.get("content"))


def _collect_message_chunks(payload: Any) -> list[str]:
    chunks: list[str] = []
    if isinstance(payload, dict):
        chunk = _extract_message_chunk_text(payload)
        if chunk:
            chunks.append(chunk)
        return chunks
    if isinstance(payload, list):
        for item in payload:
            chunks.extend(_collect_message_chunks(item))
    return chunks


def _parse_sse_event_data(data_lines: list[str]) -> Any:
    if not data_lines:
        return None
    raw = "\n".join(data_lines).strip()
    if not raw:
        return None
    if raw in {"[DONE]", "null"}:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def _normalize_virtual_artifact_path(path: Any) -> str | None:
    if not isinstance(path, str):
        return None
    normalized = path.strip()
    if not normalized:
        return None

    if normalized.startswith("/api/threads/") and "/artifacts/" in normalized:
        normalized = normalized.split("/artifacts/", 1)[1]
    if "?" in normalized:
        normalized = normalized.split("?", 1)[0]
    normalized = normalized.replace("\\", "/")
    if normalized.startswith("mnt/user-data/"):
        normalized = f"/{normalized}"
    if not normalized.startswith("/mnt/user-data/outputs/"):
        return None
    return normalized


class _WorkspacePathResolver:
    """Resolve sandbox virtual paths with optional host-mode support.

    This keeps channel media delivery aligned with runtime profile execution mode
    while still enforcing /mnt/user-data path boundaries.
    """

    def __init__(self, paths: Paths):
        self._paths = paths
        self._runtime_repo = RuntimeProfileRepository()
        # Ensure runtime repo reads profiles from the same base dir.
        self._runtime_repo._paths = paths  # noqa: SLF001 - aligned base_dir is required

    def resolve_virtual_path(
        self,
        thread_id: str,
        virtual_path: str,
        *,
        workspace_id: str | None = None,  # reserved for multi-workspace mapping
    ) -> Path:
        _ = workspace_id
        profile = self._runtime_repo.read(thread_id)
        if profile.get("execution_mode") == "host" and profile.get("host_workdir"):
            try:
                return RuntimeProfileRepository.resolve_host_virtual_path(
                    virtual_path,
                    profile["host_workdir"],
                )
            except RuntimeProfileValidationError:
                # Fall back to sandbox resolution if host path validation fails.
                pass
        return self._paths.resolve_virtual_path(thread_id, virtual_path)


def get_workspace_path_resolver(*, paths: Paths) -> _WorkspacePathResolver:
    """Factory for workspace path resolver used by channel media delivery."""
    return _WorkspacePathResolver(paths)


class _ThreadWorkspaceBindingRepository:
    """Persist thread -> workspace bindings for channel-created threads."""

    def __init__(self, paths: Paths):
        self._bindings_file = paths.base_dir / "channel_thread_workspace_bindings.json"
        self._bindings_file.parent.mkdir(parents=True, exist_ok=True)

    def bind(self, thread_id: str, workspace_id: str, *, allow_rebind: bool = False) -> None:
        normalized_thread_id = _safe_text(thread_id)
        normalized_workspace_id = _safe_text(workspace_id)
        if not normalized_thread_id:
            raise ValueError("thread_id is required")
        if not normalized_workspace_id:
            raise ValueError("workspace_id is required")

        payload = self._read_payload()
        bindings = payload.setdefault("bindings", {})
        current = bindings.get(normalized_thread_id)
        if isinstance(current, dict):
            current_workspace_id = _safe_text(current.get("workspace_id"))
            if current_workspace_id and current_workspace_id != normalized_workspace_id and not allow_rebind:
                raise RuntimeError(f"Thread {normalized_thread_id} already bound to workspace {current_workspace_id}")

        bindings[normalized_thread_id] = {
            "workspace_id": normalized_workspace_id,
            "updated_at": _utcnow(),
        }
        self._write_payload(payload)

    def get_workspace_id(self, thread_id: str) -> str | None:
        normalized_thread_id = _safe_text(thread_id)
        if not normalized_thread_id:
            return None
        payload = self._read_payload()
        binding = payload.get("bindings", {}).get(normalized_thread_id)
        if not isinstance(binding, dict):
            return None
        workspace_id = binding.get("workspace_id")
        return _safe_text(workspace_id) or None

    def _read_payload(self) -> dict[str, Any]:
        if not self._bindings_file.exists():
            return {"bindings": {}}
        try:
            raw = self._bindings_file.read_text(encoding="utf-8")
        except OSError:
            return {"bindings": {}}

        try:
            payload = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            return {"bindings": {}}
        if not isinstance(payload, dict):
            return {"bindings": {}}

        bindings = payload.get("bindings")
        if not isinstance(bindings, dict):
            payload["bindings"] = {}
        return payload

    def _write_payload(self, payload: dict[str, Any]) -> None:
        temp_path = self._bindings_file.with_suffix(".tmp")
        temp_path.write_text(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2),
            encoding="utf-8",
        )
        temp_path.replace(self._bindings_file)


def get_thread_workspace_binding_repository(*, paths: Paths) -> _ThreadWorkspaceBindingRepository:
    return _ThreadWorkspaceBindingRepository(paths)


def _dedupe_artifact_paths(thread_id: str, artifact_paths: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for path in artifact_paths:
        normalized = _normalize_virtual_artifact_path(path)
        if not normalized:
            continue
        key = f"{thread_id}:{normalized}"
        if key in seen:
            continue
        seen.add(key)
        deduped.append(normalized)
    return deduped


def _normalize_thread_id_for_client(thread_id: str) -> str:
    normalized = _safe_text(thread_id)
    if not normalized:
        return normalized
    try:
        return str(uuid.UUID(normalized))
    except (ValueError, AttributeError, TypeError):
        return normalized


def _collect_artifacts_from_payload(payload: Any) -> list[str]:
    artifacts: list[str] = []
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key == "artifacts" and isinstance(value, list):
                for item in value:
                    if isinstance(item, str):
                        artifacts.append(item)
                continue
            artifacts.extend(_collect_artifacts_from_payload(value))
        return artifacts
    if isinstance(payload, list):
        for item in payload:
            artifacts.extend(_collect_artifacts_from_payload(item))
    return artifacts


def _collect_present_files_from_tool_calls(payload: Any) -> list[str]:
    files: list[str] = []
    if isinstance(payload, dict):
        tool_calls = payload.get("tool_calls")
        if isinstance(tool_calls, list):
            for call in tool_calls:
                if not isinstance(call, dict):
                    continue
                if _safe_text(call.get("name")) != "present_files":
                    continue
                args = call.get("args")
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except json.JSONDecodeError:
                        args = {}
                if isinstance(args, dict):
                    filepaths = args.get("filepaths")
                    if isinstance(filepaths, list):
                        for item in filepaths:
                            if isinstance(item, str):
                                files.append(item)
        for value in payload.values():
            files.extend(_collect_present_files_from_tool_calls(value))
        return files
    if isinstance(payload, list):
        for item in payload:
            files.extend(_collect_present_files_from_tool_calls(item))
    return files


def _is_dingtalk_group_chat(incoming: IncomingWebhookEvent) -> bool:
    conversation_type = _safe_text(incoming.conversation_type).lower()
    return conversation_type == "2" or "group" in conversation_type


class _BaseReplyRenderer:
    def __init__(
        self,
        *,
        service: ChannelAgentBridgeService,
        platform: str,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
    ) -> None:
        self._service = service
        self._platform = platform
        self._credentials = credentials
        self._incoming = incoming
        self._report = ChannelDeliveryResult(
            delivered=False,
            message=None,
            render_mode="text",
        )

    @property
    def report(self) -> ChannelDeliveryResult:
        return self._report

    def begin(self) -> None:
        return None

    def update(self, partial_text: str) -> None:
        _ = partial_text
        return None

    def finalize(self, final_text: str, *, failed: bool = False) -> ChannelDeliveryResult:
        _ = final_text
        _ = failed
        return self._report

    def fail(self, reason: str) -> None:
        self._report.fallback_reason = reason
        if not self._report.message:
            self._report.message = reason


class _TextReplyRenderer(_BaseReplyRenderer):
    def __init__(
        self,
        *,
        service: ChannelAgentBridgeService,
        platform: str,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
        placeholder_text: str = "处理中，请稍候...",
        degraded_reason: str | None = None,
    ) -> None:
        super().__init__(
            service=service,
            platform=platform,
            credentials=credentials,
            incoming=incoming,
        )
        self._placeholder_text = placeholder_text
        self._placeholder_sent = False
        self._degraded_reason = degraded_reason
        self._report.render_mode = "text"

    def set_degraded_reason(self, reason: str) -> None:
        self._degraded_reason = _safe_text(reason) or self._degraded_reason

    def _apply_delivery_result(
        self,
        result: ChannelDeliveryResult,
        *,
        fallback_reason: str | None = None,
    ) -> None:
        if result.delivery_path:
            self._report.delivery_path = result.delivery_path
        if fallback_reason and not self._report.fallback_reason:
            self._report.fallback_reason = fallback_reason
        if result.message:
            self._report.message = result.message
        if result.delivered:
            self._report.delivered = True

    def begin(self) -> None:
        if self._placeholder_sent:
            return
        if not self._placeholder_text.strip():
            return
        result = self._service._deliver_reply(
            self._platform,
            chat_id=_safe_text(self._incoming.chat_id),
            text=self._placeholder_text,
            credentials=self._credentials,
            incoming=self._incoming,
        )
        self._placeholder_sent = True
        self._apply_delivery_result(
            result,
            fallback_reason=self._degraded_reason,
        )

    def finalize(self, final_text: str, *, failed: bool = False) -> ChannelDeliveryResult:
        result = self._service._deliver_reply(
            self._platform,
            chat_id=_safe_text(self._incoming.chat_id),
            text=final_text,
            credentials=self._credentials,
            incoming=self._incoming,
        )
        fallback_reason = self._report.fallback_reason
        if failed and not fallback_reason:
            fallback_reason = "renderer finalized with failure"
        self._apply_delivery_result(result, fallback_reason=fallback_reason)
        if failed and result.delivered and not self._report.message:
            self._report.message = "delivered with degraded renderer"
        return self._report


class _LarkReplyRenderer(_BaseReplyRenderer):
    def __init__(
        self,
        *,
        service: ChannelAgentBridgeService,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
    ) -> None:
        super().__init__(
            service=service,
            platform="lark",
            credentials=credentials,
            incoming=incoming,
        )
        self._session: _LarkEditableSession | None = None
        self._last_partial = ""
        self._stream_chunk_count = 0
        self._last_stream_chunk_at: str | None = None
        self._fallback_renderer = _TextReplyRenderer(
            service=service,
            platform="lark",
            credentials=credentials,
            incoming=incoming,
            degraded_reason="lark editable message degraded",
        )
        self._degraded = False

    def _mark_degraded(self, reason: str) -> None:
        normalized_reason = _safe_text(reason) or "lark editable message degraded"
        self._degraded = True
        self._session = None
        self._report.render_mode = "text"
        self._fallback_renderer.set_degraded_reason(normalized_reason)
        if not self._report.fallback_reason:
            self._report.fallback_reason = normalized_reason
        if not self._report.message:
            self._report.message = normalized_reason

    def begin(self) -> None:
        try:
            placeholder_result, message_id = self._service._send_lark_text_with_message_id(
                chat_id=_safe_text(self._incoming.chat_id),
                text="处理中，请稍候...",
                credentials=self._credentials,
            )
            if not placeholder_result.delivered or not message_id:
                raise RuntimeError(_safe_text(placeholder_result.message) or "missing lark message id")
            self._session = _LarkEditableSession(message_id=message_id)
            self._report.delivered = True
            self._report.delivery_path = placeholder_result.delivery_path
            self._report.render_mode = "editable_stream"
            self._report.message = placeholder_result.message
        except Exception as exc:
            self._mark_degraded(f"lark editable begin failed: {exc}")
            self._fallback_renderer.begin()
            self._report.delivery_path = self._fallback_renderer.report.delivery_path
            self._report.delivered = self._fallback_renderer.report.delivered
            self._report.message = self._fallback_renderer.report.message

    def update(self, partial_text: str) -> None:
        normalized_partial = partial_text.strip()
        if not normalized_partial:
            return
        if self._degraded:
            return
        if self._session is None:
            self._mark_degraded("missing lark editable session")
            return
        if normalized_partial == self._last_partial:
            return
        try:
            update_result = self._service._update_lark_text_message(
                message_id=self._session.message_id,
                text=normalized_partial,
                credentials=self._credentials,
            )
            if not update_result.delivered:
                raise RuntimeError(_safe_text(update_result.message) or "lark message update failed")
            self._last_partial = normalized_partial
            self._stream_chunk_count += 1
            self._last_stream_chunk_at = _utcnow()
            self._report.delivered = True
            self._report.delivery_path = update_result.delivery_path
            self._report.render_mode = "editable_stream"
            self._report.message = update_result.message
        except Exception as exc:
            self._mark_degraded(f"lark editable stream failed: {exc}")
            self._fallback_renderer.begin()

    def finalize(self, final_text: str, *, failed: bool = False) -> ChannelDeliveryResult:
        if not self._degraded and self._session is not None:
            try:
                finalize_result = self._service._update_lark_text_message(
                    message_id=self._session.message_id,
                    text=final_text,
                    credentials=self._credentials,
                )
                if not finalize_result.delivered:
                    raise RuntimeError(_safe_text(finalize_result.message) or "lark message finalize failed")
                self._report.delivered = True
                self._report.delivery_path = finalize_result.delivery_path
                self._report.render_mode = "editable_stream"
                self._report.message = "delivered via lark editable message" if not failed else "delivered via lark editable message (failed state)"
            except Exception as exc:
                self._mark_degraded(f"lark editable finalize failed: {exc}")

        if self._degraded:
            fallback_report = self._fallback_renderer.finalize(final_text, failed=failed)
            self._report.delivered = fallback_report.delivered
            self._report.delivery_path = fallback_report.delivery_path
            self._report.message = fallback_report.message
            if not self._report.fallback_reason:
                self._report.fallback_reason = fallback_report.fallback_reason
            self._report.render_mode = "text"

        self._report.stream_chunk_count = self._stream_chunk_count
        self._report.last_stream_chunk_at = self._last_stream_chunk_at
        return self._report


class _DingTalkReplyRenderer(_BaseReplyRenderer):
    def __init__(
        self,
        *,
        service: ChannelAgentBridgeService,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
    ) -> None:
        super().__init__(
            service=service,
            platform="dingtalk",
            credentials=credentials,
            incoming=incoming,
        )
        self._session: _DingTalkAICardSession | None = None
        self._last_partial = ""
        self._stream_chunk_count = 0
        self._last_stream_chunk_at: str | None = None
        self._fallback_renderer = _TextReplyRenderer(
            service=service,
            platform="dingtalk",
            credentials=credentials,
            incoming=incoming,
            degraded_reason="dingtalk ai card degraded",
        )
        self._degraded = False

    def _mark_degraded(self, reason: str) -> None:
        normalized_reason = _safe_text(reason) or "dingtalk ai card degraded"
        self._degraded = True
        self._session = None
        self._report.render_mode = "text"
        self._fallback_renderer.set_degraded_reason(normalized_reason)
        if not self._report.fallback_reason:
            self._report.fallback_reason = normalized_reason
        if not self._report.message:
            self._report.message = normalized_reason

    def begin(self) -> None:
        try:
            self._session = self._service._create_dingtalk_ai_card(
                credentials=self._credentials,
                incoming=self._incoming,
            )
            self._service._stream_dingtalk_ai_card(
                credentials=self._credentials,
                session=self._session,
                content="处理中，请稍候...",
                is_finalize=False,
                is_error=False,
            )
            self._report.delivered = True
            self._report.delivery_path = "dingtalk.ai_card"
            self._report.render_mode = "card_stream"
            self._report.message = "delivered via dingtalk ai card"
        except Exception as exc:
            self._mark_degraded(f"ai card disabled: {exc}")
            self._fallback_renderer.begin()
            self._report.delivery_path = self._fallback_renderer.report.delivery_path
            self._report.delivered = self._fallback_renderer.report.delivered
            self._report.message = self._fallback_renderer.report.message

    def update(self, partial_text: str) -> None:
        normalized_partial = partial_text.strip()
        if not normalized_partial:
            return
        if self._degraded:
            return
        if self._session is None:
            self._mark_degraded("missing ai card session")
            return
        if normalized_partial == self._last_partial:
            return
        try:
            self._service._stream_dingtalk_ai_card(
                credentials=self._credentials,
                session=self._session,
                content=normalized_partial,
                is_finalize=False,
                is_error=False,
            )
            self._last_partial = normalized_partial
            self._stream_chunk_count += 1
            self._last_stream_chunk_at = _utcnow()
            self._report.delivered = True
            self._report.delivery_path = "dingtalk.ai_card"
            self._report.render_mode = "card_stream"
        except Exception as exc:
            self._mark_degraded(f"ai card stream failed: {exc}")
            self._fallback_renderer.begin()

    def finalize(self, final_text: str, *, failed: bool = False) -> ChannelDeliveryResult:
        if not self._degraded and self._session is not None:
            try:
                normalized_final = final_text.strip()
                if normalized_final and normalized_final != self._last_partial:
                    self._service._stream_dingtalk_ai_card(
                        credentials=self._credentials,
                        session=self._session,
                        content=normalized_final,
                        is_finalize=False,
                        is_error=False,
                    )
                    self._stream_chunk_count += 1
                    self._last_stream_chunk_at = _utcnow()
                self._service._finish_dingtalk_ai_card(
                    credentials=self._credentials,
                    session=self._session,
                    final_content=final_text,
                    failed=failed,
                )
                self._report.delivered = True
                self._report.delivery_path = "dingtalk.ai_card"
                self._report.render_mode = "card_stream"
                self._report.message = "delivered via dingtalk ai card" if not failed else "delivered via dingtalk ai card (failed state)"
            except Exception as exc:
                self._mark_degraded(f"ai card finalize failed: {exc}")

        if self._degraded:
            fallback_report = self._fallback_renderer.finalize(final_text, failed=failed)
            self._report.delivered = fallback_report.delivered
            self._report.delivery_path = fallback_report.delivery_path
            self._report.message = fallback_report.message
            if not self._report.fallback_reason:
                self._report.fallback_reason = fallback_report.fallback_reason
            self._report.render_mode = "text"

        self._report.stream_chunk_count = self._stream_chunk_count
        self._report.last_stream_chunk_at = self._last_stream_chunk_at
        return self._report


class ChannelAgentBridgeService:
    def __init__(
        self,
        repo: ChannelRepository,
        *,
        paths: Paths | None = None,
        on_agent_event: ChannelAgentEventCallback | None = None,
    ):
        self._repo = repo
        self._paths = paths or get_paths()
        self._on_agent_event = on_agent_event

    @property
    def _langgraph_base_url(self) -> str:
        return os.getenv("NION_LANGGRAPH_BASE_URL", "http://127.0.0.1:2024").rstrip("/")

    @property
    def _run_timeout_seconds(self) -> float:
        raw = _safe_text(os.getenv("NION_CHANNEL_RUN_TIMEOUT_SECONDS"))
        try:
            return max(10.0, float(raw)) if raw else 120.0
        except ValueError:
            return 120.0

    @property
    def _stream_emit_interval_seconds(self) -> float:
        raw = _safe_text(os.getenv("NION_CHANNEL_STREAM_THROTTLE_MS"))
        try:
            parsed_ms = int(raw) if raw else 500
        except ValueError:
            parsed_ms = 500
        normalized_ms = max(400, min(600, parsed_ms))
        return normalized_ms / 1000.0

    @property
    def _state_snapshot_emit_interval_seconds(self) -> float:
        raw = _safe_text(os.getenv("NION_CHANNEL_STATE_SNAPSHOT_THROTTLE_MS"))
        try:
            parsed_ms = int(raw) if raw else int(self._stream_emit_interval_seconds * 1000)
        except ValueError:
            parsed_ms = int(self._stream_emit_interval_seconds * 1000)
        normalized_ms = max(300, min(1000, parsed_ms))
        return normalized_ms / 1000.0

    @property
    def _media_reply_enabled(self) -> bool:
        return _env_flag("NION_CHANNEL_MEDIA_REPLY_ENABLED", default=True)

    @property
    def _media_max_attachments_per_reply(self) -> int:
        return _env_int(
            "NION_CHANNEL_MEDIA_MAX_ATTACHMENTS_PER_REPLY",
            default=6,
            min_value=1,
            max_value=20,
        )

    @property
    def _media_max_image_bytes(self) -> int:
        mb = _env_int("NION_CHANNEL_MEDIA_MAX_IMAGE_MB", default=10, min_value=1, max_value=100)
        return mb * 1024 * 1024

    @property
    def _media_max_file_bytes(self) -> int:
        mb = _env_int("NION_CHANNEL_MEDIA_MAX_FILE_MB", default=20, min_value=1, max_value=500)
        return mb * 1024 * 1024

    @property
    def _media_max_video_bytes(self) -> int:
        mb = _env_int("NION_CHANNEL_MEDIA_MAX_VIDEO_MB", default=20, min_value=1, max_value=500)
        return mb * 1024 * 1024

    @property
    def _agent_events_enabled(self) -> bool:
        return _env_flag("NION_CHANNEL_AGENT_EVENTS_ENABLED", default=True)

    def _parse_agent_error_code(self, error: str) -> str | None:
        normalized = _safe_text(error)
        if ":" not in normalized:
            return None
        code = _safe_text(normalized.split(":", 1)[0]).replace(" ", "_")
        return code or None

    def _emit_agent_event(
        self,
        *,
        platform: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        if not self._agent_events_enabled or self._on_agent_event is None:
            return
        try:
            self._on_agent_event(platform, event_type, payload)
        except Exception:
            # Keep channel delivery resilient even when telemetry callback fails.
            return

    def _fetch_thread_state_values(self, thread_id: str) -> dict[str, Any] | None:
        normalized_thread_id = _safe_text(thread_id)
        if not normalized_thread_id:
            return None
        timeout_seconds = min(10.0, self._run_timeout_seconds)
        try:
            with httpx.Client(timeout=timeout_seconds) as client:
                response = client.get(f"{self._langgraph_base_url}/threads/{normalized_thread_id}/state")
        except Exception:
            return None
        if response.status_code >= 400:
            return None
        try:
            payload = response.json()
        except Exception:
            return None
        if not isinstance(payload, dict):
            return None
        values = payload.get("values")
        if not isinstance(values, dict):
            return None
        snapshot: dict[str, Any] = {}
        for key in ("title", "messages", "artifacts", "todos"):
            if key in values:
                snapshot[key] = values[key]
        if snapshot:
            return snapshot
        return values

    def _classify_media_kind(self, extension: str) -> str:
        if extension in _IMAGE_EXTENSIONS:
            return "image"
        if extension in _VIDEO_EXTENSIONS:
            return "video"
        return "file"

    def _update_media_manifest_item(
        self,
        manifest: list[dict[str, Any]],
        asset: ChannelMediaAsset,
        *,
        status: str,
        reason: str | None = None,
        **extra: Any,
    ) -> None:
        """Update manifest entry for an asset, or append if missing.

        This keeps a single source of truth for media delivery status.
        """
        for item in manifest:
            if item.get("path") == asset.virtual_path and item.get("status") == "queued":
                item["status"] = status
                if reason:
                    item["reason"] = reason
                if extra:
                    item.update(extra)
                return
        payload: dict[str, Any] = {
            "path": asset.virtual_path,
            "status": status,
            "media_kind": asset.media_kind,
            "size_bytes": asset.size_bytes,
        }
        if reason:
            payload["reason"] = reason
        if extra:
            payload.update(extra)
        manifest.append(payload)

    @staticmethod
    def _format_media_fallback_text(assets: list[ChannelMediaAsset]) -> str:
        """Human-readable fallback when media delivery is partial."""
        lines = ["已生成以下文件："]
        for index, asset in enumerate(assets, start=1):
            lines.append(f"{index}. {asset.file_name}")
        return "\n".join(lines)

    @staticmethod
    def _format_media_fallback_text_from_paths(artifact_paths: list[str]) -> str:
        """Fallback formatter based on raw virtual paths when assets are empty."""
        lines = ["已生成以下文件："]
        for index, path in enumerate(artifact_paths, start=1):
            filename = Path(_safe_text(path)).name or _safe_text(path)
            lines.append(f"{index}. {filename}")
        return "\n".join(lines)

    @staticmethod
    def _lark_file_type_for_extension(extension: str) -> str:
        """Map common extensions to Lark file_type values."""
        if extension in {".xls", ".xlsx", ".csv"}:
            return "xls"
        if extension in {".ppt", ".pptx"}:
            return "ppt"
        if extension == ".pdf":
            return "pdf"
        if extension in {".doc", ".docx"}:
            return "doc"
        return "stream"

    def _build_media_assets(
        self,
        *,
        thread_id: str,
        workspace_id: str,
        artifact_paths: list[str],
    ) -> tuple[list[ChannelMediaAsset], list[dict[str, Any]]]:
        resolver = get_workspace_path_resolver(paths=self._paths)
        assets: list[ChannelMediaAsset] = []
        manifest: list[dict[str, Any]] = []
        for virtual_path in artifact_paths:
            normalized = _normalize_virtual_artifact_path(virtual_path)
            if not normalized:
                manifest.append(
                    {
                        "path": _safe_text(virtual_path),
                        "status": "skipped",
                        "reason": "unsupported_virtual_path",
                    }
                )
                continue
            try:
                local_path = resolver.resolve_virtual_path(
                    thread_id,
                    normalized,
                    workspace_id=workspace_id,
                )
            except Exception as exc:
                manifest.append(
                    {
                        "path": normalized,
                        "status": "failed",
                        "reason": f"path_resolve_failed: {exc}",
                    }
                )
                continue
            if not local_path.exists() or not local_path.is_file():
                manifest.append(
                    {
                        "path": normalized,
                        "status": "failed",
                        "reason": "artifact_not_found",
                    }
                )
                continue
            extension = local_path.suffix.lower()
            media_kind = self._classify_media_kind(extension)
            try:
                size_bytes = int(local_path.stat().st_size)
            except Exception:
                size_bytes = 0
            size_limit = self._media_max_file_bytes
            if media_kind == "image":
                size_limit = self._media_max_image_bytes
            elif media_kind == "video":
                size_limit = self._media_max_video_bytes
            if size_bytes > size_limit:
                manifest.append(
                    {
                        "path": normalized,
                        "status": "skipped",
                        "media_kind": media_kind,
                        "size_bytes": size_bytes,
                        "reason": f"file_too_large>{size_limit}",
                    }
                )
                continue
            assets.append(
                ChannelMediaAsset(
                    virtual_path=normalized,
                    local_path=local_path,
                    file_name=local_path.name,
                    extension=extension,
                    media_kind=media_kind,
                    size_bytes=size_bytes,
                )
            )
            manifest.append(
                {
                    "path": normalized,
                    "status": "queued",
                    "media_kind": media_kind,
                    "size_bytes": size_bytes,
                }
            )
        return assets, manifest

    def _deliver_dingtalk_media_assets(
        self,
        *,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
        thread_id: str,
        workspace_id: str,
        artifact_paths: list[str],
    ) -> ChannelMediaDeliveryReport:
        report = ChannelMediaDeliveryReport()
        if not self._media_reply_enabled or not artifact_paths:
            return report

        assets, manifest = self._build_media_assets(
            thread_id=thread_id,
            workspace_id=workspace_id,
            artifact_paths=artifact_paths,
        )
        max_attachments = self._media_max_attachments_per_reply
        selected_assets = assets[:max_attachments]
        if len(assets) > max_attachments:
            for asset in assets[max_attachments:]:
                manifest.append(
                    {
                        "path": asset.virtual_path,
                        "status": "skipped",
                        "media_kind": asset.media_kind,
                        "size_bytes": asset.size_bytes,
                        "reason": "exceed_max_attachments",
                    }
                )

        sender = DingTalkMediaSender(
            credentials=credentials,
            incoming=incoming,
            timeout_seconds=self._run_timeout_seconds,
        )
        summary_lines = ["已生成以下文件，开始发送："]
        for index, asset in enumerate(selected_assets, start=1):
            summary_lines.append(f"{index}. {asset.file_name}")
        skipped_count = sum(1 for item in manifest if item.get("status") == "skipped")
        if skipped_count > 0:
            summary_lines.append(f"另有 {skipped_count} 个文件因数量或大小限制未发送。")
        if selected_assets:
            self._send_dingtalk_text(
                text="\n".join(summary_lines),
                credentials=credentials,
                incoming=incoming,
            )

        for asset in selected_assets:
            report.attempted_count += 1
            manifest_item = next(
                (item for item in manifest if item.get("path") == asset.virtual_path and item.get("status") == "queued"),
                None,
            )
            try:
                content = asset.local_path.read_bytes()
            except Exception as exc:
                report.failed_count += 1
                if manifest_item is not None:
                    manifest_item["status"] = "failed"
                    manifest_item["reason"] = f"read_file_failed: {exc}"
                if not report.fallback_reason:
                    report.fallback_reason = "media_file_read_failed"
                continue

            mime_type = mimetypes.guess_type(asset.file_name)[0] or "application/octet-stream"
            upload_result = sender.upload(
                content=content,
                filename=asset.file_name,
                media_type=asset.media_kind if asset.media_kind in {"image", "video"} else "file",
                mime_type=mime_type,
            )
            if not upload_result.ok or not upload_result.media_id:
                report.failed_count += 1
                if manifest_item is not None:
                    manifest_item["status"] = "failed"
                    manifest_item["reason"] = _safe_text(upload_result.message) or "media_upload_failed"
                if not report.fallback_reason:
                    report.fallback_reason = "media_upload_failed"
                continue

            if asset.media_kind == "image":
                delivery = sender.send_image(upload_result.media_id)
            elif asset.media_kind == "video":
                delivery = sender.send_video(
                    upload_result.media_id,
                    video_type=(asset.extension.lstrip(".") or "mp4"),
                )
            else:
                delivery = sender.send_file(
                    upload_result.media_id,
                    file_name=asset.file_name,
                    file_type=(asset.extension.lstrip(".") or "file"),
                )
            if delivery.delivered:
                report.sent_count += 1
                if manifest_item is not None:
                    manifest_item["status"] = "sent"
                    manifest_item["delivery_path"] = delivery.delivery_path
                continue
            report.failed_count += 1
            if manifest_item is not None:
                manifest_item["status"] = "failed"
                manifest_item["reason"] = _safe_text(delivery.message) or "media_delivery_failed"
                manifest_item["delivery_path"] = delivery.delivery_path
            if not report.fallback_reason:
                report.fallback_reason = _safe_text(delivery.fallback_reason) or "media_delivery_failed"

        if report.failed_count > 0:
            self._send_dingtalk_text(
                text=f"有 {report.failed_count} 个文件发送失败，请稍后重试。",
                credentials=credentials,
                incoming=incoming,
            )
        report.manifest_json = json.dumps(manifest, ensure_ascii=False)
        return report

    def _deliver_lark_media_assets(
        self,
        *,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
        thread_id: str,
        workspace_id: str,
        artifact_paths: list[str],
    ) -> ChannelMediaDeliveryReport:
        report = ChannelMediaDeliveryReport()
        if not self._media_reply_enabled or not artifact_paths:
            return report

        chat_id = _safe_text(incoming.chat_id)
        if not chat_id:
            report.fallback_reason = "missing_chat_id"
            return report

        assets, manifest = self._build_media_assets(
            thread_id=thread_id,
            workspace_id=workspace_id,
            artifact_paths=artifact_paths,
        )

        max_attachments = self._media_max_attachments_per_reply
        selected_assets = assets[:max_attachments]
        if len(assets) > max_attachments:
            for asset in assets[max_attachments:]:
                self._update_media_manifest_item(
                    manifest,
                    asset,
                    status="skipped",
                    reason="exceed_max_attachments",
                )

        # Feishu limits: image 10MB, file 30MB (cap by env settings).
        filtered_assets: list[ChannelMediaAsset] = []
        for asset in selected_assets:
            platform_limit = 10 * 1024 * 1024 if asset.media_kind == "image" else 30 * 1024 * 1024
            env_limit = self._media_max_image_bytes if asset.media_kind == "image" else self._media_max_file_bytes
            effective_limit = min(platform_limit, env_limit)
            if asset.size_bytes > effective_limit:
                self._update_media_manifest_item(
                    manifest,
                    asset,
                    status="skipped",
                    reason=f"file_too_large>{effective_limit}",
                )
                continue
            filtered_assets.append(asset)
        selected_assets = filtered_assets

        if not selected_assets:
            skipped_count = sum(1 for item in manifest if item.get("status") == "skipped")
            if skipped_count > 0:
                fallback_text = self._format_media_fallback_text(assets) if assets else self._format_media_fallback_text_from_paths(artifact_paths)
                self._send_lark_text(
                    chat_id=chat_id,
                    text=fallback_text,
                    credentials=credentials,
                )
                report.fallback_reason = "media_skipped"
            report.manifest_json = json.dumps(manifest, ensure_ascii=False)
            return report

        try:
            token = self._get_lark_tenant_access_token(credentials=credentials)
        except Exception as exc:
            report.fallback_reason = _safe_text(exc) or "lark token failed"
            report.manifest_json = json.dumps(manifest, ensure_ascii=False)
            return report

        headers = {"Authorization": f"Bearer {token}"}
        with httpx.Client(timeout=self._run_timeout_seconds) as client:
            for asset in selected_assets:
                report.attempted_count += 1
                mime_type = mimetypes.guess_type(asset.file_name)[0] or "application/octet-stream"

                try:
                    with open(asset.local_path, "rb") as f:
                        if asset.media_kind == "image":
                            upload_resp = client.post(
                                "https://open.feishu.cn/open-apis/im/v1/images",
                                headers=headers,
                                data={"image_type": "message"},
                                files={"image": (asset.file_name, f, mime_type)},
                            )
                            if upload_resp.status_code >= 400:
                                raise RuntimeError(f"image upload http {upload_resp.status_code}")
                            upload_payload = upload_resp.json()
                            if int(upload_payload.get("code") or 0) != 0:
                                raise RuntimeError(_safe_text(upload_payload.get("msg") or "image upload failed"))
                            image_key = _safe_text((upload_payload.get("data") or {}).get("image_key"))
                            if not image_key:
                                raise RuntimeError("missing image_key")
                            msg_type = "image"
                            content = json.dumps({"image_key": image_key}, ensure_ascii=False)
                        else:
                            upload_resp = client.post(
                                "https://open.feishu.cn/open-apis/im/v1/files",
                                headers=headers,
                                data={
                                    "file_type": self._lark_file_type_for_extension(asset.extension),
                                    "file_name": asset.file_name,
                                },
                                files={"file": (asset.file_name, f, mime_type)},
                            )
                            if upload_resp.status_code >= 400:
                                raise RuntimeError(f"file upload http {upload_resp.status_code}")
                            upload_payload = upload_resp.json()
                            if int(upload_payload.get("code") or 0) != 0:
                                raise RuntimeError(_safe_text(upload_payload.get("msg") or "file upload failed"))
                            file_key = _safe_text((upload_payload.get("data") or {}).get("file_key"))
                            if not file_key:
                                raise RuntimeError("missing file_key")
                            msg_type = "file"
                            content = json.dumps({"file_key": file_key}, ensure_ascii=False)
                except Exception as exc:
                    report.failed_count += 1
                    self._update_media_manifest_item(
                        manifest,
                        asset,
                        status="failed",
                        reason=_safe_text(exc) or "media_upload_failed",
                    )
                    if not report.fallback_reason:
                        report.fallback_reason = "media_upload_failed"
                    continue

                message_resp = client.post(
                    "https://open.feishu.cn/open-apis/im/v1/messages",
                    params={"receive_id_type": "chat_id"},
                    headers=headers,
                    json={
                        "receive_id": chat_id,
                        "msg_type": msg_type,
                        "content": content,
                    },
                )
                if message_resp.status_code >= 400:
                    report.failed_count += 1
                    self._update_media_manifest_item(
                        manifest,
                        asset,
                        status="failed",
                        reason=f"media_delivery_http_{message_resp.status_code}",
                    )
                    if not report.fallback_reason:
                        report.fallback_reason = "media_delivery_failed"
                    continue
                message_payload = message_resp.json()
                if int(message_payload.get("code") or 0) != 0:
                    report.failed_count += 1
                    self._update_media_manifest_item(
                        manifest,
                        asset,
                        status="failed",
                        reason=_safe_text(message_payload.get("msg") or "media_delivery_failed"),
                    )
                    if not report.fallback_reason:
                        report.fallback_reason = "media_delivery_failed"
                    continue

                report.sent_count += 1
                self._update_media_manifest_item(
                    manifest,
                    asset,
                    status="sent",
                    delivery_path="lark.api.media",
                )

        skipped_count = sum(1 for item in manifest if item.get("status") == "skipped")
        if report.failed_count > 0 or skipped_count > 0:
            fallback_text = self._format_media_fallback_text(assets) if assets else self._format_media_fallback_text_from_paths(artifact_paths)
            self._send_lark_text(
                chat_id=chat_id,
                text=fallback_text,
                credentials=credentials,
            )
            if not report.fallback_reason:
                report.fallback_reason = "media_delivery_failed"

        report.manifest_json = json.dumps(manifest, ensure_ascii=False)
        return report

    def _deliver_telegram_media_assets(
        self,
        *,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
        thread_id: str,
        workspace_id: str,
        artifact_paths: list[str],
    ) -> ChannelMediaDeliveryReport:
        report = ChannelMediaDeliveryReport()
        if not self._media_reply_enabled or not artifact_paths:
            return report

        bot_token = _safe_text(credentials.get("bot_token"))
        if not bot_token:
            report.fallback_reason = "missing_bot_token"
            return report

        chat_id = _safe_text(incoming.chat_id)
        if not chat_id:
            report.fallback_reason = "missing_chat_id"
            return report

        assets, manifest = self._build_media_assets(
            thread_id=thread_id,
            workspace_id=workspace_id,
            artifact_paths=artifact_paths,
        )

        max_attachments = self._media_max_attachments_per_reply
        selected_assets = assets[:max_attachments]
        if len(assets) > max_attachments:
            for asset in assets[max_attachments:]:
                self._update_media_manifest_item(
                    manifest,
                    asset,
                    status="skipped",
                    reason="exceed_max_attachments",
                )

        # Telegram limits: image 10MB, document 50MB (cap by env settings).
        filtered_assets: list[ChannelMediaAsset] = []
        for asset in selected_assets:
            if asset.media_kind == "image":
                platform_limit = 10 * 1024 * 1024
                env_limit = self._media_max_image_bytes
            else:
                platform_limit = 50 * 1024 * 1024
                env_limit = self._media_max_file_bytes
            effective_limit = min(platform_limit, env_limit)
            if asset.size_bytes > effective_limit:
                self._update_media_manifest_item(
                    manifest,
                    asset,
                    status="skipped",
                    reason=f"file_too_large>{effective_limit}",
                )
                continue
            filtered_assets.append(asset)
        selected_assets = filtered_assets

        if not selected_assets:
            skipped_count = sum(1 for item in manifest if item.get("status") == "skipped")
            if skipped_count > 0:
                fallback_text = self._format_media_fallback_text(assets) if assets else self._format_media_fallback_text_from_paths(artifact_paths)
                self._send_telegram_text(
                    chat_id=chat_id,
                    text=fallback_text,
                    credentials=credentials,
                )
                report.fallback_reason = "media_skipped"
            report.manifest_json = json.dumps(manifest, ensure_ascii=False)
            return report

        with httpx.Client(timeout=self._run_timeout_seconds) as client:
            for asset in selected_assets:
                report.attempted_count += 1
                mime_type = mimetypes.guess_type(asset.file_name)[0] or "application/octet-stream"

                try:
                    with open(asset.local_path, "rb") as f:
                        if asset.media_kind == "image":
                            endpoint = f"https://api.telegram.org/bot{bot_token}/sendPhoto"
                            files = {"photo": (asset.file_name, f, mime_type)}
                        else:
                            endpoint = f"https://api.telegram.org/bot{bot_token}/sendDocument"
                            files = {"document": (asset.file_name, f, mime_type)}

                        response = client.post(
                            endpoint,
                            data={"chat_id": chat_id},
                            files=files,
                        )
                except Exception as exc:
                    report.failed_count += 1
                    self._update_media_manifest_item(
                        manifest,
                        asset,
                        status="failed",
                        reason=_safe_text(exc) or "media_upload_failed",
                    )
                    if not report.fallback_reason:
                        report.fallback_reason = "media_upload_failed"
                    continue

                if response.status_code >= 400:
                    report.failed_count += 1
                    self._update_media_manifest_item(
                        manifest,
                        asset,
                        status="failed",
                        reason=f"media_delivery_http_{response.status_code}",
                    )
                    if not report.fallback_reason:
                        report.fallback_reason = "media_delivery_failed"
                    continue

                payload = response.json()
                if not bool(payload.get("ok")):
                    report.failed_count += 1
                    self._update_media_manifest_item(
                        manifest,
                        asset,
                        status="failed",
                        reason=_safe_text(payload.get("description") or "media_delivery_failed"),
                    )
                    if not report.fallback_reason:
                        report.fallback_reason = "media_delivery_failed"
                    continue

                report.sent_count += 1
                self._update_media_manifest_item(
                    manifest,
                    asset,
                    status="sent",
                    delivery_path="telegram.api.media",
                )

        skipped_count = sum(1 for item in manifest if item.get("status") == "skipped")
        if report.failed_count > 0 or skipped_count > 0:
            fallback_text = self._format_media_fallback_text(assets) if assets else self._format_media_fallback_text_from_paths(artifact_paths)
            self._send_telegram_text(
                chat_id=chat_id,
                text=fallback_text,
                credentials=credentials,
            )
            if not report.fallback_reason:
                report.fallback_reason = "media_delivery_failed"

        report.manifest_json = json.dumps(manifest, ensure_ascii=False)
        return report

    def _langgraph_thread_exists(self, thread_id: str) -> bool:
        if not thread_id:
            return False
        with httpx.Client(timeout=10.0) as client:
            response = client.get(f"{self._langgraph_base_url}/threads/{thread_id}")
        if response.status_code == 404:
            return False
        if response.status_code >= 400:
            raise RuntimeError(f"Failed to check LangGraph thread: HTTP {response.status_code} {response.text}")
        return True

    def _create_langgraph_thread(
        self,
        *,
        thread_id: str,
        platform: str,
        workspace_id: str,
        incoming: IncomingWebhookEvent,
    ) -> None:
        payload = {
            "thread_id": thread_id,
            "metadata": {
                "workspace_id": workspace_id,
                "channel_platform": platform,
                "channel_chat_id": incoming.chat_id,
                "channel_external_user_id": incoming.external_user_id,
                "channel_external_user_name": incoming.external_user_name,
            },
        }
        with httpx.Client(timeout=10.0) as client:
            response = client.post(f"{self._langgraph_base_url}/threads", json=payload)
        if response.status_code >= 400:
            raise RuntimeError(f"Failed to create LangGraph thread: HTTP {response.status_code} {response.text}")

    def _ensure_thread(
        self,
        platform: str,
        incoming: IncomingWebhookEvent,
        *,
        workspace_id: str,
    ) -> dict[str, Any]:
        if not incoming.chat_id:
            raise ValueError("chat_id is required")
        existing = self._repo.get_chat_thread(platform, incoming.chat_id)
        if existing is not None:
            existing_thread_id = _safe_text(existing.get("thread_id"))
            if existing_thread_id:
                existing_workspace_id = _safe_text(existing.get("workspace_id"))
                if existing_workspace_id and existing_workspace_id != workspace_id:
                    binding_repo = get_thread_workspace_binding_repository(paths=self._paths)
                    binding_repo.bind(existing_thread_id, workspace_id, allow_rebind=True)
                    return self._repo.upsert_chat_thread(
                        platform,
                        chat_id=incoming.chat_id,
                        external_user_id=incoming.external_user_id,
                        thread_id=existing_thread_id,
                        workspace_id=workspace_id,
                    )

                if not self._langgraph_thread_exists(existing_thread_id):
                    self._create_langgraph_thread(
                        thread_id=existing_thread_id,
                        platform=platform,
                        workspace_id=workspace_id,
                        incoming=incoming,
                    )
                    binding_repo = get_thread_workspace_binding_repository(paths=self._paths)
                    binding_repo.bind(existing_thread_id, workspace_id, allow_rebind=True)
                    return self._repo.upsert_chat_thread(
                        platform,
                        chat_id=incoming.chat_id,
                        external_user_id=incoming.external_user_id,
                        thread_id=existing_thread_id,
                        workspace_id=workspace_id,
                    )
                return existing

        thread_id = uuid.uuid4().hex
        self._create_langgraph_thread(
            thread_id=thread_id,
            platform=platform,
            workspace_id=workspace_id,
            incoming=incoming,
        )

        binding_repo = get_thread_workspace_binding_repository(paths=self._paths)
        binding_repo.bind(thread_id, workspace_id, allow_rebind=True)

        return self._repo.upsert_chat_thread(
            platform,
            chat_id=incoming.chat_id,
            external_user_id=incoming.external_user_id,
            thread_id=thread_id,
            workspace_id=workspace_id,
        )

    def _resolve_run_settings(
        self,
        *,
        integration: dict[str, Any] | None,
        authorized_user: dict[str, Any] | None,
        thread_id: str,
        workspace_id: str,
        incoming: IncomingWebhookEvent,
    ) -> tuple[str, dict[str, Any] | None, dict[str, Any]]:
        assistant_id = "lead_agent"
        run_config: dict[str, Any] = {}
        run_context: dict[str, Any] = {
            "thread_id": thread_id,
            "workspace_id": workspace_id,
            "user_id": incoming.external_user_id,
            "locale": "zh-CN",
        }

        for layer in (
            integration.get("session") if isinstance(integration, dict) else None,
            authorized_user.get("session_override") if isinstance(authorized_user, dict) else None,
        ):
            if not isinstance(layer, dict):
                continue
            candidate_assistant_id = _safe_text(layer.get("assistant_id"))
            if candidate_assistant_id:
                assistant_id = candidate_assistant_id

            raw_config = layer.get("config")
            if isinstance(raw_config, dict):
                recursion_limit = raw_config.get("recursion_limit")
                if isinstance(recursion_limit, int) and recursion_limit > 0:
                    run_config["recursion_limit"] = recursion_limit

            raw_context = layer.get("context")
            if isinstance(raw_context, dict):
                for key in ("thinking_enabled", "is_plan_mode", "subagent_enabled"):
                    value = raw_context.get(key)
                    if isinstance(value, bool):
                        run_context[key] = value

        return assistant_id, run_config or None, run_context

    def _build_run_payload(
        self,
        *,
        platform: str,
        incoming: IncomingWebhookEvent,
        assistant_id: str,
        run_config: dict[str, Any] | None,
        run_context: dict[str, Any],
        stream_mode: list[str] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "assistant_id": assistant_id,
            "input": {
                "messages": [
                    {
                        "type": "human",
                        "content": [
                            {
                                "type": "text",
                                "text": incoming.text,
                            }
                        ],
                    }
                ]
            },
            "context": run_context,
            "metadata": {
                "channel_platform": platform,
                "channel_chat_id": incoming.chat_id,
                "channel_external_user_id": incoming.external_user_id,
                "channel_external_user_name": incoming.external_user_name,
                "channel_event_id": incoming.event_id,
            },
        }
        if run_config:
            payload["config"] = run_config
        if stream_mode is not None:
            payload["stream_mode"] = stream_mode
        return payload

    def _run_agent(
        self,
        *,
        platform: str,
        thread_id: str,
        incoming: IncomingWebhookEvent,
        assistant_id: str,
        run_config: dict[str, Any] | None,
        run_context: dict[str, Any],
    ) -> ChannelReplyBundle:
        if not incoming.text:
            raise ValueError("incoming text is empty")

        payload = self._build_run_payload(
            platform=platform,
            incoming=incoming,
            assistant_id=assistant_id,
            run_config=run_config,
            run_context=run_context,
        )
        with httpx.Client(timeout=self._run_timeout_seconds) as client:
            response = client.post(
                f"{self._langgraph_base_url}/threads/{thread_id}/runs/wait",
                json=payload,
            )
        if response.status_code >= 400:
            raise RuntimeError(f"LangGraph run failed: HTTP {response.status_code} {response.text}")
        result_payload = response.json()
        artifact_candidates = _collect_artifacts_from_payload(result_payload)
        artifact_candidates.extend(_collect_present_files_from_tool_calls(result_payload))
        deduped_artifacts = _dedupe_artifact_paths(thread_id, artifact_candidates)
        text = _extract_last_assistant_text(result_payload)
        if text:
            return ChannelReplyBundle(reply_text=text, artifacts=deduped_artifacts)
        return ChannelReplyBundle(reply_text="已收到你的消息并完成处理。", artifacts=deduped_artifacts)

    def _run_agent_stream(
        self,
        *,
        platform: str,
        thread_id: str,
        incoming: IncomingWebhookEvent,
        assistant_id: str,
        run_config: dict[str, Any] | None,
        run_context: dict[str, Any],
        on_partial: Callable[[str], None] | None = None,
    ) -> ChannelReplyBundle:
        if not incoming.text:
            raise ValueError("incoming text is empty")

        payload = self._build_run_payload(
            platform=platform,
            incoming=incoming,
            assistant_id=assistant_id,
            run_config=run_config,
            run_context=run_context,
            stream_mode=["messages", "values", "custom"],
        )

        event_name: str | None = None
        data_lines: list[str] = []
        streamed_text = ""
        final_text_from_values: str | None = None
        last_emitted_text = ""
        last_emit_at = 0.0
        emit_interval = self._stream_emit_interval_seconds
        collected_artifact_paths: list[str] = []

        def flush_event() -> None:
            nonlocal event_name
            nonlocal data_lines
            nonlocal final_text_from_values
            nonlocal streamed_text
            nonlocal last_emitted_text
            nonlocal last_emit_at

            parsed = _parse_sse_event_data(data_lines)
            current_event = _safe_text(event_name).lower()

            if current_event == "messages":
                for chunk in _collect_message_chunks(parsed):
                    streamed_text = _merge_stream_text(streamed_text, chunk)
                collected_artifact_paths.extend(_collect_present_files_from_tool_calls(parsed))

                if on_partial:
                    current_text = streamed_text.strip()
                    now = time.monotonic()
                    should_emit = current_text and current_text != last_emitted_text and now - last_emit_at >= emit_interval
                    if should_emit:
                        on_partial(current_text)
                        last_emitted_text = current_text
                        last_emit_at = now
            elif current_event == "values" and isinstance(parsed, dict):
                final_candidate = _extract_last_assistant_text(parsed)
                if final_candidate:
                    final_text_from_values = final_candidate
                collected_artifact_paths.extend(_collect_artifacts_from_payload(parsed))
                collected_artifact_paths.extend(_collect_present_files_from_tool_calls(parsed))

            event_name = None
            data_lines = []

        with httpx.Client(timeout=self._run_timeout_seconds) as client:
            with client.stream(
                "POST",
                f"{self._langgraph_base_url}/threads/{thread_id}/runs/stream",
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    try:
                        detail = response.read().decode("utf-8", errors="ignore")
                    except Exception:
                        detail = ""
                    raise RuntimeError(f"LangGraph stream failed: HTTP {response.status_code} {detail}")
                for line in response.iter_lines():
                    if line is None:
                        continue
                    stripped = line.strip()
                    if not stripped:
                        flush_event()
                        continue
                    if stripped.startswith("event:"):
                        event_name = stripped.split(":", 1)[1].strip()
                        continue
                    if stripped.startswith("data:"):
                        data_lines.append(stripped.split(":", 1)[1].strip())

        # Flush final buffered event if response does not end with blank line.
        if event_name is not None or data_lines:
            flush_event()

        combined_text = streamed_text.strip()
        final_text = final_text_from_values or combined_text
        if final_text and on_partial and final_text != last_emitted_text:
            on_partial(final_text)
        deduped_artifacts = _dedupe_artifact_paths(thread_id, collected_artifact_paths)
        if final_text:
            return ChannelReplyBundle(reply_text=final_text, artifacts=deduped_artifacts)
        return ChannelReplyBundle(
            reply_text="已收到你的消息并完成处理。",
            artifacts=deduped_artifacts,
        )

    def _get_dingtalk_access_token(
        self,
        *,
        credentials: dict[str, str],
    ) -> str:
        client_id = _safe_text(credentials.get("client_id") or credentials.get("app_key"))
        client_secret = _safe_text(credentials.get("client_secret") or credentials.get("app_secret"))
        if not client_id or not client_secret:
            raise RuntimeError("missing client_id/client_secret")

        with httpx.Client(timeout=15.0) as client:
            token_resp = client.post(
                "https://api.dingtalk.com/v1.0/oauth2/accessToken",
                json={"appKey": client_id, "appSecret": client_secret},
            )
        if token_resp.status_code >= 400:
            raise RuntimeError(f"token http {token_resp.status_code}")
        token_payload = token_resp.json()
        access_token = _safe_text(token_payload.get("accessToken"))
        if not access_token:
            raise RuntimeError(_safe_text(token_payload.get("errmsg") or "missing accessToken"))
        return access_token

    def _resolve_dingtalk_card_template_id(self, credentials: dict[str, str]) -> str:
        configured = _safe_text(credentials.get("card_template_id") or credentials.get("ai_card_template_id") or credentials.get("template_id"))
        return configured or _DINGTALK_AI_CARD_TEMPLATE_ID

    def _resolve_dingtalk_card_template_candidates(self, credentials: dict[str, str]) -> list[str]:
        configured = _safe_text(credentials.get("card_template_id") or credentials.get("ai_card_template_id") or credentials.get("template_id"))
        custom_first = _env_flag(
            "NION_CHANNEL_CARD_TEMPLATE_CUSTOM_FIRST",
            default=False,
        )
        candidates: list[str] = []
        fallback_enabled = _env_flag("NION_CHANNEL_CARD_TEMPLATE_FALLBACK", default=True)
        if configured and custom_first:
            candidates.append(configured)
            if fallback_enabled and _DINGTALK_AI_CARD_TEMPLATE_ID not in candidates:
                candidates.append(_DINGTALK_AI_CARD_TEMPLATE_ID)
        else:
            candidates.append(_DINGTALK_AI_CARD_TEMPLATE_ID)
            if configured and configured not in candidates:
                candidates.append(configured)
        if not candidates:
            candidates.append(_DINGTALK_AI_CARD_TEMPLATE_ID)
        return candidates

    def _build_dingtalk_card_param_map(
        self,
        *,
        content: str,
        flow_status: str,
    ) -> dict[str, Any]:
        normalized = content[:4000]
        # Compatibility map: different templates may bind to different keys.
        return {
            "flowStatus": flow_status,
            "msgContent": normalized,
            "staticMsgContent": normalized if flow_status in {"3", "5"} else "",
            "content": normalized,
            "answer": normalized,
            "text": normalized,
            "markdown": normalized,
            "summary": normalized,
            "output": normalized,
            "sys_full_json_obj": json.dumps({"order": ["msgContent", "content", "answer", "text", "markdown", "summary", "output"]}),
        }

    def _dingtalk_api_request(
        self,
        *,
        method: str,
        path: str,
        access_token: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        with httpx.Client(timeout=20.0) as client:
            response = client.request(
                method.upper(),
                f"https://api.dingtalk.com{path}",
                headers={
                    "x-acs-dingtalk-access-token": access_token,
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if response.status_code >= 400:
            raise RuntimeError(f"dingtalk api {path} http {response.status_code}: {response.text}")
        try:
            return response.json()
        except json.JSONDecodeError:
            return {}

    def _create_dingtalk_ai_card(
        self,
        *,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
    ) -> _DingTalkAICardSession:
        last_error: Exception | None = None
        for template_id in self._resolve_dingtalk_card_template_candidates(credentials):
            try:
                return self._create_dingtalk_ai_card_once(
                    credentials=credentials,
                    incoming=incoming,
                    card_template_id=template_id,
                )
            except Exception as exc:  # pragma: no cover - network path
                last_error = exc
                continue
        raise RuntimeError(f"failed to create dingtalk ai card: {last_error}")

    def _create_dingtalk_ai_card_once(
        self,
        *,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
        card_template_id: str,
    ) -> _DingTalkAICardSession:
        try:
            return self._create_dingtalk_ai_card_create_and_deliver(
                credentials=credentials,
                incoming=incoming,
                card_template_id=card_template_id,
            )
        except Exception as create_and_deliver_error:
            try:
                return self._create_dingtalk_ai_card_legacy(
                    credentials=credentials,
                    incoming=incoming,
                    card_template_id=card_template_id,
                )
            except Exception as legacy_error:
                raise RuntimeError(f"createAndDeliver failed: {create_and_deliver_error}; legacy fallback failed: {legacy_error}") from legacy_error

    def _create_dingtalk_ai_card_create_and_deliver(
        self,
        *,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
        card_template_id: str,
    ) -> _DingTalkAICardSession:
        access_token = self._get_dingtalk_access_token(credentials=credentials)
        out_track_id = f"nion_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        robot_code = _safe_text(credentials.get("robot_code")) or _safe_text(credentials.get("client_id"))

        payload: dict[str, Any] = {
            "cardTemplateId": card_template_id,
            "outTrackId": out_track_id,
            "cardData": {"cardParamMap": {}},
            "callbackType": "STREAM",
            "imGroupOpenSpaceModel": {"supportForward": True},
            "imRobotOpenSpaceModel": {"supportForward": True},
        }

        if _is_dingtalk_group_chat(incoming):
            chat_id = _safe_text(incoming.chat_id)
            if not chat_id:
                raise RuntimeError("missing openConversationId for group card delivery")
            payload.update(
                {
                    "openSpaceId": f"dtv1.card//IM_GROUP.{chat_id}",
                    "userIdType": 1,
                    "imGroupOpenDeliverModel": {"robotCode": robot_code},
                }
            )
        else:
            user_id = _safe_text(incoming.external_user_id)
            chat_id = _safe_text(incoming.chat_id)
            if user_id:
                payload.update(
                    {
                        "openSpaceId": f"dtv1.card//IM_ROBOT.{user_id}",
                        "userIdType": 1,
                        "imRobotOpenDeliverModel": {
                            "spaceType": "IM_ROBOT",
                            "robotCode": robot_code,
                        },
                    }
                )
            elif chat_id:
                payload.update(
                    {
                        "openSpaceId": f"dtv1.card//IM_GROUP.{chat_id}",
                        "userIdType": 1,
                        "imGroupOpenDeliverModel": {"robotCode": robot_code},
                    }
                )
            else:
                raise RuntimeError("missing user id and chat id for private card delivery")

        self._dingtalk_api_request(
            method="POST",
            path="/v1.0/card/instances/createAndDeliver",
            access_token=access_token,
            payload=payload,
        )

        return _DingTalkAICardSession(
            out_track_id=out_track_id,
            flow_inputing_started=False,
            template_id=card_template_id,
        )

    def _create_dingtalk_ai_card_legacy(
        self,
        *,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
        card_template_id: str,
    ) -> _DingTalkAICardSession:
        access_token = self._get_dingtalk_access_token(credentials=credentials)
        out_track_id = f"nion_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"

        self._dingtalk_api_request(
            method="POST",
            path="/v1.0/card/instances",
            access_token=access_token,
            payload={
                "cardTemplateId": card_template_id,
                "outTrackId": out_track_id,
                "cardData": {"cardParamMap": {}},
                "callbackType": "STREAM",
                "imGroupOpenSpaceModel": {"supportForward": True},
                "imRobotOpenSpaceModel": {"supportForward": True},
            },
        )

        robot_code = _safe_text(credentials.get("robot_code")) or _safe_text(credentials.get("client_id"))
        if _is_dingtalk_group_chat(incoming):
            chat_id = _safe_text(incoming.chat_id)
            if not chat_id:
                raise RuntimeError("missing openConversationId for group card delivery")
            self._dingtalk_api_request(
                method="POST",
                path="/v1.0/card/instances/deliver",
                access_token=access_token,
                payload={
                    "outTrackId": out_track_id,
                    "openSpaceId": f"dtv1.card//IM_GROUP.{chat_id}",
                    "userIdType": 1,
                    "imGroupOpenDeliverModel": {"robotCode": robot_code},
                },
            )
        else:
            user_id = _safe_text(incoming.external_user_id)
            chat_id = _safe_text(incoming.chat_id)
            deliver_errors: list[str] = []
            delivered = False

            if user_id:
                for user_id_type in (1, 2):
                    try:
                        self._dingtalk_api_request(
                            method="POST",
                            path="/v1.0/card/instances/deliver",
                            access_token=access_token,
                            payload={
                                "outTrackId": out_track_id,
                                "openSpaceId": f"dtv1.card//IM_ROBOT.{user_id}",
                                "userIdType": user_id_type,
                                "imRobotOpenDeliverModel": {
                                    "spaceType": "IM_ROBOT",
                                    "robotCode": robot_code,
                                },
                            },
                        )
                        delivered = True
                        break
                    except Exception as exc:  # pragma: no cover - network path
                        deliver_errors.append(f"IM_ROBOT(userIdType={user_id_type}): {exc}")

            # Compatibility fallback: some private chats expose encrypted sender id.
            # Use openConversationId delivery path when user-id route is unavailable.
            if not delivered and chat_id:
                try:
                    self._dingtalk_api_request(
                        method="POST",
                        path="/v1.0/card/instances/deliver",
                        access_token=access_token,
                        payload={
                            "outTrackId": out_track_id,
                            "openSpaceId": f"dtv1.card//IM_GROUP.{chat_id}",
                            "userIdType": 1,
                            "imGroupOpenDeliverModel": {"robotCode": robot_code},
                        },
                    )
                    delivered = True
                except Exception as exc:  # pragma: no cover - network path
                    deliver_errors.append(f"IM_GROUP(chat fallback): {exc}")

            if not delivered:
                raise RuntimeError("private card delivery failed: " + "; ".join(deliver_errors or ["missing user id and chat id"]))

        return _DingTalkAICardSession(
            out_track_id=out_track_id,
            flow_inputing_started=False,
            template_id=card_template_id,
        )

    def _stream_dingtalk_ai_card(
        self,
        *,
        credentials: dict[str, str],
        session: _DingTalkAICardSession,
        content: str,
        is_finalize: bool = False,
        is_error: bool = False,
    ) -> None:
        access_token = self._get_dingtalk_access_token(credentials=credentials)
        normalized = content[:4000]
        if not session.flow_inputing_started:
            self._dingtalk_api_request(
                method="PUT",
                path="/v1.0/card/instances",
                access_token=access_token,
                payload={
                    "outTrackId": session.out_track_id,
                    "cardData": {
                        "cardParamMap": self._build_dingtalk_card_param_map(
                            content=normalized,
                            flow_status="2",
                        )
                    },
                },
            )
            session.flow_inputing_started = True

        if session.stream_api_available:
            try:
                self._dingtalk_api_request(
                    method="PUT",
                    path="/v1.0/card/streaming",
                    access_token=access_token,
                    payload={
                        "outTrackId": session.out_track_id,
                        "key": "msgContent",
                        "content": normalized,
                        "isFull": True,
                        "isFinalize": bool(is_finalize),
                        "isError": bool(is_error),
                        "guid": f"{int(time.time() * 1000)}_{random.randint(1000, 9999)}",
                    },
                )
                return
            except Exception:
                # Compatibility fallback: some DingTalk environments reject /card/streaming
                # with unknownError even though card creation/delivery succeeds.
                session.stream_api_available = False

        self._dingtalk_api_request(
            method="PUT",
            path="/v1.0/card/instances",
            access_token=access_token,
            payload={
                "outTrackId": session.out_track_id,
                "cardData": {
                    "cardParamMap": self._build_dingtalk_card_param_map(
                        content=normalized,
                        flow_status="2",
                    )
                },
            },
        )

    def _finish_dingtalk_ai_card(
        self,
        *,
        credentials: dict[str, str],
        session: _DingTalkAICardSession,
        final_content: str,
        failed: bool = False,
    ) -> None:
        access_token = self._get_dingtalk_access_token(credentials=credentials)
        status = "5" if failed else "3"  # FAILED / FINISHED
        self._dingtalk_api_request(
            method="PUT",
            path="/v1.0/card/instances",
            access_token=access_token,
            payload={
                "outTrackId": session.out_track_id,
                "cardData": {
                    "cardParamMap": self._build_dingtalk_card_param_map(
                        content=final_content,
                        flow_status=status,
                    )
                },
            },
        )

    def _send_dingtalk_ai_card_notification(
        self,
        *,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
        text: str,
    ) -> ChannelDeliveryResult:
        try:
            session = self._create_dingtalk_ai_card(
                credentials=credentials,
                incoming=incoming,
            )
            self._stream_dingtalk_ai_card(
                credentials=credentials,
                session=session,
                content=text,
                is_finalize=False,
                is_error=False,
            )
            self._finish_dingtalk_ai_card(
                credentials=credentials,
                session=session,
                final_content=text,
                failed=False,
            )
            return ChannelDeliveryResult(
                delivered=True,
                message="delivered via dingtalk ai card",
                delivery_path="dingtalk.ai_card",
                render_mode="card_stream",
            )
        except Exception as exc:
            reason = f"ai card notify failed: {exc}"
            return ChannelDeliveryResult(
                delivered=False,
                message=reason,
                delivery_path="dingtalk.ai_card",
                render_mode="card_stream",
                fallback_reason=reason,
            )

    def send_pairing_approved_message_with_meta(
        self,
        platform: str,
        *,
        incoming: IncomingWebhookEvent,
        text: str,
    ) -> ChannelDeliveryResult:
        normalized_platform = _safe_text(platform).lower()
        if normalized_platform != "dingtalk":
            return self.send_system_message_with_meta(
                normalized_platform,
                incoming=incoming,
                text=text,
            )

        integration = self._repo.get_integration("dingtalk")
        if not bool(integration.get("enabled")):
            return ChannelDeliveryResult(
                delivered=False,
                message="channel integration is disabled",
                delivery_path="dingtalk.disabled",
                render_mode="text",
            )
        mode = _safe_text(integration.get("mode") or "webhook") or "webhook"
        if mode != "stream":
            return self.send_system_message_with_meta(
                "dingtalk",
                incoming=incoming,
                text=text,
            )

        credentials = integration.get("credentials", {})
        card_result = self._send_dingtalk_ai_card_notification(
            credentials=credentials,
            incoming=incoming,
            text=text,
        )
        if card_result.delivered:
            return card_result

        fallback = self.send_system_message_with_meta(
            "dingtalk",
            incoming=incoming,
            text=text,
        )
        if not fallback.fallback_reason:
            fallback.fallback_reason = card_result.fallback_reason or "ai card notify failed; fallback text"
        return fallback

    def _get_lark_tenant_access_token(
        self,
        *,
        credentials: dict[str, str],
    ) -> str:
        app_id = _safe_text(credentials.get("app_id") or credentials.get("cli_a"))
        app_secret = _safe_text(credentials.get("app_secret") or credentials.get("secret"))
        if not app_id or not app_secret:
            raise RuntimeError("missing app_id/app_secret")

        with httpx.Client(timeout=15.0) as client:
            token_resp = client.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": app_id, "app_secret": app_secret},
            )
            if token_resp.status_code >= 400:
                raise RuntimeError(f"token http {token_resp.status_code}")
            token_payload = token_resp.json()
            if int(token_payload.get("code") or 0) != 0:
                raise RuntimeError(_safe_text(token_payload.get("msg") or "token failed"))
            token = _safe_text(token_payload.get("tenant_access_token"))
            if not token:
                raise RuntimeError("missing tenant_access_token")
            return token

    def _send_lark_text_with_message_id(
        self,
        *,
        chat_id: str,
        text: str,
        credentials: dict[str, str],
    ) -> tuple[ChannelDeliveryResult, str | None]:
        try:
            token = self._get_lark_tenant_access_token(credentials=credentials)
        except Exception as exc:
            return (
                ChannelDeliveryResult(
                    delivered=False,
                    message=_safe_text(exc) or "lark token failed",
                    delivery_path="lark.api",
                    render_mode="text",
                ),
                None,
            )

        with httpx.Client(timeout=15.0) as client:
            message_resp = client.post(
                "https://open.feishu.cn/open-apis/im/v1/messages",
                params={"receive_id_type": "chat_id"},
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "receive_id": chat_id,
                    "msg_type": "text",
                    "content": json.dumps({"text": text[:3000]}, ensure_ascii=False),
                },
            )
            if message_resp.status_code >= 400:
                return (
                    ChannelDeliveryResult(
                        delivered=False,
                        message=f"send http {message_resp.status_code}",
                        delivery_path="lark.api",
                        render_mode="text",
                    ),
                    None,
                )
            message_payload = message_resp.json()
            if int(message_payload.get("code") or 0) != 0:
                return (
                    ChannelDeliveryResult(
                        delivered=False,
                        message=_safe_text(message_payload.get("msg") or "send failed"),
                        delivery_path="lark.api",
                        render_mode="text",
                    ),
                    None,
                )
            message_id = _safe_text((message_payload.get("data") or {}).get("message_id") if isinstance(message_payload.get("data"), dict) else None)
        return (
            ChannelDeliveryResult(
                delivered=True,
                message="delivered",
                delivery_path="lark.api",
                render_mode="text",
            ),
            message_id or None,
        )

    def _update_lark_text_message(
        self,
        *,
        message_id: str,
        text: str,
        credentials: dict[str, str],
    ) -> ChannelDeliveryResult:
        normalized_message_id = _safe_text(message_id)
        if not normalized_message_id:
            return ChannelDeliveryResult(
                delivered=False,
                message="missing message_id",
                delivery_path="lark.api.edit",
                render_mode="editable_stream",
            )
        try:
            token = self._get_lark_tenant_access_token(credentials=credentials)
        except Exception as exc:
            return ChannelDeliveryResult(
                delivered=False,
                message=_safe_text(exc) or "lark token failed",
                delivery_path="lark.api.edit",
                render_mode="editable_stream",
            )
        with httpx.Client(timeout=15.0) as client:
            edit_resp = client.patch(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{normalized_message_id}",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "msg_type": "text",
                    "content": json.dumps({"text": text[:3000]}, ensure_ascii=False),
                },
            )
            if edit_resp.status_code >= 400:
                return ChannelDeliveryResult(
                    delivered=False,
                    message=f"edit http {edit_resp.status_code}",
                    delivery_path="lark.api.edit",
                    render_mode="editable_stream",
                )
            edit_payload = edit_resp.json()
            if int(edit_payload.get("code") or 0) != 0:
                return ChannelDeliveryResult(
                    delivered=False,
                    message=_safe_text(edit_payload.get("msg") or "edit failed"),
                    delivery_path="lark.api.edit",
                    render_mode="editable_stream",
                )
        return ChannelDeliveryResult(
            delivered=True,
            message="edited",
            delivery_path="lark.api.edit",
            render_mode="editable_stream",
        )

    def _send_lark_text(
        self,
        *,
        chat_id: str,
        text: str,
        credentials: dict[str, str],
    ) -> ChannelDeliveryResult:
        result, _message_id = self._send_lark_text_with_message_id(
            chat_id=chat_id,
            text=text,
            credentials=credentials,
        )
        return result

    def _build_dingtalk_signed_webhook(self, webhook_url: str, secret: str | None) -> str:
        if not secret:
            return webhook_url
        timestamp = str(int(time.time() * 1000))
        string_to_sign = f"{timestamp}\n{secret}".encode()
        digest = hmac.new(secret.encode(), string_to_sign, hashlib.sha256).digest()
        sign = urllib.parse.quote_plus(base64.b64encode(digest))
        separator = "&" if "?" in webhook_url else "?"
        return f"{webhook_url}{separator}timestamp={timestamp}&sign={sign}"

    def _send_dingtalk_text_via_webhook(
        self,
        *,
        text: str,
        webhook_url: str,
        path: str,
    ) -> ChannelDeliveryResult:
        if not webhook_url:
            return ChannelDeliveryResult(
                delivered=False,
                message="missing webhook_url",
                delivery_path=path,
                render_mode="text",
            )
        with httpx.Client(timeout=15.0) as client:
            response = client.post(
                webhook_url,
                json={"msgtype": "text", "text": {"content": text[:3000]}},
            )
            if response.status_code >= 400:
                return ChannelDeliveryResult(
                    delivered=False,
                    message=f"send http {response.status_code}",
                    delivery_path=path,
                    render_mode="text",
                )
            payload = response.json()
            if int(payload.get("errcode") or 0) != 0:
                return ChannelDeliveryResult(
                    delivered=False,
                    message=_safe_text(payload.get("errmsg") or "send failed"),
                    delivery_path=path,
                    render_mode="text",
                )
        return ChannelDeliveryResult(
            delivered=True,
            message="delivered",
            delivery_path=path,
            render_mode="text",
        )

    def _send_dingtalk_text_via_api(
        self,
        *,
        text: str,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
    ) -> ChannelDeliveryResult:
        client_id = _safe_text(credentials.get("client_id") or credentials.get("app_key"))
        client_secret = _safe_text(credentials.get("client_secret") or credentials.get("app_secret"))
        if not client_id or not client_secret:
            return ChannelDeliveryResult(
                delivered=False,
                message="missing client_id/client_secret",
                delivery_path="dingtalk.api",
                render_mode="text",
            )

        robot_code = _safe_text(credentials.get("robot_code")) or client_id
        if not robot_code:
            return ChannelDeliveryResult(
                delivered=False,
                message="missing robot_code",
                delivery_path="dingtalk.api",
                render_mode="text",
            )

        is_group = _is_dingtalk_group_chat(incoming)
        markdown_payload = {
            "msgKey": "sampleMarkdown",
            "msgParam": json.dumps(
                {
                    "title": "Nion",
                    "text": text[:3000],
                },
                ensure_ascii=False,
            ),
        }

        with httpx.Client(timeout=15.0) as client:
            token_resp = client.post(
                "https://api.dingtalk.com/v1.0/oauth2/accessToken",
                json={"appKey": client_id, "appSecret": client_secret},
            )
            if token_resp.status_code >= 400:
                return ChannelDeliveryResult(
                    delivered=False,
                    message=f"token http {token_resp.status_code}",
                    delivery_path="dingtalk.api",
                    render_mode="text",
                )
            token_payload = token_resp.json()
            access_token = _safe_text(token_payload.get("accessToken"))
            if not access_token:
                return ChannelDeliveryResult(
                    delivered=False,
                    message=_safe_text(token_payload.get("errmsg") or "missing accessToken"),
                    delivery_path="dingtalk.api",
                    render_mode="text",
                )

            headers = {
                "x-acs-dingtalk-access-token": access_token,
                "Content-Type": "application/json",
            }

            def _send_request(url: str, payload: dict[str, Any], path: str) -> ChannelDeliveryResult:
                send_resp = client.post(url, headers=headers, json=payload)
                if send_resp.status_code >= 400:
                    try:
                        error_payload = send_resp.json()
                    except Exception:
                        error_payload = {}
                    error_message = _safe_text(error_payload.get("errmsg") or error_payload.get("message") or send_resp.text)
                    if error_message:
                        return ChannelDeliveryResult(
                            delivered=False,
                            message=f"send http {send_resp.status_code}: {error_message}",
                            delivery_path=path,
                            render_mode="text",
                        )
                    return ChannelDeliveryResult(
                        delivered=False,
                        message=f"send http {send_resp.status_code}",
                        delivery_path=path,
                        render_mode="text",
                    )
                payload = send_resp.json()
                if int(payload.get("errcode") or 0) != 0:
                    return ChannelDeliveryResult(
                        delivered=False,
                        message=_safe_text(payload.get("errmsg") or "send failed"),
                        delivery_path=path,
                        render_mode="text",
                    )
                return ChannelDeliveryResult(
                    delivered=True,
                    message="delivered",
                    delivery_path=path,
                    render_mode="text",
                )

            if is_group:
                if not incoming.chat_id:
                    return ChannelDeliveryResult(
                        delivered=False,
                        message="missing openConversationId",
                        delivery_path="dingtalk.api.group",
                        render_mode="text",
                    )
                return _send_request(
                    "https://api.dingtalk.com/v1.0/robot/groupMessages/send",
                    {
                        "robotCode": robot_code,
                        "openConversationId": incoming.chat_id,
                        **markdown_payload,
                    },
                    "dingtalk.api.group",
                )

            user_id = _safe_text(incoming.external_user_id)
            if not user_id:
                return ChannelDeliveryResult(
                    delivered=False,
                    message="missing user id",
                    delivery_path="dingtalk.api.oto",
                    render_mode="text",
                )

            oto_result = _send_request(
                "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend",
                {
                    "robotCode": robot_code,
                    "userIds": [user_id],
                    **markdown_payload,
                },
                "dingtalk.api.oto",
            )
            if oto_result.delivered:
                return oto_result

            # Some stream payloads expose encrypted user identifiers that fail oTo API.
            # Fallback to openConversationId delivery if available.
            conversation_id = _safe_text(incoming.chat_id)
            if conversation_id:
                fallback_result = _send_request(
                    "https://api.dingtalk.com/v1.0/robot/groupMessages/send",
                    {
                        "robotCode": robot_code,
                        "openConversationId": conversation_id,
                        **markdown_payload,
                    },
                    "dingtalk.api.group-fallback",
                )
                if fallback_result.delivered:
                    fallback_result.fallback_reason = "oTo delivery failed; fallback to groupMessages/send"
                    return fallback_result
                return ChannelDeliveryResult(
                    delivered=False,
                    message=(f"{_safe_text(oto_result.message)}; fallback group failed: {_safe_text(fallback_result.message)}"),
                    delivery_path="dingtalk.api",
                    render_mode="text",
                    fallback_reason="oTo and group fallback both failed",
                )
            return oto_result

    def _send_dingtalk_text(
        self,
        *,
        text: str,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
    ) -> ChannelDeliveryResult:
        session_webhook = _safe_text(incoming.session_webhook)
        if session_webhook:
            webhook_result = self._send_dingtalk_text_via_webhook(
                text=text,
                webhook_url=session_webhook,
                path="dingtalk.session_webhook",
            )
            if webhook_result.delivered:
                return webhook_result

        api_result = self._send_dingtalk_text_via_api(
            text=text,
            credentials=credentials,
            incoming=incoming,
        )
        if api_result.delivered:
            return api_result

        # Backward compatibility: static robot webhook.
        webhook_url = _safe_text(credentials.get("webhook_url"))
        if webhook_url:
            signed_url = self._build_dingtalk_signed_webhook(
                webhook_url,
                _safe_text(credentials.get("signing_secret")),
            )
            webhook_result = self._send_dingtalk_text_via_webhook(
                text=text,
                webhook_url=signed_url,
                path="dingtalk.static_webhook",
            )
            if webhook_result.delivered:
                webhook_result.fallback_reason = api_result.fallback_reason or "api delivery failed; fallback static webhook"
                return webhook_result
            return ChannelDeliveryResult(
                delivered=False,
                message=(f"{_safe_text(api_result.message)}; fallback webhook failed: {_safe_text(webhook_result.message)}"),
                delivery_path="dingtalk",
                render_mode="text",
                fallback_reason="api and static webhook both failed",
            )

        return api_result

    def _send_telegram_text(
        self,
        *,
        chat_id: str,
        text: str,
        credentials: dict[str, str],
    ) -> ChannelDeliveryResult:
        bot_token = _safe_text(credentials.get("bot_token"))
        if not bot_token:
            return ChannelDeliveryResult(
                delivered=False,
                message="missing bot_token",
                delivery_path="telegram.api",
                render_mode="text",
            )
        normalized_chat_id = _safe_text(chat_id)
        if not normalized_chat_id:
            return ChannelDeliveryResult(
                delivered=False,
                message="missing chat_id",
                delivery_path="telegram.api",
                render_mode="text",
            )

        endpoint = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        with httpx.Client(timeout=15.0) as client:
            response = client.post(
                endpoint,
                json={
                    "chat_id": normalized_chat_id,
                    "text": text[:3000],
                },
            )
            if response.status_code >= 400:
                return ChannelDeliveryResult(
                    delivered=False,
                    message=f"send http {response.status_code}",
                    delivery_path="telegram.api",
                    render_mode="text",
                )
            payload = response.json()
            if not bool(payload.get("ok")):
                return ChannelDeliveryResult(
                    delivered=False,
                    message=_safe_text(payload.get("description") or "send failed"),
                    delivery_path="telegram.api",
                    render_mode="text",
                )
        return ChannelDeliveryResult(
            delivered=True,
            message="delivered",
            delivery_path="telegram.api",
            render_mode="text",
        )

    def _deliver_reply(
        self,
        platform: str,
        *,
        chat_id: str,
        text: str,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
    ) -> ChannelDeliveryResult:
        if platform == "lark":
            return self._send_lark_text(chat_id=chat_id, text=text, credentials=credentials)
        if platform == "dingtalk":
            _ = chat_id  # robot webhook does not require chat_id explicitly
            return self._send_dingtalk_text(text=text, credentials=credentials, incoming=incoming)
        if platform == "telegram":
            return self._send_telegram_text(chat_id=chat_id, text=text, credentials=credentials)
        return ChannelDeliveryResult(
            delivered=False,
            message="unsupported platform",
            delivery_path=f"{platform}.unsupported",
            render_mode="text",
        )

    def send_system_message_with_meta(
        self,
        platform: str,
        *,
        incoming: IncomingWebhookEvent,
        text: str,
    ) -> ChannelDeliveryResult:
        normalized_platform = _safe_text(platform).lower()
        if normalized_platform not in {"lark", "dingtalk", "telegram"}:
            return ChannelDeliveryResult(
                delivered=False,
                message="unsupported platform",
                delivery_path=f"{normalized_platform}.unsupported",
                render_mode="text",
            )
        if not text.strip():
            return ChannelDeliveryResult(
                delivered=False,
                message="empty message",
                delivery_path=f"{normalized_platform}.empty",
                render_mode="text",
            )

        integration = self._repo.get_integration(normalized_platform)
        if not bool(integration.get("enabled")):
            return ChannelDeliveryResult(
                delivered=False,
                message="channel integration is disabled",
                delivery_path=f"{normalized_platform}.disabled",
                render_mode="text",
            )
        credentials = integration.get("credentials", {})

        chat_id = _safe_text(incoming.chat_id)
        if normalized_platform == "lark" and not chat_id:
            return ChannelDeliveryResult(
                delivered=False,
                message="missing chat_id",
                delivery_path="lark.api",
                render_mode="text",
            )
        if normalized_platform == "dingtalk":
            if not chat_id and not _safe_text(incoming.external_user_id):
                return ChannelDeliveryResult(
                    delivered=False,
                    message="missing chat_id and external_user_id",
                    delivery_path="dingtalk.api",
                    render_mode="text",
                )
        if normalized_platform == "telegram" and not chat_id:
            return ChannelDeliveryResult(
                delivered=False,
                message="missing chat_id",
                delivery_path="telegram.api",
                render_mode="text",
            )

        return self._deliver_reply(
            normalized_platform,
            chat_id=chat_id,
            text=text,
            credentials=credentials,
            incoming=incoming,
        )

    def send_system_message(
        self,
        platform: str,
        *,
        incoming: IncomingWebhookEvent,
        text: str,
    ) -> tuple[bool, str]:
        result = self.send_system_message_with_meta(
            platform,
            incoming=incoming,
            text=text,
        )
        return result.delivered, _safe_text(result.message)

    @staticmethod
    def _is_private_chat(incoming: IncomingWebhookEvent) -> bool:
        conversation_type = _safe_text(incoming.conversation_type).lower()
        return conversation_type in {"1", "single", "private", "im"} or "single" in conversation_type

    def _resolve_authorized_user(
        self,
        platform: str,
        incoming: IncomingWebhookEvent,
    ) -> dict[str, Any] | None:
        normalized_external_user_id = _safe_text(incoming.external_user_id)
        if normalized_external_user_id:
            user = self._repo.get_authorized_user(
                platform,
                normalized_external_user_id,
                active_only=True,
            )
            if user is not None:
                return user

        if not _env_flag("NION_CHANNEL_DINGTALK_ID_NORMALIZE", default=True):
            return None
        if platform != "dingtalk" or not self._is_private_chat(incoming):
            return None

        normalized_chat_id = _safe_text(incoming.chat_id)
        if not normalized_chat_id:
            return None
        user = self._repo.get_authorized_user_by_chat(
            platform,
            normalized_chat_id,
            active_only=True,
        )
        if user is None:
            return None
        if not normalized_external_user_id:
            return user
        try:
            return self._repo.rebind_authorized_user_identity(
                platform,
                int(user["id"]),
                external_user_id=normalized_external_user_id,
                external_user_name=incoming.external_user_name,
                chat_id=normalized_chat_id,
            )
        except Exception:
            return user

    def _create_reply_renderer(
        self,
        *,
        platform: str,
        mode: str,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
    ) -> _BaseReplyRenderer:
        renderer_v2_enabled = _env_flag("NION_CHANNEL_RENDERER_V2", default=True)
        if not renderer_v2_enabled:
            return _TextReplyRenderer(
                service=self,
                platform=platform,
                credentials=credentials,
                incoming=incoming,
            )
        if platform == "dingtalk" and mode == "stream":
            return _DingTalkReplyRenderer(
                service=self,
                credentials=credentials,
                incoming=incoming,
            )
        if platform == "lark":
            return _LarkReplyRenderer(
                service=self,
                credentials=credentials,
                incoming=incoming,
            )
        return _TextReplyRenderer(
            service=self,
            platform=platform,
            credentials=credentials,
            incoming=incoming,
        )

    def handle_incoming_text(self, platform: str, incoming: IncomingWebhookEvent) -> ChannelAgentBridgeResult:
        if not incoming.chat_id:
            raise ValueError("chat_id is missing")
        if not incoming.text:
            raise ValueError("text is missing")

        integration = self._repo.get_integration(platform)
        if not bool(integration.get("enabled")):
            raise RuntimeError(f"channel integration '{platform}' is disabled")
        authorized_user = self._resolve_authorized_user(platform, incoming)
        if authorized_user is None:
            raise RuntimeError("user not authorized")
        workspace_id = self._resolve_workspace_id(authorized_user.get("workspace_id") or integration.get("default_workspace_id"))
        thread_mapping = self._ensure_thread(
            platform,
            incoming,
            workspace_id=workspace_id,
        )
        thread_id = _safe_text(thread_mapping.get("thread_id"))
        client_thread_id = _normalize_thread_id_for_client(thread_id)
        assistant_id, run_config, run_context = self._resolve_run_settings(
            integration=integration,
            authorized_user=authorized_user,
            thread_id=thread_id,
            workspace_id=workspace_id,
            incoming=incoming,
        )

        log = self._repo.create_message_log(
            platform,
            chat_id=incoming.chat_id,
            external_user_id=incoming.external_user_id,
            source_event_id=incoming.event_id,
            request_text=incoming.text,
            thread_id=thread_id,
            workspace_id=workspace_id,
        )
        log_id = int(log["id"])
        base_event_payload = {
            "thread_id": client_thread_id,
            "workspace_id": workspace_id,
            "chat_id": _safe_text(incoming.chat_id) or None,
            "external_user_id": _safe_text(incoming.external_user_id) or None,
            "platform": platform,
        }
        self._emit_agent_event(
            platform=platform,
            event_type="agent_started",
            payload={
                **base_event_payload,
                "at": _utcnow(),
                "request_text": _safe_text(incoming.text) or None,
            },
        )

        reply_text = ""
        reply_bundle = ChannelReplyBundle(reply_text="", artifacts=[])
        media_report = ChannelMediaDeliveryReport()
        renderer: _BaseReplyRenderer | None = None
        emit_state_snapshot: Callable[[str, bool], None] | None = None
        try:
            credentials = integration.get("credentials", {})
            mode = _safe_text(integration.get("mode") or "webhook") or "webhook"
            renderer = self._create_reply_renderer(
                platform=platform,
                mode=mode,
                credentials=credentials,
                incoming=incoming,
            )
            renderer.begin()

            last_partial_text = ""
            partial_seq = 0
            state_seq = 0
            last_state_emit_at = 0.0

            def _emit_state_snapshot(source: str, force: bool = False) -> None:
                nonlocal state_seq, last_state_emit_at
                now = time.monotonic()
                if not force and now - last_state_emit_at < self._state_snapshot_emit_interval_seconds:
                    return
                values = self._fetch_thread_state_values(thread_id)
                if not isinstance(values, dict):
                    return
                state_seq += 1
                last_state_emit_at = now
                self._emit_agent_event(
                    platform=platform,
                    event_type="agent_state",
                    payload={
                        **base_event_payload,
                        "at": _utcnow(),
                        "seq": state_seq,
                        "source": source,
                        "values": values,
                    },
                )

            emit_state_snapshot = _emit_state_snapshot
            _emit_state_snapshot("started", force=True)

            def _on_partial(partial_text: str) -> None:
                nonlocal last_partial_text, partial_seq
                last_partial_text = partial_text.strip()
                renderer.update(partial_text)
                if not last_partial_text:
                    return
                partial_seq += 1
                self._emit_agent_event(
                    platform=platform,
                    event_type="agent_partial",
                    payload={
                        **base_event_payload,
                        "at": _utcnow(),
                        "seq": partial_seq,
                        "partial_text": last_partial_text,
                    },
                )
                _emit_state_snapshot("partial")

            try:
                reply_bundle = self._run_agent_stream(
                    platform=platform,
                    thread_id=thread_id,
                    incoming=incoming,
                    assistant_id=assistant_id,
                    run_config=run_config,
                    run_context=run_context,
                    on_partial=_on_partial,
                )
                reply_text = reply_bundle.reply_text
            except Exception as stream_error:
                if last_partial_text and renderer.report.delivered:
                    reply_text = last_partial_text
                    reply_bundle = ChannelReplyBundle(reply_text=reply_text, artifacts=[])
                    renderer.fail(f"langgraph stream interrupted: {stream_error}")
                else:
                    # Keep compatibility when stream endpoint is unavailable.
                    reply_bundle = self._run_agent(
                        platform=platform,
                        thread_id=thread_id,
                        incoming=incoming,
                        assistant_id=assistant_id,
                        run_config=run_config,
                        run_context=run_context,
                    )
                    reply_text = reply_bundle.reply_text
                    renderer.fail(f"langgraph stream fallback to wait-run: {stream_error}")

            final_report = renderer.finalize(reply_text, failed=False)
            _emit_state_snapshot("finished", force=True)
            if platform == "dingtalk" and final_report.delivered:
                media_report = self._deliver_dingtalk_media_assets(
                    credentials=credentials,
                    incoming=incoming,
                    thread_id=thread_id,
                    workspace_id=workspace_id,
                    artifact_paths=reply_bundle.artifacts,
                )
            elif platform == "lark" and final_report.delivered:
                media_report = self._deliver_lark_media_assets(
                    credentials=credentials,
                    incoming=incoming,
                    thread_id=thread_id,
                    workspace_id=workspace_id,
                    artifact_paths=reply_bundle.artifacts,
                )
            elif platform == "telegram" and final_report.delivered:
                media_report = self._deliver_telegram_media_assets(
                    credentials=credentials,
                    incoming=incoming,
                    thread_id=thread_id,
                    workspace_id=workspace_id,
                    artifact_paths=reply_bundle.artifacts,
                )
            delivery_status = "delivered" if final_report.delivered else "skipped"
            self._repo.finish_message_log(
                log_id,
                run_status="succeeded",
                delivery_status=delivery_status,
                response_text=reply_text,
                error_message=None if final_report.delivered else final_report.message,
                thread_id=thread_id,
                workspace_id=workspace_id,
                delivery_path=final_report.delivery_path,
                render_mode=final_report.render_mode,
                fallback_reason=final_report.fallback_reason,
                stream_chunk_count=final_report.stream_chunk_count,
                media_attempted_count=media_report.attempted_count,
                media_sent_count=media_report.sent_count,
                media_failed_count=media_report.failed_count,
                media_manifest_json=media_report.manifest_json,
                media_fallback_reason=media_report.fallback_reason,
            )
            self._emit_agent_event(
                platform=platform,
                event_type="agent_finished",
                payload={
                    **base_event_payload,
                    "at": _utcnow(),
                    "reply_text": reply_text,
                    "delivery_status": delivery_status,
                    "delivery_path": final_report.delivery_path,
                    "render_mode": final_report.render_mode,
                    "fallback_reason": final_report.fallback_reason,
                    "stream_chunk_count": final_report.stream_chunk_count,
                },
            )
            return ChannelAgentBridgeResult(
                thread_id=client_thread_id,
                workspace_id=workspace_id,
                reply_text=reply_text,
                delivered=final_report.delivered,
                delivery_status=delivery_status,
                delivery_message=final_report.message,
                delivery_path=final_report.delivery_path,
                render_mode=final_report.render_mode,
                fallback_reason=final_report.fallback_reason,
                stream_chunk_count=final_report.stream_chunk_count,
                last_stream_chunk_at=final_report.last_stream_chunk_at,
                media_attempted_count=media_report.attempted_count,
                media_sent_count=media_report.sent_count,
                media_failed_count=media_report.failed_count,
                media_manifest_json=media_report.manifest_json,
                media_fallback_reason=media_report.fallback_reason,
            )
        except Exception as exc:
            if emit_state_snapshot is not None:
                emit_state_snapshot("failed", force=True)
            if renderer is not None:
                renderer.fail(str(exc))
                fail_report = renderer.finalize(
                    "处理失败，请稍后重试。",
                    failed=True,
                )
                self._repo.finish_message_log(
                    log_id,
                    run_status="failed",
                    delivery_status="failed",
                    response_text=reply_text or None,
                    error_message=str(exc),
                    thread_id=thread_id,
                    workspace_id=workspace_id,
                    delivery_path=fail_report.delivery_path,
                    render_mode=fail_report.render_mode,
                    fallback_reason=fail_report.fallback_reason,
                    stream_chunk_count=fail_report.stream_chunk_count,
                    media_attempted_count=0,
                    media_sent_count=0,
                    media_failed_count=0,
                    media_manifest_json=None,
                    media_fallback_reason=None,
                )
                self._emit_agent_event(
                    platform=platform,
                    event_type="agent_failed",
                    payload={
                        **base_event_payload,
                        "at": _utcnow(),
                        "error": str(exc),
                        "error_code": self._parse_agent_error_code(str(exc)),
                    },
                )
                raise
            self._repo.finish_message_log(
                log_id,
                run_status="failed",
                delivery_status="failed",
                response_text=None,
                error_message=str(exc),
                thread_id=thread_id,
                workspace_id=workspace_id,
                media_attempted_count=0,
                media_sent_count=0,
                media_failed_count=0,
                media_manifest_json=None,
                media_fallback_reason=None,
            )
            self._emit_agent_event(
                platform=platform,
                event_type="agent_failed",
                payload={
                    **base_event_payload,
                    "at": _utcnow(),
                    "error": str(exc),
                    "error_code": self._parse_agent_error_code(str(exc)),
                },
            )
            raise
