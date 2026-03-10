"""Data models for Soul Core."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass
class SoulAsset:
    """Soul asset (SOUL.md, IDENTITY.md, or USER.md)."""

    content: str
    source_path: str
    asset_type: Literal["soul", "identity", "user"]


@dataclass
class SoulSummary:
    """Summarized soul asset for injection."""

    summary: str
    source_type: Literal["soul", "identity", "user"]
    token_count: int
    full_content_available: bool
