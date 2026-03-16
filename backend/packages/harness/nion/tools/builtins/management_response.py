"""Common response helpers for management tools."""

from __future__ import annotations

import json
from typing import Any


def build_management_response(
    *,
    success: bool,
    message: str,
    data: dict[str, Any] | None = None,
    ui_card: dict[str, Any] | None = None,
    requires_confirmation: bool = False,
    confirmation_token: str | None = None,
    next_action: str | None = None,
    clarification: dict[str, Any] | None = None,
) -> str:
    """Build a normalized tool response payload as JSON text."""
    payload: dict[str, Any] = {
        "success": success,
        "message": message,
        "data": data or {},
        "requires_confirmation": requires_confirmation,
        "confirmation_token": confirmation_token,
    }
    if next_action is not None:
        payload["next_action"] = next_action
    if clarification is not None:
        payload["clarification"] = clarification
    if ui_card is not None:
        payload["ui_card"] = ui_card
    return json.dumps(payload, ensure_ascii=False)


def build_action_card(
    *,
    title: str,
    description: str,
    actions: list[dict[str, Any]] | None = None,
    status: str = "info",
) -> dict[str, Any]:
    """Build a generic action card payload for frontend rendering."""
    return {
        "type": "action",
        "status": status,
        "title": title,
        "description": description,
        "actions": actions or [],
    }
