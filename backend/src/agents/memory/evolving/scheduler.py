"""Scheduler for periodic self-evolution runs."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any


class MemoryEvolutionScheduler:
    """Trigger evolve() based on time interval or query volume."""

    def __init__(
        self,
        evolver: Any,
        interval_hours: int = 24,
        query_threshold: int = 50,
    ) -> None:
        self.evolver = evolver
        self.interval_hours = interval_hours
        self.query_threshold = query_threshold
        self.query_count = 0
        self.last_evolution: datetime | None = None

    def record_query(self, count: int = 1) -> None:
        """Increase observed query count."""
        self.query_count += count

    def should_evolve(self, now: datetime | None = None) -> bool:
        """Determine whether evolve() should run now."""
        current = now or datetime.now(UTC)

        if self.query_count >= self.query_threshold:
            return True

        if self.last_evolution is None:
            return self.query_count > 0

        return current - self.last_evolution >= timedelta(hours=self.interval_hours)

    def run_if_needed(self, now: datetime | None = None) -> dict[str, Any] | None:
        """Run evolution when threshold/interval conditions are met."""
        current = now or datetime.now(UTC)
        if not self.should_evolve(current):
            return None

        report = self.evolver.evolve()
        self.last_evolution = current
        self.query_count = 0
        return report


__all__ = ["MemoryEvolutionScheduler"]
