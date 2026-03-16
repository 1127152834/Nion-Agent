from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from src.channels.repository import SUPPORTED_CHANNEL_PLATFORMS


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


class ChannelEventBroker:
    """In-process channel event broker for lightweight SSE fanout."""

    def __init__(self, *, max_queue_size: int = 100):
        self._max_queue_size = max(10, max_queue_size)
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {platform: set() for platform in SUPPORTED_CHANNEL_PLATFORMS}

    def subscribe(self, platform: str) -> asyncio.Queue[dict[str, Any]]:
        normalized = platform.strip().lower()
        if normalized not in self._subscribers:
            raise ValueError(f"unsupported platform: {platform}")
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=self._max_queue_size)
        self._subscribers[normalized].add(queue)
        return queue

    def unsubscribe(self, platform: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        normalized = platform.strip().lower()
        subscribers = self._subscribers.get(normalized)
        if not subscribers:
            return
        subscribers.discard(queue)

    def publish(self, platform: str, event_type: str, payload: dict[str, Any] | None = None) -> None:
        normalized = platform.strip().lower()
        subscribers = self._subscribers.get(normalized)
        if not subscribers:
            return
        event = {
            "platform": normalized,
            "type": event_type.strip() or "updated",
            "payload": payload or {},
            "timestamp": _utcnow(),
        }
        for queue in tuple(subscribers):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # Drop event when subscriber is persistently slow.
                continue
