"""Tests for suggestions configuration singleton."""

from nion.config.suggestions_config import (
    SuggestionsConfig,
    get_suggestions_config,
    load_suggestions_config_from_dict,
    set_suggestions_config,
)


def _clone_config(config: SuggestionsConfig) -> SuggestionsConfig:
    return SuggestionsConfig(**config.model_dump())


def test_default_suggestions_config() -> None:
    config = SuggestionsConfig()
    assert config.model_name is None


def test_load_suggestions_config_from_dict() -> None:
    original = _clone_config(get_suggestions_config())
    try:
        load_suggestions_config_from_dict({"model_name": "suggest-model"})
        assert get_suggestions_config().model_name == "suggest-model"

        load_suggestions_config_from_dict({})
        assert get_suggestions_config().model_name is None
    finally:
        set_suggestions_config(original)
