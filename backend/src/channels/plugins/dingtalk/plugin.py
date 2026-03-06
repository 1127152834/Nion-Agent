from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any

from src.channels.bridge_service import ChannelAgentBridgeService
from src.channels.plugins.dingtalk.adapter import DingTalkInboundAdapter
from src.channels.plugins.dingtalk.card_renderer import DingTalkPairingCardRenderer
from src.channels.plugins.dingtalk.pairing_flow import DingTalkPairingFlow
from src.channels.webhook_service import IncomingWebhookEvent


def _safe_int(value: str | None, default_value: int, *, min_value: int, max_value: int) -> int:
    raw = (value or "").strip()
    if not raw:
        return default_value
    try:
        parsed = int(raw)
    except ValueError:
        return default_value
    return max(min_value, min(max_value, parsed))


class DingTalkInboundPlugin:
    def __init__(
        self,
        repo: Any,
        *,
        on_agent_event: Callable[[str, str, dict[str, object]], None] | None = None,
    ):
        self._repo = repo
        self._on_agent_event = on_agent_event
        self._adapter = DingTalkInboundAdapter()
        self._pairing_flow = DingTalkPairingFlow(repo)
        self._card_renderer = DingTalkPairingCardRenderer()

    @property
    def _event_dedup_ttl_seconds(self) -> int:
        return _safe_int(
            os.getenv("NION_CHANNEL_EVENT_DEDUP_TTL_SECONDS"),
            300,
            min_value=60,
            max_value=86_400,
        )

    def _resolve_authorized_user(self, incoming: IncomingWebhookEvent) -> dict[str, Any] | None:
        normalized_external_user_id = (incoming.external_user_id or "").strip()
        if normalized_external_user_id:
            user = self._repo.get_authorized_user(
                "dingtalk",
                normalized_external_user_id,
                active_only=True,
            )
            if user is not None:
                return user

        normalized_chat_id = (incoming.chat_id or "").strip()
        if not normalized_chat_id or not self._adapter.is_private_chat(incoming):
            return None

        user = self._repo.get_authorized_user_by_chat(
            "dingtalk",
            normalized_chat_id,
            active_only=True,
        )
        if user is None:
            return None

        if normalized_external_user_id:
            try:
                user = self._repo.rebind_authorized_user_identity(
                    "dingtalk",
                    int(user["id"]),
                    external_user_id=normalized_external_user_id,
                    external_user_name=incoming.external_user_name,
                    chat_id=normalized_chat_id,
                )
            except Exception:
                return user
        return user

    def handle_incoming_event(self, incoming: IncomingWebhookEvent) -> dict[str, Any]:
        self._repo.cleanup_event_dedup(max_age_seconds=self._event_dedup_ttl_seconds)

        target = self._adapter.build_chat_target(incoming)
        if not target.external_user_id or not target.chat_id:
            return {
                "accepted": True,
                "action": "invalid_payload",
                "message": "missing user_id or chat_id",
            }
        normalized_text = self._adapter.normalized_text(incoming)
        if incoming.event_id and normalized_text and not self._repo.mark_event_processed(
            "dingtalk",
            incoming.event_id,
        ):
            return {
                "accepted": True,
                "action": "duplicate_ignored",
                "message": "event already processed",
            }

        authorized_user = self._resolve_authorized_user(incoming)
        if authorized_user is not None:
            if not normalized_text:
                return {
                    "accepted": True,
                    "action": "authorized_message_ignored",
                    "message": "empty text",
                }

            bridge_service = ChannelAgentBridgeService(
                self._repo,
                on_agent_event=self._on_agent_event,
            )
            try:
                result = bridge_service.handle_incoming_text("dingtalk", incoming)
            except Exception as exc:
                return {
                    "accepted": True,
                    "action": "agent_failed",
                    "message": str(exc),
                }

            return {
                "accepted": True,
                "action": "agent_replied" if result.delivered else "agent_processed",
                "message": result.delivery_message,
                "thread_id": result.thread_id,
                "workspace_id": result.workspace_id,
                "reply_preview": result.reply_text[:160],
                "delivery_path": result.delivery_path,
                "render_mode": result.render_mode,
                "fallback_reason": result.fallback_reason,
                "stream_chunk_count": result.stream_chunk_count,
                "last_stream_chunk_at": result.last_stream_chunk_at,
                "media_attempted_count": result.media_attempted_count,
                "media_sent_count": result.media_sent_count,
                "media_failed_count": result.media_failed_count,
                "media_manifest_json": result.media_manifest_json,
                "media_fallback_reason": result.media_fallback_reason,
            }

        if not normalized_text:
            return {
                "accepted": True,
                "action": "unauthorized_message_ignored",
                "message": "empty text",
            }

        pairing_decision = self._pairing_flow.ensure_pair_request(incoming)
        prompt = self._card_renderer.build_pairing_prompt(
            request=pairing_decision.request,
            reused=pairing_decision.reused,
            invalid_pair_code=pairing_decision.invalid_pair_code,
        )

        bridge_service = ChannelAgentBridgeService(
            self._repo,
            on_agent_event=self._on_agent_event,
        )
        try:
            prompt_delivery = bridge_service.send_system_message_with_meta(
                "dingtalk",
                incoming=incoming,
                text=prompt,
            )
        except Exception as exc:
            action_message = f"pair request created; prompt delivery failed: {exc}"
            return {
                "accepted": True,
                "action": "pair_requested",
                "message": action_message,
                "request_id": int(pairing_decision.request["id"]),
                "delivery_path": "dingtalk.pair_prompt",
                "render_mode": "text",
                "fallback_reason": "pair_prompt_delivery_exception",
                "stream_chunk_count": 0,
                "last_stream_chunk_at": None,
                "media_attempted_count": 0,
                "media_sent_count": 0,
                "media_failed_count": 0,
                "media_manifest_json": None,
                "media_fallback_reason": None,
            }

        action_message = "pair request created"
        if not prompt_delivery.delivered:
            action_message = (
                f"pair request created; prompt delivery failed: {prompt_delivery.message or 'unknown'}"
            )

        return {
            "accepted": True,
            "action": "pair_requested",
            "message": action_message,
            "request_id": int(pairing_decision.request["id"]),
            "delivery_path": prompt_delivery.delivery_path,
            "render_mode": prompt_delivery.render_mode,
            "fallback_reason": prompt_delivery.fallback_reason,
            "stream_chunk_count": prompt_delivery.stream_chunk_count,
            "last_stream_chunk_at": prompt_delivery.last_stream_chunk_at,
            "media_attempted_count": 0,
            "media_sent_count": 0,
            "media_failed_count": 0,
            "media_manifest_json": None,
            "media_fallback_reason": None,
        }
