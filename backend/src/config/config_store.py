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

DEFAULT_CHECKPOINTER_CONFIG: dict[str, Any] = {
    "type": "sqlite",
    "connection_string": "checkpoints.db",
}

# Minimal default configuration for bootstrapping
MINIMAL_DEFAULT_CONFIG: dict[str, Any] = {
    "models": [],
    "tool_groups": [],
    "tools": [],
    "sandbox": {"use": "src.sandbox.local:LocalSandboxProvider"},
    "checkpointer": deepcopy(DEFAULT_CHECKPOINTER_CONFIG),
}


class VersionConflictError(Exception):
    """Raised when attempting to update config with an outdated version."""

    def __init__(self, current_version: str):
        super().__init__("Config version conflict")
        self.current_version = current_version


class ConfigStoreNotInitializedError(Exception):
    """Raised when config store is not initialized yet."""


class ConfigStore(Protocol):
    """Protocol for configuration storage backends."""

    def read(self) -> tuple[dict[str, Any], str, Path]:
        """Read configuration from storage.

        Returns:
            Tuple of (config_dict, version, source_path)
        """
        ...

    def read_version(self) -> tuple[str, Path]:
        """Read only configuration version from storage.

        Returns:
            Tuple of (version, source_path)

        Raises:
            ConfigStoreNotInitializedError: If store is not initialized yet.
        """
        ...

    def exists(self) -> bool:
        """Whether configuration state already exists in storage."""
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

    def update_runtime_status(
        self,
        process_name: str,
        *,
        loaded_version: str | None,
        source_path: str,
        tools_count: int | None,
        status: str,
        reason: str | None,
    ) -> None:
        """Persist runtime config load status for a process."""
        ...

    def read_runtime_statuses(self) -> dict[str, dict[str, Any]]:
        """Read runtime load statuses for all known processes."""
        ...


class SQLiteConfigStore:
    """SQLite-based configuration storage with version control."""

    TABLE_NAME = "app_config_state"
    RUNTIME_TABLE_NAME = "app_config_runtime_state"

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

        checkpointer = config.get("checkpointer")
        if not isinstance(checkpointer, dict) or not isinstance(checkpointer.get("type"), str):
            config["checkpointer"] = deepcopy(DEFAULT_CHECKPOINTER_CONFIG)
        elif checkpointer.get("type") == "sqlite" and not checkpointer.get("connection_string"):
            config["checkpointer"] = deepcopy(DEFAULT_CHECKPOINTER_CONFIG)

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
            self._ensure_runtime_table(conn)

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

    def _ensure_runtime_table(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {self.RUNTIME_TABLE_NAME} (
                process_name TEXT PRIMARY KEY,
                loaded_version TEXT,
                source_path TEXT NOT NULL,
                tools_count INTEGER,
                status TEXT NOT NULL DEFAULT 'ok',
                reason TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

    def exists(self) -> bool:
        """Whether config row exists without bootstrapping defaults."""
        if not self._db_path.exists():
            return False

        with self._connect() as conn:
            table_row = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                (self.TABLE_NAME,),
            ).fetchone()
            if table_row is None:
                return False
            state_row = conn.execute(
                f"SELECT 1 FROM {self.TABLE_NAME} WHERE id = 1"
            ).fetchone()
            return state_row is not None

    def read_version(self) -> tuple[str, Path]:
        """Read only config version without forcing initialization."""
        if not self.exists():
            raise ConfigStoreNotInitializedError("Config store is not initialized")

        with self._connect() as conn:
            row = conn.execute(f"SELECT version FROM {self.TABLE_NAME} WHERE id = 1").fetchone()
        if row is None:
            raise ConfigStoreNotInitializedError("Config store is not initialized")
        return str(row["version"]), self._db_path

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

    def update_runtime_status(
        self,
        process_name: str,
        *,
        loaded_version: str | None,
        source_path: str,
        tools_count: int | None,
        status: str,
        reason: str | None,
    ) -> None:
        """Persist runtime load status for a process."""
        with self._connect() as conn:
            self._ensure_runtime_table(conn)
            conn.execute(
                f"""
                INSERT INTO {self.RUNTIME_TABLE_NAME} (
                    process_name, loaded_version, source_path, tools_count, status, reason
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(process_name) DO UPDATE SET
                    loaded_version = excluded.loaded_version,
                    source_path = excluded.source_path,
                    tools_count = excluded.tools_count,
                    status = excluded.status,
                    reason = excluded.reason,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    process_name,
                    loaded_version,
                    source_path,
                    tools_count,
                    status,
                    reason,
                ),
            )
            conn.commit()

    def read_runtime_statuses(self) -> dict[str, dict[str, Any]]:
        """Read runtime load statuses for all known processes."""
        if not self._db_path.exists():
            return {}

        with self._connect() as conn:
            table_row = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                (self.RUNTIME_TABLE_NAME,),
            ).fetchone()
            if table_row is None:
                return {}
            rows = conn.execute(
                f"""
                SELECT process_name, loaded_version, source_path, tools_count, status, reason, updated_at
                FROM {self.RUNTIME_TABLE_NAME}
                ORDER BY process_name ASC
                """
            ).fetchall()

        result: dict[str, dict[str, Any]] = {}
        for row in rows:
            result[row["process_name"]] = {
                "loaded_version": row["loaded_version"],
                "source_path": row["source_path"],
                "tools_count": row["tools_count"],
                "status": row["status"],
                "reason": row["reason"],
                "updated_at": row["updated_at"],
            }
        return result


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
