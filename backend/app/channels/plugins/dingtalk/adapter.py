from __future__ import annotations

from dataclasses import dataclass

from app.channels.webhook_service import IncomingWebhookEvent


@dataclass(slots=True)
class DingTalkChatTarget:
    external_user_id: str
    chat_id: str
    conversation_type: str | None


class DingTalkInboundAdapter:
    @staticmethod
    def is_private_chat(incoming: IncomingWebhookEvent) -> bool:
        normalized = (incoming.conversation_type or "").strip().lower()
        return normalized in {"1", "single", "private", "im"} or "single" in normalized

    @staticmethod
    def build_chat_target(incoming: IncomingWebhookEvent) -> DingTalkChatTarget:
        return DingTalkChatTarget(
            external_user_id=(incoming.external_user_id or "").strip(),
            chat_id=(incoming.chat_id or "").strip(),
            conversation_type=(incoming.conversation_type or "").strip() or None,
        )

    @staticmethod
    def normalized_text(incoming: IncomingWebhookEvent) -> str:
        return (incoming.text or "").strip()
