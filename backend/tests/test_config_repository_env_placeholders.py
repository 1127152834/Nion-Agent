from __future__ import annotations

import pytest

from src.config.app_config import AppConfig
from src.config.config_repository import ConfigRepository
from src.config.config_store import create_config_store


@pytest.fixture
def base_config() -> dict:
    return {
        "models": [
            {
                "name": "default-model",
                "use": "langchain_openai.ChatOpenAI",
                "model": "gpt-4o-mini",
                "api_key": "dummy-key",
            }
        ],
        "tools": [
            {
                "name": "write_file",
                "group": "file",
                "use": "src.tools.builtins:write_file_tool",
            }
        ],
        "tool_groups": [{"name": "file"}],
        "sandbox": {
            "use": "src.sandbox.local:LocalSandboxProvider",
        },
    }


def test_validate_non_active_missing_env_is_warning(monkeypatch, base_config: dict) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    config_dict = {
        **base_config,
        "retrieval_models": {
            "providers": {
                "openai_embedding": {
                    "enabled": True,
                    "api_base": "https://api.openai.com/v1",
                    "api_key": "$OPENAI_API_KEY",
                    "timeout_ms": 30000,
                }
            }
        },
    }

    repository = ConfigRepository()
    errors, warnings = repository.validate_with_warnings(config_dict)

    assert errors == []
    assert len(warnings) == 1
    assert warnings[0]["path"] == ["retrieval_models", "providers", "openai_embedding", "api_key"]


def test_validate_active_model_missing_env_is_error(monkeypatch, base_config: dict) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    config_dict = {
        **base_config,
        "models": [
            {
                "name": "default-model",
                "use": "langchain_openai.ChatOpenAI",
                "model": "gpt-4o-mini",
                "api_key": "$OPENAI_API_KEY",
            }
        ],
    }

    repository = ConfigRepository()
    errors, warnings = repository.validate_with_warnings(config_dict)

    assert warnings == []
    assert len(errors) == 1
    assert errors[0]["type"] == "missing_env"
    assert errors[0]["path"] == ["models", "0", "api_key"]


def test_store_exists_parse_failure_does_not_fallback(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "config.db"
    monkeypatch.setenv("NION_CONFIG_DB_PATH", str(db_path))

    store = create_config_store()
    _, version, _ = store.read()

    invalid_config = {
        "models": "broken",
        "tools": [],
        "tool_groups": [],
        "sandbox": {"use": "src.sandbox.local:LocalSandboxProvider"},
    }
    store.write(invalid_config, expected_version=version)

    with pytest.raises(RuntimeError, match="Config store exists but failed to load"):
        AppConfig.from_store_or_file()
