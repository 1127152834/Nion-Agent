"""In-process scheduler events for Server-Sent Events (SSE).

This module intentionally keeps the implementation minimal:
- In-memory only (no persistence / replay).
- Drops events for slow subscribers (bounded queues).

It is used to eliminate frontend polling for scheduler task status changes.
"""

from __future__ import annotations

import json
import queue
import threading
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SchedulerEvent:
    """A scheduler event delivered to SSE subscribers."""

    type: str
    data: dict[str, Any]

    def to_sse(self) -> str:
        payload = json.dumps(self.data, ensure_ascii=False)
        return f"event: {self.type}\ndata: {payload}\n\n"


QueueT = queue.Queue[SchedulerEvent]


class SchedulerEventHub:
    """Best-effort in-memory pub/sub for scheduler events."""

    def __init__(self, *, queue_size: int = 256):
        self._lock = threading.Lock()
        self._subscribers: set[QueueT] = set()
        self._queue_size = queue_size

    def subscribe(self) -> QueueT:
        q: QueueT = queue.Queue(maxsize=self._queue_size)
        with self._lock:
            self._subscribers.add(q)
        return q

    def unsubscribe(self, q: QueueT) -> None:
        with self._lock:
            self._subscribers.discard(q)

    def publish(self, event: SchedulerEvent) -> None:
        with self._lock:
            subscribers = list(self._subscribers)

        for q in subscribers:
            try:
                q.put_nowait(event)
            except queue.Full:
                # Slow consumer: drop to avoid blocking scheduler threads.
                continue


_HUB = SchedulerEventHub()


def get_scheduler_event_hub() -> SchedulerEventHub:
    return _HUB
