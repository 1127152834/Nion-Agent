"""Configuration repository for reading, validating, and writing configuration."""

from __future__ import annotations

import os
from copy import deepcopy
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from src.config.app_config import AppConfig, get_app_config_runtime_status, reload_app_config
from src.config.config_store import VersionConflictError, create_config_store
from src.config.extensions_config import ExtensionsConfig


class ConfigValidationError(Exception):
    """Raised when configuration validation fails."""

    def __init__(self, errors: list[dict[str, Any]], warnings: list[dict[str, Any]] | None = None):
        super().__init__("Config validation failed")
        self.errors = errors
        self.warnings = warnings or []


class ConfigRepository:
    """Repository for configuration management with validation."""

    def __init__(self):
        self._store = create_config_store()

    def read(self) -> tuple[dict[str, Any], str, Path]:
        """Read configuration from storage."""
        return self._store.read()

    @staticmethod
    def _normalize_validation_error(error: dict[str, Any]) -> dict[str, Any]:
        return {
            "path": [str(item) for item in error.get("loc", ())],
            "message": error.get("msg", "Invalid value"),
            "type": error.get("type", "validation_error"),
        }

    @staticmethod
    def _normalize_item(path: list[str], message: str, item_type: str) -> dict[str, Any]:
        return {
            "path": path,
            "message": message,
            "type": item_type,
        }

    @staticmethod
    def _validate_runtime_env(runtime_env: dict[str, str] | None) -> list[dict[str, Any]]:
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

    @staticmethod
    def _find_unresolved_env_placeholders(
        data: Any,
        *,
        path: list[str] | None = None,
    ) -> list[tuple[list[str], str]]:
        """Collect unresolved `$ENV_VAR` placeholders from raw config payload."""
        current_path = path or []
        findings: list[tuple[list[str], str]] = []

        if isinstance(data, str) and data.startswith("$"):
            env_name = data[1:]
            if env_name and os.getenv(env_name) is None:
                findings.append((current_path, env_name))
            return findings

        if isinstance(data, dict):
            for key, value in data.items():
                findings.extend(
                    ConfigRepository._find_unresolved_env_placeholders(
                        value,
                        path=[*current_path, str(key)],
                    )
                )
            return findings

        if isinstance(data, list):
            for index, value in enumerate(data):
                findings.extend(
                    ConfigRepository._find_unresolved_env_placeholders(
                        value,
                        path=[*current_path, str(index)],
                    )
                )

        return findings

    @staticmethod
    def _is_required_execution_path(path: list[str], config_dict: dict[str, Any]) -> bool:
        """Whether this config path belongs to currently active execution path."""
        if not path:
            return False

        section = path[0]

        # Active chat model: current runtime uses first model as default fallback.
        if section == "models" and len(path) > 1:
            return path[1] == "0"

        # Enabled tools: all configured tools are enabled candidates.
        if section == "tools" and len(path) > 1:
            tools = config_dict.get("tools")
            if not isinstance(tools, list):
                return False
            try:
                index = int(path[1])
            except ValueError:
                return False
            return 0 <= index < len(tools)

        # Sandbox is always part of runtime execution path.
        if section == "sandbox":
            return True

        return False

    def validate_with_warnings(self, config_dict: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Validate config and return (errors, warnings)."""
        payload = deepcopy(config_dict)
        payload = AppConfig.resolve_env_variables(payload, strict=False)
        payload["extensions"] = ExtensionsConfig.from_file().model_dump()

        errors: list[dict[str, Any]] = []
        warnings: list[dict[str, Any]] = []

        try:
            AppConfig.model_validate(payload)
        except ValidationError as exc:
            errors.extend(self._normalize_validation_error(item) for item in exc.errors())
            return errors, warnings

        errors.extend(self._validate_runtime_env(config_dict.get("runtime_env")))

        env_findings = self._find_unresolved_env_placeholders(config_dict)
        for path, env_name in env_findings:
            if self._is_required_execution_path(path, config_dict):
                errors.append(
                    self._normalize_item(
                        path,
                        f"Missing environment variable '{env_name}' required by active runtime path",
                        "missing_env",
                    )
                )
            else:
                warnings.append(
                    self._normalize_item(
                        path,
                        f"Environment variable '{env_name}' is not resolved (currently non-blocking)",
                        "missing_env_warning",
                    )
                )

        return errors, warnings

    def validate(self, config_dict: dict[str, Any]) -> list[dict[str, Any]]:
        """Backward-compatible validation API (errors only)."""
        errors, _ = self.validate_with_warnings(config_dict)
        return errors

    def write_with_warnings(self, config_dict: dict[str, Any], expected_version: str) -> tuple[str, list[dict[str, Any]]]:
        """Write configuration and return (new_version, warnings)."""
        errors, warnings = self.validate_with_warnings(config_dict)
        if errors:
            raise ConfigValidationError(errors=errors, warnings=warnings)

        new_version = self._store.write(config_dict=config_dict, expected_version=expected_version)

        # Reload configuration to apply changes in current process immediately.
        reload_app_config()
        return new_version, warnings

    def write(self, config_dict: dict[str, Any], expected_version: str) -> str:
        """Backward-compatible write API (returns version only)."""
        new_version, _ = self.write_with_warnings(config_dict, expected_version)
        return new_version

    def get_runtime_status(self) -> dict[str, Any]:
        """Get runtime configuration loading status."""
        return get_app_config_runtime_status(process_name="gateway")
