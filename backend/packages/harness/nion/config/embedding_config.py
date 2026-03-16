"""Configuration for embedding models."""

from typing import Literal

from pydantic import BaseModel, Field


class LocalEmbeddingConfig(BaseModel):
    """Local sentence-transformers embedding configuration."""

    provider: Literal["local"] = Field(default="local")
    model: str = Field(default="all-MiniLM-L6-v2")
    device: str = Field(default="cpu")  # cpu, cuda, mps


class OpenAIEmbeddingConfig(BaseModel):
    """OpenAI embedding API configuration."""

    provider: Literal["openai"] = Field(default="openai")
    model: str = Field(default="text-embedding-3-small")
    api_key: str | None = Field(default="$OPENAI_API_KEY")
    dimension: int = Field(default=1536, ge=64, le=3072)


class CustomEmbeddingConfig(BaseModel):
    """Custom OpenAI-compatible embedding API configuration."""

    provider: Literal["custom"] = Field(default="custom")
    model: str = Field(default="")
    api_key: str | None = Field(default=None)
    api_base: str = Field(default="")
    dimension: int = Field(default=1536, ge=64, le=16384)


class EmbeddingConfig(BaseModel):
    """Embedding models configuration."""

    enabled: bool = Field(default=True)
    provider: Literal["local", "openai", "custom"] = Field(default="local")
    local: LocalEmbeddingConfig = Field(default_factory=LocalEmbeddingConfig)
    openai: OpenAIEmbeddingConfig = Field(default_factory=OpenAIEmbeddingConfig)
    custom: CustomEmbeddingConfig = Field(default_factory=CustomEmbeddingConfig)


# Preset models for easy selection
PRESET_LOCAL_MODELS = [
    {
        "id": "all-MiniLM-L6-v2",
        "name": "all-MiniLM-L6-v2",
        "display_name": "MiniLM L6 v2 (Multilingual)",
        "dimension": 384,
        "size_mb": 80,
        "description": "Fast and lightweight, good for general use",
        "languages": ["en", "zh", "multilingual"],
    },
    {
        "id": "paraphrase-multilingual-MiniLM-L12-v2",
        "name": "paraphrase-multilingual-MiniLM-L12-v2",
        "display_name": "Paraphrase Multilingual MiniLM L12 v2",
        "dimension": 384,
        "size_mb": 420,
        "description": "Better quality, supports 50+ languages",
        "languages": ["multilingual"],
    },
    {
        "id": "all-mpnet-base-v2",
        "name": "all-mpnet-base-v2",
        "display_name": "MPNet Base v2 (English)",
        "dimension": 768,
        "size_mb": 420,
        "description": "High quality for English text",
        "languages": ["en"],
    },
    {
        "id": "paraphrase-multilingual-mpnet-base-v2",
        "name": "paraphrase-multilingual-mpnet-base-v2",
        "display_name": "Paraphrase Multilingual MPNet Base v2",
        "dimension": 768,
        "size_mb": 970,
        "description": "Highest quality, supports 50+ languages",
        "languages": ["multilingual"],
    },
]

PRESET_OPENAI_MODELS = [
    {
        "id": "text-embedding-3-small",
        "name": "text-embedding-3-small",
        "display_name": "OpenAI Embedding 3 Small",
        "dimension": 1536,
        "description": "Cost-effective, good performance",
    },
    {
        "id": "text-embedding-3-large",
        "name": "text-embedding-3-large",
        "display_name": "OpenAI Embedding 3 Large",
        "dimension": 3072,
        "description": "Highest quality OpenAI embedding",
    },
    {
        "id": "text-embedding-ada-002",
        "name": "text-embedding-ada-002",
        "display_name": "OpenAI Ada 002 (Legacy)",
        "dimension": 1536,
        "description": "Legacy model, still supported",
    },
]


__all__ = [
    "EmbeddingConfig",
    "LocalEmbeddingConfig",
    "OpenAIEmbeddingConfig",
    "CustomEmbeddingConfig",
    "PRESET_LOCAL_MODELS",
    "PRESET_OPENAI_MODELS",
]
