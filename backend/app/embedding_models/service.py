"""Embedding models service for managing and testing embedding providers."""

from __future__ import annotations

import logging
import os
from typing import Any

from nion.config import get_app_config
from nion.config.config_repository import ConfigRepository
from nion.config.embedding_config import PRESET_LOCAL_MODELS, PRESET_OPENAI_MODELS, EmbeddingConfig

logger = logging.getLogger(__name__)


class EmbeddingModelsError(Exception):
    """Base exception for embedding models errors."""

    def __init__(self, message: str, error_code: str = "unknown_error"):
        super().__init__(message)
        self.error_code = error_code


class EmbeddingModelsService:
    """Service for managing embedding model settings and connectivity tests."""

    def _resolve_embedding_config(self) -> EmbeddingConfig:
        """Read and normalize embedding config from runtime app config."""
        app_config = get_app_config()
        raw_embedding = getattr(app_config, "embedding", None)
        if raw_embedding is None:
            return EmbeddingConfig(enabled=False)

        try:
            if isinstance(raw_embedding, EmbeddingConfig):
                return raw_embedding
            if isinstance(raw_embedding, dict):
                return EmbeddingConfig.model_validate(raw_embedding)
            if hasattr(raw_embedding, "model_dump"):
                return EmbeddingConfig.model_validate(raw_embedding.model_dump())
            return EmbeddingConfig.model_validate(raw_embedding)
        except Exception as error:
            raise EmbeddingModelsError(
                f"Invalid embedding config: {error}",
                "invalid_config",
            ) from error

    def get_status(self) -> dict[str, Any]:
        """Get current embedding models status."""
        embedding_config = self._resolve_embedding_config()
        if not embedding_config.enabled:
            return {
                "enabled": False,
                "provider": None,
                "model": None,
                "status": "disabled",
            }

        provider = embedding_config.provider
        provider_config = getattr(embedding_config, provider, None)
        if provider_config is None:
            raise EmbeddingModelsError(f"Provider {provider} not configured", "not_configured")

        return {
            "enabled": True,
            "provider": provider,
            "model": provider_config.model,
            "dimension": getattr(provider_config, "dimension", None),
            "device": getattr(provider_config, "device", None),
            "api_base": getattr(provider_config, "api_base", None),
            "status": "ok",
        }

    def get_presets(self) -> dict[str, Any]:
        """Get preset models list."""
        return {
            "local": PRESET_LOCAL_MODELS,
            "openai": PRESET_OPENAI_MODELS,
        }

    async def test_embedding(self, text: str = "test embedding") -> dict[str, Any]:
        """Test current embedding configuration."""
        embedding_config = self._resolve_embedding_config()
        if not embedding_config.enabled:
            raise EmbeddingModelsError("Embedding models are disabled", "disabled")

        provider = embedding_config.provider
        provider_config = getattr(embedding_config, provider, None)
        if provider_config is None:
            raise EmbeddingModelsError(f"Provider {provider} not configured", "not_configured")

        try:
            if provider == "local":
                return await self._test_local_embedding(provider_config, text)
            if provider == "openai":
                return await self._test_openai_embedding(provider_config, text)
            if provider == "custom":
                return await self._test_custom_embedding(provider_config, text)
            raise EmbeddingModelsError(f"Unknown provider: {provider}", "unknown_provider")
        except EmbeddingModelsError:
            raise
        except Exception as error:
            logger.exception("Embedding test failed")
            raise EmbeddingModelsError(f"Test failed: {error}", "test_failed") from error

    async def _test_local_embedding(self, config: Any, text: str) -> dict[str, Any]:
        """Test local sentence-transformers embedding."""
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as error:
            raise EmbeddingModelsError(
                "sentence-transformers not installed. Run: pip install sentence-transformers",
                "missing_dependency",
            ) from error

        try:
            model = SentenceTransformer(config.model, device=config.device)
            embedding = model.encode(text)
            return {
                "success": True,
                "provider": "local",
                "model": config.model,
                "dimension": len(embedding),
                "sample": embedding[:5].tolist() if len(embedding) >= 5 else embedding.tolist(),
            }
        except Exception as error:
            raise EmbeddingModelsError(f"Local embedding failed: {error}", "local_error") from error

    async def _test_openai_embedding(self, config: Any, text: str) -> dict[str, Any]:
        """Test OpenAI embedding API."""
        try:
            from openai import OpenAI
        except ImportError as error:
            raise EmbeddingModelsError(
                "openai not installed. Run: pip install openai",
                "missing_dependency",
            ) from error

        api_key = config.api_key
        if api_key and api_key.startswith("$"):
            api_key = os.getenv(api_key[1:])
        if not api_key:
            raise EmbeddingModelsError("OpenAI API key not configured", "missing_api_key")

        try:
            client = OpenAI(api_key=api_key)
            response = client.embeddings.create(
                model=config.model,
                input=text,
                dimensions=config.dimension if config.dimension != 1536 else None,
            )
            embedding = response.data[0].embedding
            return {
                "success": True,
                "provider": "openai",
                "model": config.model,
                "dimension": len(embedding),
                "sample": embedding[:5],
            }
        except Exception as error:
            raise EmbeddingModelsError(f"OpenAI embedding failed: {error}", "openai_error") from error

    async def _test_custom_embedding(self, config: Any, text: str) -> dict[str, Any]:
        """Test custom OpenAI-compatible embedding API."""
        try:
            from openai import OpenAI
        except ImportError as error:
            raise EmbeddingModelsError(
                "openai not installed. Run: pip install openai",
                "missing_dependency",
            ) from error

        if not config.api_base:
            raise EmbeddingModelsError("Custom API base URL not configured", "missing_api_base")

        api_key = config.api_key or "dummy"
        try:
            client = OpenAI(api_key=api_key, base_url=config.api_base)
            response = client.embeddings.create(
                model=config.model,
                input=text,
            )
            embedding = response.data[0].embedding
            return {
                "success": True,
                "provider": "custom",
                "model": config.model,
                "api_base": config.api_base,
                "dimension": len(embedding),
                "sample": embedding[:5],
            }
        except Exception as error:
            raise EmbeddingModelsError(f"Custom embedding failed: {error}", "custom_error") from error

    def set_active_model(
        self,
        provider: str,
        model: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Set active embedding model and persist to config storage."""
        if provider not in {"local", "openai", "custom"}:
            raise EmbeddingModelsError(f"Unsupported provider: {provider}", "unsupported_provider")
        if not model.strip():
            raise EmbeddingModelsError("Model cannot be empty", "invalid_model")

        repo = ConfigRepository()
        try:
            config_data, version, source_path = repo.read()
            embedding_data = config_data.get("embedding")
            if not isinstance(embedding_data, dict):
                embedding_data = {}

            embedding_data["enabled"] = True
            embedding_data["provider"] = provider

            local_config = embedding_data.get("local")
            openai_config = embedding_data.get("openai")
            custom_config = embedding_data.get("custom")
            if not isinstance(local_config, dict):
                local_config = {}
            if not isinstance(openai_config, dict):
                openai_config = {}
            if not isinstance(custom_config, dict):
                custom_config = {}

            if provider == "local":
                local_config["model"] = model
                if kwargs.get("device") is not None:
                    local_config["device"] = kwargs["device"]
            elif provider == "openai":
                openai_config["model"] = model
                if kwargs.get("api_key") is not None:
                    openai_config["api_key"] = kwargs["api_key"]
                if kwargs.get("dimension") is not None:
                    openai_config["dimension"] = kwargs["dimension"]
            elif provider == "custom":
                custom_config["model"] = model
                if kwargs.get("api_base") is not None:
                    custom_config["api_base"] = kwargs["api_base"]
                if kwargs.get("api_key") is not None:
                    custom_config["api_key"] = kwargs["api_key"]
                if kwargs.get("dimension") is not None:
                    custom_config["dimension"] = kwargs["dimension"]

            embedding_data["local"] = local_config
            embedding_data["openai"] = openai_config
            embedding_data["custom"] = custom_config
            config_data["embedding"] = embedding_data

            new_version = repo.write(config_dict=config_data, expected_version=version)
            logger.info("Updated embedding config provider=%s model=%s version=%s", provider, model, new_version)
            return {
                "success": True,
                "provider": provider,
                "model": model,
                "message": "Embedding model configuration updated.",
                "config_source": str(source_path),
                "version": new_version,
            }
        except EmbeddingModelsError:
            raise
        except Exception as error:
            logger.exception("Failed to persist embedding configuration")
            raise EmbeddingModelsError(f"Failed to save configuration: {error}", "save_failed") from error


__all__ = ["EmbeddingModelsService", "EmbeddingModelsError"]
