from __future__ import annotations

import secrets
from dataclasses import dataclass
from typing import Any

from app.channels.webhook_service import IncomingWebhookEvent, parse_pairing_code


@dataclass(slots=True)
class PairingDecision:
    request: dict[str, Any]
    reused: bool
    invalid_pair_code: bool


class DingTalkPairingFlow:
    def __init__(self, repo: Any):
        self._repo = repo

    @staticmethod
    def _generate_request_code() -> str:
        return f"{secrets.randbelow(1_000_000):06d}"

    def ensure_pair_request(self, incoming: IncomingWebhookEvent) -> PairingDecision:
        parsed_code = parse_pairing_code(incoming.text)
        consumed_code: str | None = None
        invalid_pair_code = False

        if parsed_code:
            consumed = self._repo.consume_pairing_code("dingtalk", parsed_code)
            if consumed is None:
                invalid_pair_code = True
            else:
                consumed_code = str(consumed.get("code") or parsed_code).strip() or parsed_code

        existing = self._repo.get_pending_pair_request(
            "dingtalk",
            external_user_id=(incoming.external_user_id or "").strip(),
            chat_id=(incoming.chat_id or "").strip(),
        )
        if existing is not None:
            return PairingDecision(
                request=existing,
                reused=True,
                invalid_pair_code=invalid_pair_code,
            )

        request = self._repo.create_pair_request(
            "dingtalk",
            code=consumed_code or self._generate_request_code(),
            external_user_id=(incoming.external_user_id or "").strip(),
            external_user_name=incoming.external_user_name,
            chat_id=(incoming.chat_id or "").strip(),
            conversation_type=incoming.conversation_type,
            session_webhook=incoming.session_webhook,
            source_event_id=incoming.event_id,
        )
        return PairingDecision(
            request=request,
            reused=False,
            invalid_pair_code=invalid_pair_code,
        )
