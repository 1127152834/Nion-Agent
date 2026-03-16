"""In-memory confirmation token store for destructive tool operations."""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from threading import Lock
from typing import Any

_LOCK = Lock()


@dataclass(slots=True)
class ConfirmationEntry:
    token: str
    action: str
    target: str
    created_at: datetime
    expires_at: datetime
    payload: dict[str, Any]


_TOKENS: dict[str, ConfirmationEntry] = {}


def _cleanup_expired(now: datetime) -> None:
    expired = [token for token, entry in _TOKENS.items() if entry.expires_at <= now]
    for token in expired:
        _TOKENS.pop(token, None)


def issue_confirmation_token(
    *,
    action: str,
    target: str,
    payload: dict[str, Any] | None = None,
    ttl_seconds: int = 300,
) -> str:
    """Issue a one-time confirmation token."""
    now = datetime.now(UTC)
    token = secrets.token_urlsafe(18)
    entry = ConfirmationEntry(
        token=token,
        action=action,
        target=target,
        created_at=now,
        expires_at=now + timedelta(seconds=max(ttl_seconds, 30)),
        payload=payload or {},
    )
    with _LOCK:
        _cleanup_expired(now)
        _TOKENS[token] = entry
    return token


def consume_confirmation_token(
    *,
    token: str,
    action: str,
    target: str,
) -> tuple[bool, str]:
    """Validate and consume a confirmation token."""
    now = datetime.now(UTC)
    with _LOCK:
        _cleanup_expired(now)
        entry = _TOKENS.get(token)
        if entry is None:
            return False, "Confirmation token is invalid or expired."
        if entry.action != action or entry.target != target:
            return False, "Confirmation token does not match requested operation."
        _TOKENS.pop(token, None)
    return True, "ok"
