from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

PAIRING_CODE_PATTERN = re.compile(
    r"^\s*(?:/)?(?:pair|绑定|配对)\s*[:：]?\s*(\d{6})\s*$",
    re.IGNORECASE,
)
PAIRING_CODE_FALLBACK_PATTERN = re.compile(
    r"(?:^|\s)(?:/)?(?:pair|绑定|配对)\s*[:：]?\s*(\d{6})(?:\s|$)",
    re.IGNORECASE,
)


@dataclass(slots=True)
class IncomingWebhookEvent:
    platform: str
    event_id: str | None
    external_user_id: str | None
    external_user_name: str | None
    chat_id: str | None
    conversation_type: str | None
    session_webhook: str | None
    text: str | None


def parse_pairing_code(text: str | None) -> str | None:
    if not text:
        return None
    normalized = text.strip()
    matched = PAIRING_CODE_PATTERN.match(normalized)
    if matched:
        return matched.group(1)
    # Fallback for chat payloads that prepend mentions or extra wrapper text.
    matched = PAIRING_CODE_FALLBACK_PATTERN.search(normalized)
    if not matched:
        return None
    return matched.group(1)


def is_lark_challenge(payload: dict[str, Any]) -> bool:
    return "challenge" in payload and payload.get("type") in {"url_verification", None}


def get_lark_challenge(payload: dict[str, Any]) -> str | None:
    value = payload.get("challenge")
    if value is None:
        return None
    return str(value)


def _extract_text(raw_text: Any) -> str | None:
    if raw_text is None:
        return None
    if isinstance(raw_text, str):
        stripped = raw_text.strip()
        if not stripped:
            return None
        if stripped.startswith("{") and stripped.endswith("}"):
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError:
                return stripped
            if isinstance(parsed, dict):
                if isinstance(parsed.get("text"), str):
                    return parsed["text"]
            return stripped
        return stripped
    if isinstance(raw_text, dict):
        for key in ("text", "content", "msg", "message", "query", "prompt"):
            value = raw_text.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, dict):
                nested = _extract_text(value)
                if nested:
                    return nested
    return None


def _extract_lark(payload: dict[str, Any]) -> IncomingWebhookEvent:
    header = payload.get("header") if isinstance(payload.get("header"), dict) else {}
    event_block = payload.get("event") if isinstance(payload.get("event"), dict) else {}
    sender = event_block.get("sender") if isinstance(event_block.get("sender"), dict) else {}
    sender_id_block = sender.get("sender_id") if isinstance(sender.get("sender_id"), dict) else {}
    message = event_block.get("message") if isinstance(event_block.get("message"), dict) else {}

    event_id = header.get("event_id") or payload.get("event_id")
    external_user_id = sender_id_block.get("open_id") or sender_id_block.get("user_id") or sender.get("id") or payload.get("user_id")
    external_user_name = sender.get("sender_name") or sender.get("name")
    chat_id = message.get("chat_id") or payload.get("chat_id")
    conversation_type = message.get("chat_type") or payload.get("conversation_type")
    text = _extract_text(message.get("content")) or _extract_text(payload.get("text"))

    return IncomingWebhookEvent(
        platform="lark",
        event_id=str(event_id).strip() if event_id else None,
        external_user_id=str(external_user_id).strip() if external_user_id else None,
        external_user_name=str(external_user_name).strip() if external_user_name else None,
        chat_id=str(chat_id).strip() if chat_id else None,
        conversation_type=str(conversation_type).strip() if conversation_type else None,
        session_webhook=None,
        text=text,
    )


def _extract_dingtalk(payload: dict[str, Any]) -> IncomingWebhookEvent:
    sender = payload.get("sender") if isinstance(payload.get("sender"), dict) else {}
    event_id = payload.get("event_id") or payload.get("msgId") or payload.get("messageId")
    external_user_id = sender.get("staffId") or sender.get("staff_id") or payload.get("staffId") or payload.get("staff_id") or payload.get("senderStaffId") or payload.get("sender_staff_id") or payload.get("senderId") or sender.get("id")
    external_user_name = sender.get("name") or payload.get("senderNick") or payload.get("senderName")
    conversation = payload.get("conversation") if isinstance(payload.get("conversation"), dict) else {}
    chat_id = payload.get("chat_id") or payload.get("conversationId") or payload.get("openConversationId") or conversation.get("id")
    conversation_type = payload.get("conversation_type") or payload.get("conversationType") or conversation.get("type")
    session_webhook = payload.get("sessionWebhook") or payload.get("session_webhook")
    text = _extract_text(payload.get("text")) or _extract_text(payload.get("content")) or _extract_text(payload.get("input")) or _extract_text(payload.get("query"))

    return IncomingWebhookEvent(
        platform="dingtalk",
        event_id=str(event_id).strip() if event_id else None,
        external_user_id=str(external_user_id).strip() if external_user_id else None,
        external_user_name=str(external_user_name).strip() if external_user_name else None,
        chat_id=str(chat_id).strip() if chat_id else None,
        conversation_type=str(conversation_type).strip() if conversation_type else None,
        session_webhook=str(session_webhook).strip() if session_webhook else None,
        text=text,
    )


def _extract_telegram(payload: dict[str, Any]) -> IncomingWebhookEvent:
    update_id = payload.get("update_id")
    message = None
    if isinstance(payload.get("message"), dict):
        message = payload["message"]
    elif isinstance(payload.get("edited_message"), dict):
        message = payload["edited_message"]
    elif isinstance(payload.get("channel_post"), dict):
        message = payload["channel_post"]
    elif isinstance(payload.get("edited_channel_post"), dict):
        message = payload["edited_channel_post"]

    callback_query = payload.get("callback_query") if isinstance(payload.get("callback_query"), dict) else {}
    if message is None and isinstance(callback_query.get("message"), dict):
        message = callback_query["message"]

    sender = message.get("from") if isinstance(message, dict) and isinstance(message.get("from"), dict) else {}
    if not sender and isinstance(callback_query.get("from"), dict):
        sender = callback_query["from"]

    chat = message.get("chat") if isinstance(message, dict) and isinstance(message.get("chat"), dict) else {}
    text = _extract_text(message.get("text") if isinstance(message, dict) else None) or _extract_text(message.get("caption") if isinstance(message, dict) else None) or _extract_text(callback_query.get("data"))

    external_user_name = sender.get("username") or " ".join(part for part in (str(sender.get("first_name") or "").strip(), str(sender.get("last_name") or "").strip()) if part)
    event_id = update_id or (message.get("message_id") if isinstance(message, dict) else None) or callback_query.get("id")

    return IncomingWebhookEvent(
        platform="telegram",
        event_id=str(event_id).strip() if event_id is not None else None,
        external_user_id=str(sender.get("id")).strip() if sender.get("id") is not None else None,
        external_user_name=str(external_user_name).strip() if external_user_name else None,
        chat_id=str(chat.get("id")).strip() if chat.get("id") is not None else None,
        conversation_type=str(chat.get("type")).strip() if chat.get("type") else None,
        session_webhook=None,
        text=text,
    )


def _extract_simple(platform: str, payload: dict[str, Any]) -> IncomingWebhookEvent:
    sender = payload.get("sender") if isinstance(payload.get("sender"), dict) else {}
    text = _extract_text(payload.get("text"))
    return IncomingWebhookEvent(
        platform=platform,
        event_id=str(payload.get("event_id")).strip() if payload.get("event_id") else None,
        external_user_id=str(sender.get("id") or payload.get("user_id") or "").strip() or None,
        external_user_name=str(sender.get("name") or payload.get("user_name") or "").strip() or None,
        chat_id=str(payload.get("chat_id") or "").strip() or None,
        conversation_type=str(payload.get("conversation_type") or "").strip() or None,
        session_webhook=None,
        text=text,
    )


def extract_incoming_event(platform: str, payload: dict[str, Any]) -> IncomingWebhookEvent:
    normalized = platform.strip().lower()
    if normalized == "lark":
        event = _extract_lark(payload)
    elif normalized == "dingtalk":
        event = _extract_dingtalk(payload)
    elif normalized == "telegram":
        event = _extract_telegram(payload)
    else:
        event = _extract_simple(normalized, payload)

    if event.external_user_id and event.chat_id:
        return event
    # fallback: allow simplified payloads for local/dev testing
    return _extract_simple(normalized, payload)
