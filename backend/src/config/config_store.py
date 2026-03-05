"""Configuration storage using SQLite database.

This module provides persistent configuration storage with version control
to prevent concurrent modification conflicts.
"""

from __future__ import annotations

import os
import sqlite3
from copy import deepcopy
from pathlib import Path
from typing import Any, Protocol

import yaml

from src.config.paths import get_paths

# Minimal default configuration for bootstrapping
MINIMAL_DEFAULT_CONFIG: dict[str, Any] = {
    "models": [],
    "tool_groups": [],
    "tools": [],
    "sandbox": {"use": "src.sandbox.local:LocalSandboxProvider"},
}


class VersionConflictError(Exception):
    """Raised when attempting to update config with an outdated version."""

    def __init__(self, current_version: str):
        super().__init__("Config version conflict")
        self.current_version = current_version


class ConfigStore(Protocol):
    """Protocol for configuration storage backends."""

    def read(self) -> tuple[dict[str, Any], str, Path]:
        """Read configuration from storage.

        Returns:
            Tuple of (config_dict, version, source_path)
        """
        ...

    def write(self, config_dict: dict[str, Any], expected_version: str) -> str:
        """Write configuration to storage with optimistic locking.

        Args:
            config_dict: Configuration dictionary to save
            expected_version: Expected current version (for conflict detection)

        Returns:
            New version string after successful write

        Raises:
            VersionConflictError: If expected_version doesn't match current version
        """
        ...


class SQLiteConfigStore:
    """SQLite-based configuration storage with version control."""

    TABLE_NAME = "app_config_state"

    def __init__(self, db_path: Path):
        """Initialize SQLite config store.

        Args:
            db_path: Path to SQLite database file
        """
        self._db_path = db_path.resolve()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        """Create database connection with Row factory."""
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def _coerce_bootstrap_config(raw: Any) -> dict[str, Any]:
        """Ensure bootstrap config has required fields.

        Args:
            raw: Raw configuration data

        Returns:
            Validated configuration dictionary with required fields
        """
        if not isinstance(raw, dict):
            return deepcopy(MINIMAL_DEFAULT_CONFIG)

        config = deepcopy(raw)
        if not isinstance(config.get("models"), list):
            config["models"] = []
        if not isinstance(config.get("tool_groups"), list):
            config["tool_groups"] = []
        if not isinstance(config.get("tools"), list):
            config["tools"] = []

        sandbox = config.get("sandbox")
        if not isinstance(sandbox, dict) or not sandbox.get("use"):
            config["sandbox"] = deepcopy(MINIMAL_DEFAULT_CONFIG["sandbox"])

        return config

    def _ensure_initialized(self) -> None:
        """Ensure database table exists and is initialized."""
        with self._connect() as conn:
            # Create table if not exists
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {self.TABLE_NAME} (
                    id INTEGER PRIMARY KEY CHECK(id = 1),
                    version INTEGER NOT NULL,
                    config_json TEXT NOT NULL
                )
                """
            )

            # Check if already initialized
            row = conn.execute(f"SELECT version FROM {self.TABLE_NAME} WHERE id = 1").fetchone()
            if row is not None:
                return

            # Initialize with minimal config
            bootstrap = self._coerce_bootstrap_config(MINIMAL_DEFAULT_CONFIG)
            conn.execute(
                f"INSERT INTO {self.TABLE_NAME}(id, version, config_json) VALUES(1, 1, ?)",
                (yaml.safe_dump(bootstrap, sort_keys=False, allow_unicode=True),),
            )
            conn.commit()

    def read(self) -> tuple[dict[str, Any], str, Path]:
        """Read configuration from database.

        Returns:
            Tuple of (config_dict, version, db_path)
        """
        self._ensure_initialized()
        with self._connect() as conn:
            row = conn.execute(f"SELECT version, config_json FROM {self.TABLE_NAME} WHERE id = 1").fetchone()

        if row is None:
            raise RuntimeError("Config store initialization failed")

        config_data = yaml.safe_load(row["config_json"]) or {}
        return config_data, str(row["version"]), self._db_path

    def write(self, config_dict: dict[str, Any], expected_version: str) -> str:
        """Write configuration to database with version check.

        Args:
            config_dict: Configuration to save
            expected_version: Expected current version

        Returns:
            New version string

        Raises:
            VersionConflictError: If version mismatch detected
        """
        self._ensure_initialized()
        with self._connect() as conn:
            row = conn.execute(f"SELECT version FROM {self.TABLE_NAME} WHERE id = 1").fetchone()
            if row is None:
                raise RuntimeError("Config store initialization failed")

            current_version = int(row["version"])
            if str(current_version) != expected_version:
                raise VersionConflictError(current_version=str(current_version))

            next_version = current_version + 1
            serialized = yaml.safe_dump(config_dict, sort_keys=False, allow_unicode=True)
            conn.execute(
                f"UPDATE {self.TABLE_NAME} SET version = ?, config_json = ? WHERE id = 1",
                (next_version, serialized),
            )
            conn.commit()

        return str(next_version)


def resolve_config_db_path() -> Path:
    """Resolve configuration database path.

    Priority order:
    1. NION_CONFIG_DB_PATH environment variable
    2. NION_HOME environment variable + config.db
    3. Project base directory + .nion/config.db

    Returns:
        Resolved path to config.db
    """
    # Explicit config DB path
    if env_path := os.getenv("NION_CONFIG_DB_PATH"):
        path = Path(env_path)
        if not path.is_absolute():
            path = (Path.cwd() / path).resolve()
        return path

    # Use NION_HOME if set
    if nion_home := os.getenv("NION_HOME"):
        return Path(nion_home).resolve() / "config.db"

    # Default: use paths base_dir
    return get_paths().base_dir / "config.db"


def create_config_store(config_path: str | Path | None = None) -> ConfigStore:
    """Create configuration store instance.

    Args:
        config_path: Optional explicit path (deprecated, raises error if provided)

    Returns:
        ConfigStore instance (currently always SQLiteConfigStore)

    Raises:
        ValueError: If config_path is provided or invalid storage mode
    """
    if config_path is not None:
        raise ValueError("Legacy config_path loading is no longer supported")

    mode = os.getenv("NION_CONFIG_STORAGE", "auto").strip().lower()
    if mode == "file":
        raise ValueError("NION_CONFIG_STORAGE=file is no longer supported; use auto or sqlite")
    if mode not in {"auto", "sqlite"}:
        raise ValueError("NION_CONFIG_STORAGE must be one of: auto, sqlite")

    # Both 'auto' and 'sqlite' use SQLite storage
    return SQLiteConfigStore(resolve_config_db_path())
