"""Configuration models for retrieval models (embedding + rerank)."""

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class OpenAICompatibleEmbeddingProviderConfig(BaseModel):
    enabled: bool = Field(default=False)
    name: str = Field(default="OpenAI-compatible Embedding")
    protocol: Literal["openai_compatible"] = Field(default="openai_compatible")
    model: str = Field(default="text-embedding-3-small")
    api_key: str | None = Field(default="$OPENAI_API_KEY")
    api_base: str | None = Field(default=None)
    timeout_ms: int = Field(default=12_000, ge=1_000, le=120_000)
    dimension: int = Field(default=1536, ge=64, le=16384)
    input: str = Field(default="text")


class RerankAPIProviderConfig(BaseModel):
    enabled: bool = Field(default=False)
    name: str = Field(default="Rerank API")
    protocol: Literal["rerank_api"] = Field(default="rerank_api")
    model: str = Field(default="jina-reranker-v2-base-multilingual")
    api_key: str | None = Field(default=None)
    api_base: str | None = Field(default=None)
    path: str = Field(default="/rerank")
    timeout_ms: int = Field(default=12_000, ge=1_000, le=120_000)


class RetrievalProvidersConfig(BaseModel):
    openai_embedding: OpenAICompatibleEmbeddingProviderConfig = Field(
        default_factory=OpenAICompatibleEmbeddingProviderConfig
    )
    rerank_api: RerankAPIProviderConfig = Field(default_factory=RerankAPIProviderConfig)


class EmbeddingProfileConfig(BaseModel):
    provider: Literal["local_onnx", "openai_compatible"] = Field(default="local_onnx")
    model_id: str | None = Field(default=None)
    model: str | None = Field(default=None)


class RerankProfileConfig(BaseModel):
    provider: Literal["local_onnx", "rerank_api"] = Field(default="local_onnx")
    model_id: str | None = Field(default=None)
    model: str | None = Field(default=None)


class RetrievalProfileConfig(BaseModel):
    embedding: EmbeddingProfileConfig = Field(default_factory=EmbeddingProfileConfig)
    rerank: RerankProfileConfig = Field(default_factory=RerankProfileConfig)


def _default_profiles() -> dict[str, RetrievalProfileConfig]:
    return {
        "zh": RetrievalProfileConfig(
            embedding=EmbeddingProfileConfig(
                provider="local_onnx",
                model_id="zh-embedding-lite",
            ),
            rerank=RerankProfileConfig(
                provider="local_onnx",
                model_id="zh-rerank-lite",
            ),
        ),
        "en": RetrievalProfileConfig(
            embedding=EmbeddingProfileConfig(
                provider="local_onnx",
                model_id="en-embedding-lite",
            ),
            rerank=RerankProfileConfig(
                provider="local_onnx",
                model_id="en-rerank-lite",
            ),
        ),
    }


class ActiveEmbeddingConfig(BaseModel):
    provider: Literal["local_onnx", "openai_compatible"] = Field(default="local_onnx")
    model_id: str | None = Field(default=None)
    model: str | None = Field(default=None)


class ActiveRerankConfig(BaseModel):
    provider: Literal["local_onnx", "rerank_api"] = Field(default="local_onnx")
    model_id: str | None = Field(default=None)
    model: str | None = Field(default=None)


class RetrievalActiveConfig(BaseModel):
    embedding: ActiveEmbeddingConfig = Field(default_factory=ActiveEmbeddingConfig)
    rerank: ActiveRerankConfig = Field(default_factory=ActiveRerankConfig)


def _default_active() -> RetrievalActiveConfig:
    return RetrievalActiveConfig(
        embedding=ActiveEmbeddingConfig(provider="local_onnx", model_id=None),
        rerank=ActiveRerankConfig(provider="local_onnx", model_id=None),
    )


class RetrievalModelsConfig(BaseModel):
    enabled: bool = Field(default=True)
    active: RetrievalActiveConfig = Field(default_factory=_default_active)
    source_priority: list[Literal["modelscope", "manual_import"]] = Field(
        default_factory=lambda: ["modelscope", "manual_import"]
    )
    providers: RetrievalProvidersConfig = Field(default_factory=RetrievalProvidersConfig)
    local_models_dir: str | None = Field(default=None)
    registry_file: str | None = Field(default=None)

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_profile_payload(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        if "active" in data:
            return data
        if "active_profile" not in data and "profiles" not in data:
            return data

        legacy_profiles = data.get("profiles")
        active_profile = str(data.get("active_profile") or "zh").strip() or "zh"
        profile_data: Any = None
        if isinstance(legacy_profiles, dict):
            profile_data = legacy_profiles.get(active_profile)

        if not isinstance(profile_data, dict):
            default_profile = _default_profiles().get(active_profile) or _default_profiles()["zh"]
            profile_data = default_profile.model_dump(exclude_none=True)

        embedding_payload = profile_data.get("embedding") if isinstance(profile_data, dict) else {}
        rerank_payload = profile_data.get("rerank") if isinstance(profile_data, dict) else {}
        if not isinstance(embedding_payload, dict):
            embedding_payload = {}
        if not isinstance(rerank_payload, dict):
            rerank_payload = {}

        migrated = dict(data)
        migrated["active"] = {
            "embedding": {
                "provider": embedding_payload.get("provider", "local_onnx"),
                "model_id": embedding_payload.get("model_id"),
                "model": embedding_payload.get("model"),
            },
            "rerank": {
                "provider": rerank_payload.get("provider", "local_onnx"),
                "model_id": rerank_payload.get("model_id"),
                "model": rerank_payload.get("model"),
            },
        }
        return migrated
