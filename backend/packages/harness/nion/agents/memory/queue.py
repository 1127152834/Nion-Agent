"""Asynchronous memory session-commit queue with debounce."""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from src.config.memory_config import get_memory_config

logger = logging.getLogger(__name__)


@dataclass
class ConversationContext:
    """Context for a conversation to be processed for memory update."""

    thread_id: str
    messages: list[Any]
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))
    agent_name: str | None = None


class MemoryUpdateQueue:
    """Queue for session commits with debounce mechanism."""

    def __init__(self):
        self._queue: list[ConversationContext] = []
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None
        self._processing = False

    def add(self, thread_id: str, messages: list[Any], agent_name: str | None = None) -> None:
        config = get_memory_config()
        if not config.enabled:
            return

        context = ConversationContext(
            thread_id=thread_id,
            messages=messages,
            agent_name=agent_name,
        )

        with self._lock:
            # Keep only latest pending update per thread.
            self._queue = [c for c in self._queue if c.thread_id != thread_id]
            self._queue.append(context)
            self._reset_timer_locked()

    def _reset_timer_locked(self) -> None:
        config = get_memory_config()
        if self._timer is not None:
            self._timer.cancel()

        self._timer = threading.Timer(
            config.debounce_seconds,
            self._process_queue,
        )
        self._timer.daemon = True
        self._timer.start()

    def _process_queue(self) -> None:
        from src.agents.memory.registry import get_default_memory_provider

        with self._lock:
            if self._processing:
                self._reset_timer_locked()
                return
            if not self._queue:
                return

            self._processing = True
            contexts_to_process = self._queue.copy()
            self._queue.clear()
            self._timer = None

        try:
            provider = get_default_memory_provider()
            if not hasattr(provider, "commit_session"):
                logger.debug("memory queue skipped: provider has no commit_session")
                return

            for context in contexts_to_process:
                try:
                    provider.commit_session(  # type: ignore[attr-defined]
                        thread_id=context.thread_id,
                        messages=context.messages,
                        agent_name=context.agent_name,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.debug("memory queue commit failed for %s: %s", context.thread_id, exc)

                if len(contexts_to_process) > 1:
                    time.sleep(0.2)
        finally:
            with self._lock:
                self._processing = False

    def flush(self) -> None:
        """Force immediate processing of the queue."""
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
        self._process_queue()

    def clear(self) -> None:
        """Clear the queue without processing."""
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            self._queue.clear()
            self._processing = False

    @property
    def pending_count(self) -> int:
        with self._lock:
            return len(self._queue)

    @property
    def is_processing(self) -> bool:
        with self._lock:
            return self._processing


_memory_queue: MemoryUpdateQueue | None = None
_queue_lock = threading.Lock()


def get_memory_queue() -> MemoryUpdateQueue:
    global _memory_queue
    with _queue_lock:
        if _memory_queue is None:
            _memory_queue = MemoryUpdateQueue()
        return _memory_queue


def reset_memory_queue() -> None:
    global _memory_queue
    with _queue_lock:
        if _memory_queue is not None:
            _memory_queue.clear()
        _memory_queue = None
