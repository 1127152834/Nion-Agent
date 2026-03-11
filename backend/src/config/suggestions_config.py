"""Configuration for follow-up suggestions generation."""

from pydantic import BaseModel, Field


class SuggestionsConfig(BaseModel):
    """Configuration for follow-up suggestions generation."""

    model_name: str | None = Field(
        default=None,
        description="Global model override for follow-up suggestions (None = use request fallback)",
    )


_suggestions_config: SuggestionsConfig = SuggestionsConfig()


def get_suggestions_config() -> SuggestionsConfig:
    """Get the current suggestions configuration."""
    return _suggestions_config


def set_suggestions_config(config: SuggestionsConfig) -> None:
    """Set the suggestions configuration."""
    global _suggestions_config
    _suggestions_config = config


def load_suggestions_config_from_dict(config_dict: dict) -> None:
    """Load suggestions configuration from a dictionary."""
    global _suggestions_config
    _suggestions_config = SuggestionsConfig(**config_dict)
