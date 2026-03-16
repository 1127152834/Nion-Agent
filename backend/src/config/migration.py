"""Configuration migration utilities.

This module provides tools to migrate configuration from config.yaml
to SQLite database storage.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

from src.config.app_config import AppConfig
from src.config.config_store import create_config_store

logger = logging.getLogger(__name__)


def load_yaml_config(config_path: Path) -> dict[str, Any] | None:
    """Load configuration from YAML file.

    Args:
        config_path: Path to config.yaml file

    Returns:
        Configuration dictionary or None if file doesn't exist
    """
    if not config_path.exists():
        return None

    try:
        with open(config_path, encoding="utf-8") as f:
            config = yaml.safe_load(f)
            if not isinstance(config, dict):
                logger.warning(f"Config file {config_path} does not contain a valid dictionary")
                return None
            return config
    except Exception as e:
        logger.error(f"Failed to load config from {config_path}: {e}")
        return None


def migrate_config_to_sqlite(yaml_config_path: Path | None = None) -> bool:
    """Migrate configuration from YAML file to SQLite database.

    Args:
        yaml_config_path: Path to config.yaml file (optional, will search default locations)

    Returns:
        True if migration was performed, False if skipped or failed
    """
    # Check if SQLite database already exists
    store = create_config_store()
    try:
        config_dict, version, db_path = store.read()
        logger.info(f"SQLite config database already exists at {db_path} (version {version})")
        return False
    except Exception:
        # Database doesn't exist or is not initialized, proceed with migration
        pass

    # Find config.yaml file
    if yaml_config_path is None:
        # Search default locations
        search_paths = [
            Path.cwd() / "config.yaml",
            Path.cwd().parent / "config.yaml",
        ]
        for path in search_paths:
            if path.exists():
                yaml_config_path = path
                break

    if yaml_config_path is None:
        logger.info("No config.yaml found, will use default configuration")
        return False

    # Load YAML configuration
    yaml_config = load_yaml_config(yaml_config_path)
    if yaml_config is None:
        logger.warning(f"Failed to load config from {yaml_config_path}")
        return False

    # Validate configuration
    try:
        # Resolve environment variables
        resolved_config = AppConfig.resolve_env_variables(yaml_config)
        # Validate structure (without extensions, as they're in separate file)
        test_config = {**resolved_config, "extensions": {"mcp_servers": {}, "skills": {}}}
        AppConfig.model_validate(test_config)
    except Exception as e:
        logger.error(f"Config validation failed: {e}")
        return False

    # Migrate to SQLite
    try:
        # Write to SQLite with initial version "0" (will become "1" after write)
        new_version = store.write(yaml_config, expected_version="0")
        logger.info(f"Successfully migrated config from {yaml_config_path} to SQLite (version {new_version})")
        return True
    except Exception as e:
        logger.error(f"Failed to migrate config to SQLite: {e}")
        return False


def ensure_config_migrated() -> None:
    """Ensure configuration is migrated to SQLite.

    This function should be called during application startup to automatically
    migrate config.yaml to SQLite if needed.
    """
    try:
        migrate_config_to_sqlite()
    except Exception as e:
        logger.error(f"Config migration failed: {e}")
        # Don't fail startup, let the application use default config
