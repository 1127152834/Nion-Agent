"""Shared utility helpers for community web_search and web_fetch tools."""

from typing import Any

from src.config import get_app_config


def _as_string(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _as_positive_int(value: Any, default: int) -> int:
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str):
        try:
            parsed = int(value.strip())
            if parsed > 0:
                return parsed
        except Exception:
            pass
    return default


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _split_items(value: Any) -> list[str]:
    if isinstance(value, list):
        items = [item for item in value if isinstance(item, str)]
    elif isinstance(value, str):
        items = value.replace("\n", ",").split(",")
    else:
        return []
    return [item.strip() for item in items if item.strip()]


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if not item:
            continue
        if item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def _get_search_settings_payload() -> dict[str, Any] | None:
    """Return the `search_settings` root payload if present."""
    try:
        settings = get_app_config().model_extra.get("search_settings")
    except Exception:  # noqa: BLE001
        return None
    if isinstance(settings, dict):
        return settings
    return None


def _get_provider_cfg(provider_configs: dict[str, Any], key: str) -> dict[str, Any]:
    raw = provider_configs.get(key)
    return raw if isinstance(raw, dict) else {}


def _safe_exc_message(exc: Exception) -> str:
    if isinstance(exc, ValueError):
        return str(exc)
    if isinstance(exc, RuntimeError):
        return str(exc)
    return type(exc).__name__
