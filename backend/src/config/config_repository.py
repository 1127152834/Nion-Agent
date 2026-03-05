"""Configuration repository for reading, validating, and writing configuration.

This module provides a high-level interface for configuration management,
including validation and automatic reloading after updates.
"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from src.config.app_config import AppConfig, reload_app_config
from src.config.config_store import VersionConflictError, create_config_store
from src.config.extensions_config import ExtensionsConfig


class ConfigValidationError(Exception):
    """Raised when configuration validation fails."""

    def __init__(self, errors: list[dict[str, Any]]):
        super().__init__("Config validation failed")
        self.errors = errors


class ConfigRepository:
    """Repository for configuration management with validation."""

    def __init__(self):
        """Initialize configuration repository."""
        self._store = create_config_store()

    def read(self) -> tuple[dict[str, Any], str, Path]:
        """Read configuration from storage.

        Returns:
            Tuple of (config_dict, version, source_path)
        """
        return self._store.read()

    @staticmethod
    def _normalize_validation_error(error: dict[str, Any]) -> dict[str, Any]:
        """Normalize Pydantic validation error to standard format.

        Args:
            error: Pydantic error dictionary

        Returns:
            Normalized error dictionary with path, message, and type
        """
        return {
            "path": [str(item) for item in error.get("loc", ())],
            "message": error.get("msg", "Invalid value"),
            "type": error.get("type", "validation_error"),
        }

    def validate(self, config_dict: dict[str, Any]) -> list[dict[str, Any]]:
        """Validate configuration dictionary.

        Args:
            config_dict: Configuration to validate

        Returns:
            List of validation errors (empty if valid)
        """
        payload = deepcopy(config_dict)
        payload = AppConfig.resolve_env_variables(payload)
        payload["extensions"] = ExtensionsConfig.from_file().model_dump()

        try:
            AppConfig.model_validate(payload)
            # Check for runtime environment variable validation errors
            runtime_env_errors = self._validate_runtime_env(config_dict.get("runtime_env"))
            return runtime_env_errors
        except ValidationError as exc:
            return [self._normalize_validation_error(item) for item in exc.errors()]

    @staticmethod
    def _validate_runtime_env(runtime_env: dict[str, str] | None) -> list[dict[str, Any]]:
        """Validate runtime environment variables.

        Args:
            runtime_env: Runtime environment variables dictionary

        Returns:
            List of validation errors
        """
        if not runtime_env:
            return []

        errors = []
        forbidden_prefixes = ["NEXT_PUBLIC_", "BETTER_AUTH_"]

        for key in runtime_env.keys():
            for prefix in forbidden_prefixes:
                if key.startswith(prefix):
                    errors.append(
                        {
                            "path": ["runtime_env", key],
                            "message": f"Environment variable with prefix '{prefix}' is not allowed in runtime_env",
                            "type": "forbidden_prefix",
                        }
                    )
                    break

        return errors

    def write(self, config_dict: dict[str, Any], expected_version: str) -> str:
        """Write configuration to storage after validation.

        Args:
            config_dict: Configuration to save
            expected_version: Expected current version for conflict detection

        Returns:
            New version string after successful write

        Raises:
            ConfigValidationError: If validation fails
            VersionConflictError: If version conflict detected
        """
        errors = self.validate(config_dict)
        if errors:
            raise ConfigValidationError(errors=errors)

        new_version = self._store.write(config_dict=config_dict, expected_version=expected_version)

        # Reload configuration to apply changes
        reload_app_config()
        return new_version
