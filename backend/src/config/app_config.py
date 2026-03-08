import os
from pathlib import Path
from typing import Any, Self

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field

from src.config.checkpointer_config import CheckpointerConfig, load_checkpointer_config_from_dict
from src.config.extensions_config import ExtensionsConfig
from src.config.memory_config import load_memory_config_from_dict
from src.config.model_config import ModelConfig
from src.config.retrieval_models_config import RetrievalModelsConfig, RetrievalActiveConfig, ActiveEmbeddingConfig, ActiveRerankConfig
from src.config.sandbox_config import SandboxConfig
from src.config.skills_config import SkillsConfig
from src.config.subagents_config import load_subagents_config_from_dict
from src.config.summarization_config import load_summarization_config_from_dict
from src.config.title_config import load_title_config_from_dict
from src.config.tool_config import ToolConfig, ToolGroupConfig

load_dotenv()


class AppConfig(BaseModel):
    """Config for the Nion application"""

    models: list[ModelConfig] = Field(default_factory=list, description="Available models")
    sandbox: SandboxConfig = Field(description="Sandbox configuration")
    tools: list[ToolConfig] = Field(default_factory=list, description="Available tools")
    tool_groups: list[ToolGroupConfig] = Field(default_factory=list, description="Available tool groups")
    skills: SkillsConfig = Field(default_factory=SkillsConfig, description="Skills configuration")
    extensions: ExtensionsConfig = Field(default_factory=ExtensionsConfig, description="Extensions configuration (MCP servers and skills state)")
    retrieval_models: RetrievalModelsConfig = Field(
        default_factory=RetrievalModelsConfig,
        description="Retrieval models configuration (embedding + rerank)"
    )
    model_config = ConfigDict(extra="allow", frozen=False)
    checkpointer: CheckpointerConfig | None = Field(default=None, description="Checkpointer configuration")

    @classmethod
    def resolve_config_path(cls, config_path: str | None = None) -> Path:
        """Resolve the config file path.

        Priority:
        1. If provided `config_path` argument, use it.
        2. If provided `NION_CONFIG_PATH` environment variable, use it.
        3. Otherwise, first check the `config.yaml` in the current directory, then fallback to `config.yaml` in the parent directory.
        """
        if config_path:
            path = Path(config_path)
            if not Path.exists(path):
                raise FileNotFoundError(f"Config file specified by param `config_path` not found at {path}")
            return path
        elif os.getenv("NION_CONFIG_PATH"):
            path = Path(os.getenv("NION_CONFIG_PATH"))
            if not Path.exists(path):
                raise FileNotFoundError(f"Config file specified by environment variable `NION_CONFIG_PATH` not found at {path}")
            return path
        else:
            # Check if the config.yaml is in the current directory
            path = Path(os.getcwd()) / "config.yaml"
            if not path.exists():
                # Check if the config.yaml is in the parent directory of CWD
                path = Path(os.getcwd()).parent / "config.yaml"
                if not path.exists():
                    raise FileNotFoundError("`config.yaml` file not found at the current directory nor its parent directory")
            return path

    @classmethod
    def from_file(cls, config_path: str | None = None) -> Self:
        """Load config from YAML file.

        See `resolve_config_path` for more details.

        Args:
            config_path: Path to the config file.

        Returns:
            AppConfig: The loaded config.
        """
        resolved_path = cls.resolve_config_path(config_path)
        with open(resolved_path, encoding="utf-8") as f:
            config_data = yaml.safe_load(f)
        config_data = cls.resolve_env_variables(config_data)

        # Load title config if present
        if "title" in config_data:
            load_title_config_from_dict(config_data["title"])

        # Load summarization config if present
        if "summarization" in config_data:
            load_summarization_config_from_dict(config_data["summarization"])

        # Load memory config if present
        if "memory" in config_data:
            load_memory_config_from_dict(config_data["memory"])

        # Load subagents config if present
        if "subagents" in config_data:
            load_subagents_config_from_dict(config_data["subagents"])

        # Load checkpointer config if present
        if "checkpointer" in config_data:
            load_checkpointer_config_from_dict(config_data["checkpointer"])

        # Load extensions config separately (it's in a different file)
        extensions_config = ExtensionsConfig.from_file()
        config_data["extensions"] = extensions_config.model_dump()

        result = cls.model_validate(config_data)
        return result

    @classmethod
    def from_store(cls) -> Self:
        """Load config from SQLite database.

        Returns:
            AppConfig: The loaded config.

        Raises:
            Exception: If config store is not initialized or read fails.
        """
        from src.config.config_store import create_config_store

        store = create_config_store()
        config_data, version, db_path = store.read()
        config_data = cls.resolve_env_variables(config_data)

        # Load title config if present
        if "title" in config_data:
            load_title_config_from_dict(config_data["title"])

        # Load summarization config if present
        if "summarization" in config_data:
            load_summarization_config_from_dict(config_data["summarization"])

        # Load memory config if present
        if "memory" in config_data:
            load_memory_config_from_dict(config_data["memory"])

        # Load subagents config if present
        if "subagents" in config_data:
            load_subagents_config_from_dict(config_data["subagents"])

        # Load extensions config separately (it's in a different file)
        extensions_config = ExtensionsConfig.from_file()
        config_data["extensions"] = extensions_config.model_dump()

        result = cls.model_validate(config_data)
        return result

    @classmethod
    def from_store_or_file(cls, config_path: str | None = None) -> Self:
        """Load config from SQLite database or YAML file with automatic migration.

        Priority:
        1. Try to load from SQLite database
        2. If SQLite doesn't exist, load from config.yaml and migrate to SQLite
        3. If config.yaml doesn't exist, use default configuration

        Args:
            config_path: Optional path to config.yaml file (for migration)

        Returns:
            AppConfig: The loaded config.
        """
        from src.config.migration import migrate_config_to_sqlite

        # Try to load from SQLite first
        try:
            return cls.from_store()
        except Exception:
            # SQLite doesn't exist or failed to load, try migration
            pass

        # Try to migrate from config.yaml
        try:
            yaml_path = cls.resolve_config_path(config_path) if config_path or os.getenv("NION_CONFIG_PATH") else None
            migrated = migrate_config_to_sqlite(yaml_path)
            if migrated:
                # Migration successful, load from SQLite
                return cls.from_store()
        except FileNotFoundError:
            # config.yaml doesn't exist, will use default config
            pass
        except Exception as e:
            # Migration failed, fall back to loading from file
            import logging

            logging.warning(f"Config migration failed: {e}, falling back to YAML file")

        # Fall back to loading from YAML file
        try:
            return cls.from_file(config_path)
        except FileNotFoundError:
            # No config file found, use default configuration
            import logging

            logging.warning("No config file found, using default configuration")
            # Return minimal default config
            return cls.model_validate(
                {
                    "models": [],
                    "tools": [],
                    "tool_groups": [],
                    "sandbox": {"use": "src.sandbox.local:LocalSandboxProvider"},
                    "extensions": ExtensionsConfig.from_file().model_dump(),
                }
            )

    @classmethod
    def resolve_env_variables(cls, config: Any) -> Any:
        """Recursively resolve environment variables in the config.

        Environment variables are resolved using the `os.getenv` function. Example: $OPENAI_API_KEY

        Args:
            config: The config to resolve environment variables in.

        Returns:
            The config with environment variables resolved.
        """
        if isinstance(config, str):
            if config.startswith("$"):
                env_value = os.getenv(config[1:])
                if env_value is None:
                    raise ValueError(f"Environment variable {config[1:]} not found for config value {config}")
                return env_value
            return config
        elif isinstance(config, dict):
            return {k: cls.resolve_env_variables(v) for k, v in config.items()}
        elif isinstance(config, list):
            return [cls.resolve_env_variables(item) for item in config]
        return config

    def get_model_config(self, name: str) -> ModelConfig | None:
        """Get the model config by name.

        Args:
            name: The name of the model to get the config for.

        Returns:
            The model config if found, otherwise None.
        """
        return next((model for model in self.models if model.name == name), None)

    def get_tool_config(self, name: str) -> ToolConfig | None:
        """Get the tool config by name.

        Args:
            name: The name of the tool to get the config for.

        Returns:
            The tool config if found, otherwise None.
        """
        return next((tool for tool in self.tools if tool.name == name), None)

    def get_tool_group_config(self, name: str) -> ToolGroupConfig | None:
        """Get the tool group config by name.

        Args:
            name: The name of the tool group to get the config for.

        Returns:
            The tool group config if found, otherwise None.
        """
        return next((group for group in self.tool_groups if group.name == name), None)


_app_config: AppConfig | None = None


def get_app_config() -> AppConfig:
    """Get the Nion config instance.

    Returns a cached singleton instance. Use `reload_app_config()` to reload
    from file, or `reset_app_config()` to clear the cache.

    Configuration is loaded from SQLite database if available, otherwise
    from config.yaml with automatic migration to SQLite.
    """
    global _app_config
    if _app_config is None:
        _app_config = AppConfig.from_store_or_file()
    return _app_config


def reload_app_config(config_path: str | None = None) -> AppConfig:
    """Reload the config from storage and update the cached instance.

    This is useful when the config has been modified and you want
    to pick up the changes without restarting the application.

    Configuration is loaded from SQLite database if available, otherwise
    from config.yaml with automatic migration to SQLite.

    Args:
        config_path: Optional path to config file. If not provided,
                     uses the default resolution strategy.

    Returns:
        The newly loaded AppConfig instance.
    """
    global _app_config
    _app_config = AppConfig.from_store_or_file(config_path)
    return _app_config


def reset_app_config() -> None:
    """Reset the cached config instance.

    This clears the singleton cache, causing the next call to
    `get_app_config()` to reload from file. Useful for testing
    or when switching between different configurations.
    """
    global _app_config
    _app_config = None


def set_app_config(config: AppConfig) -> None:
    """Set a custom config instance.

    This allows injecting a custom or mock config for testing purposes.

    Args:
        config: The AppConfig instance to use.
    """
    global _app_config
    _app_config = config
