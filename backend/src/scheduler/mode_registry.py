"""Registry for task mode executors.

App-layer modules (evolution, heartbeat) register their executors at startup.
Scheduler runner invokes them via this registry, avoiding direct imports.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

# Key = TaskMode value (str), Value = async callable(task, trace_id) -> dict
_mode_executors: dict[str, Callable[..., Any]] = {}


def register_mode_executor(mode: str, executor: Callable[..., Any]) -> None:
    _mode_executors[mode] = executor
    logger.info("Registered scheduler mode executor: %s", mode)


def get_mode_executor(mode: str) -> Callable[..., Any] | None:
    return _mode_executors.get(mode)

