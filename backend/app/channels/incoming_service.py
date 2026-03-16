from __future__ import annotations

import json
import os
import re
from collections.abc import Callable
from dataclasses import dataclass

from app.channels.bridge_service import ChannelAgentBridgeService
from app.channels.plugins.dingtalk import DingTalkInboundPlugin
from app.channels.repository import ChannelRepository
from app.channels.webhook_service import IncomingWebhookEvent, parse_pairing_code


def _safe_int(value: str | None, default_value: int, *, min_value: int, max_value: int) -> int:
    raw = (value or "").strip()
    if not raw:
        return default_value
    try:
        parsed = int(raw)
    except ValueError:
        return default_value
    return max(min_value, min(max_value, parsed))


def _parse_telegram_allowed_users(value: str | None) -> set[str]:
    raw = (value or "").strip()
    if not raw:
        return set()

    tokens: list[str] = []
    if raw.startswith("[") and raw.endswith("]"):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            tokens = [str(item).strip() for item in parsed]

    if not tokens:
        tokens = [part.strip() for part in re.split(r"[\s,;]+", raw)]

    normalized: set[str] = set()
    for token in tokens:
        if not token:
            continue
        try:
            normalized.add(str(int(token)))
        except ValueError:
            normalized.add(token)
    return normalized


@dataclass(slots=True)
class ChannelInboundResult:
    accepted: bool = True
    action: str = "ignored"
    message: str | None = None
    request_id: int | None = None
    thread_id: str | None = None
    workspace_id: str | None = None
    reply_preview: str | None = None
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


class ChannelInboundService:
    """Shared inbound event handler for webhook and stream channel messages."""

    def __init__(
        self,
        repo: ChannelRepository,
        *,
        on_agent_event: Callable[[str, str, dict[str, object]], None] | None = None,
    ):
        self._repo = repo
        self._on_agent_event = on_agent_event
        self._dingtalk_plugin = DingTalkInboundPlugin(repo, on_agent_event=on_agent_event)

    @staticmethod
    def _is_private_chat(incoming: IncomingWebhookEvent) -> bool:
        conversation_type = (incoming.conversation_type or "").strip().lower()
        return conversation_type in {"1", "single", "private", "im"} or "single" in conversation_type

    def _resolve_authorized_user(
        self,
        platform: str,
        incoming: IncomingWebhookEvent,
    ) -> dict | None:
        normalized_external_user_id = (incoming.external_user_id or "").strip()
        if normalized_external_user_id:
            user = self._repo.get_authorized_user(
                platform,
                normalized_external_user_id,
                active_only=True,
            )
            if user is not None:
                return user

        # Legacy compatibility: old records may store encrypted sender.id; fall back by chat_id
        # for private chats and self-heal to current normalized user identity.
        normalized_chat_id = (incoming.chat_id or "").strip()
        if not normalized_chat_id or not self._is_private_chat(incoming):
            return None

        user = self._repo.get_authorized_user_by_chat(
            platform,
            normalized_chat_id,
            active_only=True,
        )
        if user is None:
            return None

        if normalized_external_user_id:
            try:
                user = self._repo.rebind_authorized_user_identity(
                    platform,
                    int(user["id"]),
                    external_user_id=normalized_external_user_id,
                    external_user_name=incoming.external_user_name,
                    chat_id=normalized_chat_id,
                )
            except Exception:
                # Keep non-blocking compatibility even when self-healing fails.
                return user
        return user

    @property
    def _event_dedup_ttl_seconds(self) -> int:
        return _safe_int(
            os.getenv("NION_CHANNEL_EVENT_DEDUP_TTL_SECONDS"),
            300,
            min_value=60,
            max_value=86_400,
        )

    def handle_incoming_event(self, platform: str, incoming: IncomingWebhookEvent) -> ChannelInboundResult:
        if platform == "dingtalk":
            plugin_result = self._dingtalk_plugin.handle_incoming_event(incoming)
            return ChannelInboundResult(**plugin_result)

        if platform == "telegram":
            integration = self._repo.get_integration("telegram")
            credentials = integration.get("credentials", {})
            allowed_users = _parse_telegram_allowed_users(str(credentials.get("allowed_users") or ""))
            external_user_id = (incoming.external_user_id or "").strip()
            if allowed_users and external_user_id and external_user_id not in allowed_users:
                return ChannelInboundResult(
                    accepted=True,
                    action="unauthorized_message_ignored",
                    message="telegram user not allowed",
                )

        # Keep dedup table bounded (similar to AionUi's in-memory TTL cache cleanup).
        self._repo.cleanup_event_dedup(max_age_seconds=self._event_dedup_ttl_seconds)

        if incoming.event_id and not self._repo.mark_event_processed(platform, incoming.event_id):
            return ChannelInboundResult(
                accepted=True,
                action="duplicate_ignored",
                message="event already processed",
            )

        if not incoming.external_user_id or not incoming.chat_id:
            return ChannelInboundResult(
                accepted=True,
                action="invalid_payload",
                message="missing user_id or chat_id",
            )

        pairing_code = parse_pairing_code(incoming.text)
        if pairing_code:
            consumed = self._repo.consume_pairing_code(platform, pairing_code)
            if consumed is None:
                return ChannelInboundResult(
                    accepted=True,
                    action="pair_code_invalid",
                    message="pairing code invalid or expired",
                )

            request = self._repo.create_pair_request(
                platform,
                code=pairing_code,
                external_user_id=incoming.external_user_id,
                external_user_name=incoming.external_user_name,
                chat_id=incoming.chat_id,
                conversation_type=incoming.conversation_type,
                session_webhook=incoming.session_webhook,
                source_event_id=incoming.event_id,
            )
            return ChannelInboundResult(
                accepted=True,
                action="pair_requested",
                message="pair request created",
                request_id=int(request["id"]),
            )

        authorized_user = self._resolve_authorized_user(platform, incoming)
        if authorized_user is None:
            return ChannelInboundResult(
                accepted=True,
                action="unauthorized_message_ignored",
                message="user not authorized",
            )

        if not incoming.text:
            return ChannelInboundResult(
                accepted=True,
                action="authorized_message_ignored",
                message="empty text",
            )

        bridge_service = ChannelAgentBridgeService(
            self._repo,
            on_agent_event=self._on_agent_event,
        )
        try:
            result = bridge_service.handle_incoming_text(platform, incoming)
        except Exception as exc:
            return ChannelInboundResult(
                accepted=True,
                action="agent_failed",
                message=str(exc),
            )

        return ChannelInboundResult(
            accepted=True,
            action="agent_replied" if result.delivered else "agent_processed",
            message=result.delivery_message,
            thread_id=result.thread_id,
            workspace_id=result.workspace_id,
            reply_preview=result.reply_text[:160],
            delivery_path=result.delivery_path,
            render_mode=result.render_mode,
            fallback_reason=result.fallback_reason,
            stream_chunk_count=result.stream_chunk_count,
            last_stream_chunk_at=result.last_stream_chunk_at,
            media_attempted_count=result.media_attempted_count,
            media_sent_count=result.media_sent_count,
            media_failed_count=result.media_failed_count,
            media_manifest_json=result.media_manifest_json,
            media_fallback_reason=result.media_fallback_reason,
        )
