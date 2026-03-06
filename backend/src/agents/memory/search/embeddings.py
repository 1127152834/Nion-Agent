"""Embedding providers for memory search."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class EmbeddingProvider(ABC):
    """Abstract embedding provider."""

    @abstractmethod
    def embed(self, text: str) -> list[float]:
        """Embed one text input."""

    @abstractmethod
    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple text inputs."""


class SentenceTransformerEmbedding(EmbeddingProvider):
    """Sentence-transformers based local embedding provider."""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2") -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise ImportError(
                "sentence-transformers is required for SentenceTransformerEmbedding."
            ) from exc

        self._model = SentenceTransformer(model_name)

    def embed(self, text: str) -> list[float]:
        vector = self._model.encode(text)
        return vector.tolist()

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        vectors = self._model.encode(texts)
        return vectors.tolist()


class OpenAIEmbedding(EmbeddingProvider):
    """OpenAI embedding provider."""

    def __init__(
        self,
        model: str = "text-embedding-3-small",
        api_key: str | None = None,
        client: Any = None,
    ) -> None:
        if client is None:
            try:
                from openai import OpenAI
            except ImportError as exc:
                raise ImportError("openai is required for OpenAIEmbedding.") from exc
            client = OpenAI(api_key=api_key)

        self._client = client
        self._model = model

    def embed(self, text: str) -> list[float]:
        response = self._client.embeddings.create(model=self._model, input=text)
        return response.data[0].embedding

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        response = self._client.embeddings.create(model=self._model, input=texts)
        return [item.embedding for item in response.data]


__all__ = [
    "EmbeddingProvider",
    "SentenceTransformerEmbedding",
    "OpenAIEmbedding",
]
