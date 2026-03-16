"""Keychain data models."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any


class CredentialType(StrEnum):
    """Credential type enumeration."""

    PASSWORD = "password"
    TOKEN = "token"
    API_KEY = "api_key"
    COOKIE = "cookie"
    SESSION = "session"
    OAUTH = "oauth"


@dataclass
class Credential:
    """Represents a stored credential."""

    id: str  # Unique identifier (e.g., "xhs-cli:login")
    type: CredentialType
    service: str  # Service name (e.g., "xhs-cli", "github")
    account: str | None  # Account/username
    secret: str  # Encrypted secret value
    metadata: dict[str, Any]  # Additional metadata
    created_at: datetime
    updated_at: datetime
    expires_at: datetime | None


@dataclass
class SessionState:
    """Represents a CLI session state."""

    service: str  # CLI tool name
    session_id: str
    cookies: dict[str, str]
    tokens: dict[str, str]
    environment: dict[str, str]  # Environment variables
    working_dir: str | None
    last_active: datetime
    expires_at: datetime | None
