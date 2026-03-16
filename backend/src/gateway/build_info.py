from __future__ import annotations

from datetime import UTC, datetime

# Best-effort process start timestamp for diagnostics. This is set at import time and
# should be very close to the real process start in typical uvicorn deployments.
PROCESS_START_TIME = datetime.now(UTC)
