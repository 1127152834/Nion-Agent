import logging
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any, Self

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field

from src.config.a2ui_config import A2UIConfig
from src.config.checkpointer_config import CheckpointerConfig, load_checkpointer_config_from_dict
from src.config.config_store import (
    DEFAULT_CHECKPOINTER_CONFIG,
    ConfigStoreNotInitializedError,
    create_config_store,
)
from src.config.extensions_config import ExtensionsConfig
from src.config.memory_config import load_memory_config_from_dict
from src.config.model_config import ModelConfig
from src.config.retrieval_models_config import RetrievalModelsConfig
from src.config.sandbox_config import SandboxConfig
from src.config.skills_config import SkillsConfig
from src.config.subagents_config import load_subagents_config_from_dict
from src.config.suggestions_config import load_suggestions_config_from_dict
from src.config.summarization_config import load_summarization_config_from_dict
from src.config.title_config import load_title_config_from_dict
from src.config.tool_config import ToolConfig, ToolGroupConfig

load_dotenv()
logger = logging.getLogger(__name__)


class AppConfig(BaseModel):
    """Config for the Nion application."""

    models: list[ModelConfig] = Field(default_factory=list, description="Available models")
    a2ui: A2UIConfig = Field(
        default_factory=A2UIConfig,
        description="A2UI (Agent-to-UI) configuration",
    )
    sandbox: SandboxConfig = Field(description="Sandbox configuration")
    tools: list[ToolConfig] = Field(default_factory=list, description="Available tools")
    tool_groups: list[ToolGroupConfig] = Field(default_factory=list, description="Available tool groups")
    skills: SkillsConfig = Field(default_factory=SkillsConfig, description="Skills configuration")
    extensions: ExtensionsConfig = Field(default_factory=ExtensionsConfig, description="Extensions configuration (MCP servers and skills state)")
    retrieval_models: RetrievalModelsConfig = Field(
        default_factory=RetrievalModelsConfig,
        description="Retrieval models configuration (embedding + rerank)",
    )
    model_config = ConfigDict(extra="allow", frozen=False)
    checkpointer: CheckpointerConfig | None = Field(default=None, description="Checkpointer configuration")

    @classmethod
    def resolve_config_path(cls, config_path: str | None = None) -> Path:
        """Resolve the config file path."""
        if config_path:
            path = Path(config_path)
            if not Path.exists(path):
                raise FileNotFoundError(f"Config file specified by param `config_path` not found at {path}")
            return path

        if os.getenv("NION_CONFIG_PATH"):
            path = Path(os.getenv("NION_CONFIG_PATH"))
            if not Path.exists(path):
                raise FileNotFoundError(
                    f"Config file specified by environment variable `NION_CONFIG_PATH` not found at {path}"
                )
            return path

        path = Path(os.getcwd()) / "config.yaml"
        if not path.exists():
            path = Path(os.getcwd()).parent / "config.yaml"
            if not path.exists():
                raise FileNotFoundError("`config.yaml` file not found at the current directory nor its parent directory")
        return path

    @classmethod
    def _hydrate_auxiliary_configs(cls, config_data: dict[str, Any]) -> None:
        """Load sub-config singletons from config payload."""
        if "title" in config_data:
            load_title_config_from_dict(config_data["title"])
        if "summarization" in config_data:
            load_summarization_config_from_dict(config_data["summarization"])
        if "memory" in config_data:
            load_memory_config_from_dict(config_data["memory"])
        if "subagents" in config_data:
            load_subagents_config_from_dict(config_data["subagents"])
        load_suggestions_config_from_dict(config_data.get("suggestions") or {})
        raw_checkpointer = config_data.get("checkpointer")
        if isinstance(raw_checkpointer, dict) and isinstance(raw_checkpointer.get("type"), str):
            raw_type = raw_checkpointer.get("type")
            if raw_type == "memory":
                load_checkpointer_config_from_dict({"type": "memory"})
                return
            if raw_type == "sqlite" and bool(raw_checkpointer.get("connection_string")):
                load_checkpointer_config_from_dict(raw_checkpointer)
                return

        fallback = dict(DEFAULT_CHECKPOINTER_CONFIG)
        config_data["checkpointer"] = fallback
        load_checkpointer_config_from_dict(fallback)

    @classmethod
    def _validate_payload(cls, payload: dict[str, Any], *, strict_env: bool) -> Self:
        resolved_payload = cls.resolve_env_variables(payload, strict=strict_env)
        cls._hydrate_auxiliary_configs(resolved_payload)
        extensions_config = ExtensionsConfig.from_file()
        resolved_payload["extensions"] = extensions_config.model_dump()
        return cls.model_validate(resolved_payload)

    @classmethod
    def from_file(cls, config_path: str | None = None, *, strict_env: bool = False) -> Self:
        """Load config from YAML file."""
        resolved_path = cls.resolve_config_path(config_path)
        with open(resolved_path, encoding="utf-8") as f:
            payload = yaml.safe_load(f) or {}
        if not isinstance(payload, dict):
            raise ValueError("Config file root must be a mapping object")
        return cls._validate_payload(payload, strict_env=strict_env)

    @classmethod
    def from_store_with_meta(cls, *, strict_env: bool = False) -> tuple[Self, str, Path]:
        """Load config from SQLite database with version/source metadata."""
        store = create_config_store()
        payload, version, db_path = store.read()
        if not isinstance(payload, dict):
            raise ValueError("Config store root must be a mapping object")
        config = cls._validate_payload(payload, strict_env=strict_env)
        return config, version, db_path

    @classmethod
    def from_store(cls, *, strict_env: bool = False) -> Self:
        """Load config from SQLite database."""
        config, _, _ = cls.from_store_with_meta(strict_env=strict_env)
        return config

    @classmethod
    def from_store_or_file_with_meta(
        cls,
        config_path: str | None = None,
        *,
        strict_env: bool = False,
    ) -> tuple[Self, str | None, Path | None, str]:
        """Load config from store first, fallback only on first initialization paths."""
        from src.config.migration import migrate_config_to_sqlite

        store = create_config_store()

        # If store already exists, any load failure must be explicit.
        if store.exists():
            try:
                config, version, source_path = cls.from_store_with_meta(strict_env=strict_env)
                return config, version, source_path, "sqlite"
            except Exception as exc:  # noqa: BLE001 - explicit fail-fast for existing store
                raise RuntimeError(f"Config store exists but failed to load: {exc}") from exc

        # Store not initialized: try one-time migration from YAML.
        try:
            yaml_path = cls.resolve_config_path(config_path) if config_path or os.getenv("NION_CONFIG_PATH") else None
            migrated = migrate_config_to_sqlite(yaml_path)
            if migrated:
                config, version, source_path = cls.from_store_with_meta(strict_env=strict_env)
                return config, version, source_path, "sqlite"
        except FileNotFoundError:
            pass
        except Exception as exc:  # noqa: BLE001 - keep startup resilient on first init only
            logger.warning("Config migration skipped due to error: %s", exc)

        # First-time fallback to YAML file.
        try:
            config = cls.from_file(config_path, strict_env=strict_env)
            source_path = cls.resolve_config_path(config_path)
            return config, None, source_path, "yaml"
        except FileNotFoundError:
            logger.warning("No config store and no config.yaml found, bootstrapping minimal default config")
            payload: dict[str, Any] = {
                "models": [],
                "tools": [],
                "tool_groups": [],
                "sandbox": {"use": "src.sandbox.local:LocalSandboxProvider"},
                "checkpointer": {"type": "sqlite", "connection_string": "checkpoints.db"},
                "extensions": ExtensionsConfig.from_file().model_dump(),
            }
            return cls.model_validate(payload), None, None, "default"

    @classmethod
    def from_store_or_file(cls, config_path: str | None = None, *, strict_env: bool = False) -> Self:
        """Load config from SQLite database or YAML file with migration."""
        config, _, _, _ = cls.from_store_or_file_with_meta(config_path, strict_env=strict_env)
        return config

    @classmethod
    def resolve_env_variables(cls, config: Any, *, strict: bool = True) -> Any:
        """Recursively resolve environment variables in config."""
        if isinstance(config, str):
            if config.startswith("$"):
                env_value = os.getenv(config[1:])
                if env_value is None:
                    if strict:
                        raise ValueError(f"Environment variable {config[1:]} not found for config value {config}")
                    return config
                return env_value
            return config
        if isinstance(config, dict):
            return {k: cls.resolve_env_variables(v, strict=strict) for k, v in config.items()}
        if isinstance(config, list):
            return [cls.resolve_env_variables(item, strict=strict) for item in config]
        return config

    def get_model_config(self, name: str) -> ModelConfig | None:
        """Get the model config by name."""
        return next((model for model in self.models if model.name == name), None)

    def get_tool_config(self, name: str) -> ToolConfig | None:
        """Get the tool config by name."""
        return next((tool for tool in self.tools if tool.name == name), None)

    def get_tool_group_config(self, name: str) -> ToolGroupConfig | None:
        """Get the tool group config by name."""
        return next((group for group in self.tool_groups if group.name == name), None)


_app_config: AppConfig | None = None
_app_config_version: str | None = None
_app_config_source_path: Path | None = None
_app_config_source_kind: str = "unknown"
_app_config_last_error: str | None = None
_app_config_last_loaded_at: str | None = None

_reload_lock = threading.Lock()
_last_version_check_at: float = 0.0
_last_checked_store_version: str | None = None
_MIN_RELOAD_INTERVAL_SECONDS = float(os.getenv("NION_CONFIG_RELOAD_THROTTLE_SECONDS", "0.8"))


def _detect_process_name(explicit: str | None = None) -> str:
    if explicit:
        return explicit
    if env_name := os.getenv("NION_RUNTIME_PROCESS_NAME"):
        return env_name

    argv_text = " ".join(sys.argv).lower()
    if "langgraph" in argv_text:
        return "langgraph"
    if "gateway" in argv_text or "uvicorn" in argv_text:
        return "gateway"
    return "runtime"


def _record_runtime_status(process_name: str, *, status: str, reason: str | None) -> None:
    """Best-effort persistence of process runtime status."""
    try:
        store = create_config_store()
        source_path = str(_app_config_source_path) if _app_config_source_path is not None else "unknown"
        tools_count = len(_app_config.tools) if _app_config is not None else None
        store.update_runtime_status(
            process_name,
            loaded_version=_app_config_version,
            source_path=source_path,
            tools_count=tools_count,
            status=status,
            reason=reason,
        )
    except Exception as exc:  # noqa: BLE001 - runtime status should not break main flow
        logger.debug("Failed to record runtime config status: %s", exc)


def _set_cached_config(
    config: AppConfig,
    *,
    version: str | None,
    source_path: Path | None,
    source_kind: str,
    process_name: str,
) -> AppConfig:
    global _app_config
    global _app_config_version
    global _app_config_source_path
    global _app_config_source_kind
    global _app_config_last_error
    global _app_config_last_loaded_at

    _app_config = config
    _app_config_version = version
    _app_config_source_path = source_path
    _app_config_source_kind = source_kind
    _app_config_last_error = None
    _app_config_last_loaded_at = time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime())

    logger.info(
        "Config loaded: source=%s path=%s version=%s tools_count=%d",
        source_kind,
        source_path,
        version,
        len(config.tools),
    )
    _record_runtime_status(process_name, status="ok", reason=None)
    return config


def _load_and_cache(config_path: str | None = None, *, process_name: str | None = None) -> AppConfig:
    process = _detect_process_name(process_name)
    try:
        config, version, source_path, source_kind = AppConfig.from_store_or_file_with_meta(
            config_path,
            strict_env=False,
        )
        return _set_cached_config(
            config,
            version=version,
            source_path=source_path,
            source_kind=source_kind,
            process_name=process,
        )
    except Exception as exc:  # noqa: BLE001
        global _app_config_last_error
        _app_config_last_error = str(exc)
        _record_runtime_status(process, status="error", reason=str(exc))
        raise


def get_app_config(*, process_name: str | None = None) -> AppConfig:
    """Get the cached config, loading it on first access."""
    global _app_config
    if _app_config is None:
        return _load_and_cache(process_name=process_name)
    return _app_config


def reload_app_config(config_path: str | None = None, *, process_name: str | None = None) -> AppConfig:
    """Force reload config from store/file and replace cache."""
    with _reload_lock:
        return _load_and_cache(config_path, process_name=process_name)


def ensure_latest_app_config(*, process_name: str | None = None) -> AppConfig:
    """Lazily reload config when SQLite version changed.

    This is designed for long-running processes (e.g. LangGraph worker) to
    pick up config changes without restart.
    """
    global _last_version_check_at
    global _last_checked_store_version

    process = _detect_process_name(process_name)

    with _reload_lock:
        current = get_app_config(process_name=process)

        now = time.monotonic()
        if now - _last_version_check_at < _MIN_RELOAD_INTERVAL_SECONDS:
            return current
        _last_version_check_at = now

        store = create_config_store()
        try:
            store_version, _ = store.read_version()
        except ConfigStoreNotInitializedError:
            return current

        if _app_config_version == store_version:
            _last_checked_store_version = store_version
            return current

        logger.info(
            "Detected config version update: cached=%s store=%s; reloading",
            _app_config_version,
            store_version,
        )

        try:
            config, version, source_path = AppConfig.from_store_with_meta(strict_env=False)
            _last_checked_store_version = version
            return _set_cached_config(
                config,
                version=version,
                source_path=source_path,
                source_kind="sqlite",
                process_name=process,
            )
        except Exception as exc:  # noqa: BLE001
            global _app_config_last_error
            _app_config_last_error = str(exc)
            _record_runtime_status(process, status="error", reason=str(exc))
            raise RuntimeError(f"Failed to reload updated config version {store_version}: {exc}") from exc


def get_app_config_runtime_status(*, process_name: str | None = None) -> dict[str, Any]:
    """Return runtime config status for observability."""
    process = _detect_process_name(process_name)

    store = create_config_store()
    try:
        store_version, store_path = store.read_version()
        store_source_path: str | None = str(store_path)
    except ConfigStoreNotInitializedError:
        store_version = None
        store_source_path = None

    runtime_processes = store.read_runtime_statuses()

    return {
        "process_name": process,
        "store_version": store_version,
        "store_source_path": store_source_path,
        "loaded_version": _app_config_version,
        "loaded_source_path": str(_app_config_source_path) if _app_config_source_path is not None else None,
        "source_kind": _app_config_source_kind,
        "tools_count": len(_app_config.tools) if _app_config is not None else 0,
        "loaded_tools": [tool.name for tool in _app_config.tools] if _app_config is not None else [],
        "last_loaded_at": _app_config_last_loaded_at,
        "last_error": _app_config_last_error,
        "runtime_processes": runtime_processes,
        "is_in_sync": bool(_app_config_version) and _app_config_version == store_version,
    }


def reset_app_config() -> None:
    """Reset cached config state (mainly for tests)."""
    global _app_config
    global _app_config_version
    global _app_config_source_path
    global _app_config_source_kind
    global _app_config_last_error
    global _app_config_last_loaded_at
    global _last_version_check_at
    global _last_checked_store_version

    _app_config = None
    _app_config_version = None
    _app_config_source_path = None
    _app_config_source_kind = "unknown"
    _app_config_last_error = None
    _app_config_last_loaded_at = None
    _last_version_check_at = 0.0
    _last_checked_store_version = None


def set_app_config(config: AppConfig, *, version: str | None = None, source_path: Path | None = None) -> None:
    """Inject custom config instance (mainly for tests)."""
    global _app_config
    global _app_config_version
    global _app_config_source_path
    global _app_config_source_kind
    global _app_config_last_error
    global _app_config_last_loaded_at

    _app_config = config
    _app_config_version = version
    _app_config_source_path = source_path
    _app_config_source_kind = "injected"
    _app_config_last_error = None
    _app_config_last_loaded_at = time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime())
