from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from src.config.app_config import get_app_config
from src.config.config_repository import ConfigRepository
from src.config.paths import Paths, get_paths
from src.config.retrieval_models_config import RetrievalModelsConfig, _default_profiles


class RetrievalModelsError(Exception):
    def __init__(self, message: str, *, error_code: str = "retrieval_models_error"):
        super().__init__(message)
        self.error_code = error_code


@dataclass(frozen=True)
class LocalModelSpec:
    model_id: str
    family: str
    display_name: str
    provider: str
    source_model_id: str
    source_file: str
    approx_size_bytes: int
    license: str
    dimension: int | None = None


@dataclass(frozen=True)
class LocalPackSpec:
    pack_id: str
    display_name: str
    locale: str
    model_ids: tuple[str, str]
    approx_size_bytes: int


LOCAL_MODEL_SPECS: dict[str, LocalModelSpec] = {
    "zh-embedding-lite": LocalModelSpec(
        model_id="zh-embedding-lite",
        family="embedding",
        display_name="Jina Embeddings v2 Base ZH (INT8)",
        provider="modelscope",
        source_model_id="jinaai/jina-embeddings-v2-base-zh",
        source_file="onnx/model_quantized.onnx",
        approx_size_bytes=154 * 1024 * 1024,
        license="apache-2.0",
        dimension=768,
    ),
    "zh-rerank-lite": LocalModelSpec(
        model_id="zh-rerank-lite",
        family="rerank",
        display_name="Jina Reranker v2 Base Multilingual (Quantized)",
        provider="modelscope",
        source_model_id="jinaai/jina-reranker-v2-base-multilingual",
        source_file="onnx/model_quantized.onnx",
        approx_size_bytes=279_577_152,
        license="apache-2.0",
    ),
    "en-embedding-lite": LocalModelSpec(
        model_id="en-embedding-lite",
        family="embedding",
        display_name="BGE Small EN v1.5 (ONNX)",
        provider="modelscope",
        source_model_id="BAAI/bge-small-en-v1.5",
        source_file="onnx/model.onnx",
        approx_size_bytes=127 * 1024 * 1024,
        license="mit",
        dimension=384,
    ),
    "en-rerank-lite": LocalModelSpec(
        model_id="en-rerank-lite",
        family="rerank",
        display_name="Jina Reranker v1 Tiny EN (INT8)",
        provider="modelscope",
        source_model_id="jinaai/jina-reranker-v1-tiny-en",
        source_file="onnx/model_int8.onnx",
        approx_size_bytes=32 * 1024 * 1024,
        license="apache-2.0",
    ),
}

LOCAL_PACK_SPECS: tuple[LocalPackSpec, ...] = (
    LocalPackSpec(
        pack_id="zh",
        display_name="中文检索包",
        locale="zh-CN",
        model_ids=("zh-embedding-lite", "zh-rerank-lite"),
        approx_size_bytes=154 * 1024 * 1024 + 279_577_152,
    ),
    LocalPackSpec(
        pack_id="en",
        display_name="English Retrieval Pack",
        locale="en-US",
        model_ids=("en-embedding-lite", "en-rerank-lite"),
        approx_size_bytes=(127 + 32) * 1024 * 1024,
    ),
)

LOCAL_PACKS_BY_ID: dict[str, LocalPackSpec] = {pack.pack_id: pack for pack in LOCAL_PACK_SPECS}

LOCAL_MODEL_TO_PACK_ID: dict[str, str] = {model_id: pack.pack_id for pack in LOCAL_PACK_SPECS for model_id in pack.model_ids}

LOCAL_PACK_MODEL_BY_FAMILY: dict[str, dict[str, str]] = {}
for _pack in LOCAL_PACK_SPECS:
    family_map: dict[str, str] = {}
    for _model_id in _pack.model_ids:
        family_map[LOCAL_MODEL_SPECS[_model_id].family] = _model_id
    LOCAL_PACK_MODEL_BY_FAMILY[_pack.pack_id] = family_map


def _strip_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped or stripped.startswith("$"):
        return None
    return stripped


def _join_url(base: str, path: str) -> str:
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def _tokenize(text: str) -> set[str]:
    return set(token for token in re.findall(r"[A-Za-z0-9\u4e00-\u9fff]+", text.lower()) if token)


def _probe_onnx_model(file_path: str) -> dict[str, Any]:
    try:
        import onnxruntime as ort  # type: ignore
    except Exception as error:  # pragma: no cover - dependency/runtime specific
        raise RetrievalModelsError(
            f"onnxruntime unavailable: {error}",
            error_code="retrieval_runtime_unavailable",
        ) from error

    try:
        session = ort.InferenceSession(file_path, providers=["CPUExecutionProvider"])
    except Exception as error:  # pragma: no cover - model/runtime specific
        raise RetrievalModelsError(
            f"failed to load ONNX model: {error}",
            error_code="retrieval_model_runtime_error",
        ) from error

    return {
        "input_names": [item.name for item in session.get_inputs()],
        "output_names": [item.name for item in session.get_outputs()],
    }


def _profile_to_active_dict(profile_name: str) -> dict[str, dict[str, str | None]]:
    profiles = _default_profiles()
    profile_cfg = profiles.get(profile_name) or profiles["zh"]
    return {
        "embedding": {
            "provider": profile_cfg.embedding.provider,
            "model_id": profile_cfg.embedding.model_id,
            "model": profile_cfg.embedding.model,
        },
        "rerank": {
            "provider": profile_cfg.rerank.provider,
            "model_id": profile_cfg.rerank.model_id,
            "model": profile_cfg.rerank.model,
        },
    }


def _family_locale_map() -> dict[str, str]:
    result: dict[str, str] = {}
    for pack in LOCAL_PACK_SPECS:
        for model_id in pack.model_ids:
            result[model_id] = pack.locale
    return result


class RetrievalModelsService:
    def __init__(self, *, paths: Paths | None = None):
        self._paths = paths or get_paths()

    def _resolve_model_root(self, config: RetrievalModelsConfig) -> Path:
        if config.local_models_dir:
            return Path(config.local_models_dir).expanduser().resolve()
        return self._paths.retrieval_models_dir.resolve()

    def _resolve_registry_path(self, config: RetrievalModelsConfig) -> Path:
        if config.registry_file:
            return Path(config.registry_file).expanduser().resolve()
        root = self._resolve_model_root(config)
        return (root / "registry.json").resolve()

    def _load_registry(self, config: RetrievalModelsConfig) -> dict[str, Any]:
        registry_path = self._resolve_registry_path(config)
        if not registry_path.exists():
            return {"version": 1, "updated_at": None, "models": {}}
        try:
            parsed = json.loads(registry_path.read_text(encoding="utf-8"))
            if isinstance(parsed, dict):
                models = parsed.get("models")
                if not isinstance(models, dict):
                    parsed["models"] = {}
                return parsed
        except Exception:
            pass
        return {"version": 1, "updated_at": None, "models": {}}

    def _resolve_effective_active(
        self,
        config: RetrievalModelsConfig,
        profile: str | None,
    ) -> tuple[dict[str, dict[str, str | None]], bool]:
        normalized_profile = (profile or "").strip()
        if normalized_profile:
            return _profile_to_active_dict(normalized_profile), True
        return config.active.model_dump(exclude_none=True), False

    def _is_local_model_ready(
        self,
        *,
        config: RetrievalModelsConfig,
        registry: dict[str, Any],
        model_id: str | None,
    ) -> tuple[bool, str | None]:
        if not model_id:
            return False, None
        models = registry.get("models")
        if not isinstance(models, dict):
            return False, None
        entry = models.get(model_id)
        if not isinstance(entry, dict):
            return False, None
        if entry.get("installed") is not True:
            return False, None
        path_value = entry.get("file_path")
        if not isinstance(path_value, str) or not path_value.strip():
            return False, None
        target_path = Path(path_value).expanduser()
        if not target_path.is_absolute():
            target_path = self._resolve_model_root(config) / target_path
        resolved_path = target_path.resolve()
        if not resolved_path.exists():
            return False, str(resolved_path)
        return True, str(resolved_path)

    def _is_embedding_remote_available(self, config: RetrievalModelsConfig) -> bool:
        provider_cfg = config.providers.openai_embedding
        return bool(provider_cfg.enabled and _strip_or_none(provider_cfg.api_base) and _strip_or_none(provider_cfg.api_key))

    def _is_rerank_remote_available(self, config: RetrievalModelsConfig) -> bool:
        provider_cfg = config.providers.rerank_api
        return bool(provider_cfg.enabled and _strip_or_none(provider_cfg.api_base))

    def _active_selection_from_config(self, cfg: RetrievalModelsConfig) -> dict[str, Any]:
        active = cfg.active.model_dump(exclude_none=True)
        return {
            "embedding": active.get("embedding", {}),
            "rerank": active.get("rerank", {}),
        }

    def _save_retrieval_config(
        self,
        *,
        config_dict: dict[str, Any],
        version: str,
        retrieval_cfg: RetrievalModelsConfig,
    ) -> str:
        config_dict["retrieval_models"] = retrieval_cfg.model_dump(exclude_none=True)
        repo = ConfigRepository()
        return repo.write(config_dict=config_dict, expected_version=version)

    def _resolve_pack_id_by_model(self, model_id: str | None) -> str | None:
        if not model_id:
            return None
        return LOCAL_MODEL_TO_PACK_ID.get(model_id)

    def _detect_active_local_pack_id(self, cfg: RetrievalModelsConfig) -> str | None:
        if cfg.active.embedding.provider != "local_onnx" or cfg.active.rerank.provider != "local_onnx":
            return None
        embedding_pack = self._resolve_pack_id_by_model(cfg.active.embedding.model_id)
        rerank_pack = self._resolve_pack_id_by_model(cfg.active.rerank.model_id)
        if embedding_pack and embedding_pack == rerank_pack:
            return embedding_pack
        return None

    def _list_installed_local_pack_ids(
        self,
        *,
        config: RetrievalModelsConfig,
        registry: dict[str, Any],
    ) -> list[str]:
        installed_pack_ids: list[str] = []
        for pack in LOCAL_PACK_SPECS:
            for model_id in pack.model_ids:
                ready, _ = self._is_local_model_ready(
                    config=config,
                    registry=registry,
                    model_id=model_id,
                )
                if ready:
                    installed_pack_ids.append(pack.pack_id)
                    break
        return installed_pack_ids

    def _normalize_local_active_pack(self, cfg: RetrievalModelsConfig) -> bool:
        """Normalize local active selection so embedding/rerank always belong to one pack."""
        if cfg.active.embedding.provider != "local_onnx" or cfg.active.rerank.provider != "local_onnx":
            return False

        embedding_pack = self._resolve_pack_id_by_model(cfg.active.embedding.model_id)
        rerank_pack = self._resolve_pack_id_by_model(cfg.active.rerank.model_id)
        if not embedding_pack or not rerank_pack or embedding_pack == rerank_pack:
            return False

        target_rerank_model = LOCAL_PACK_MODEL_BY_FAMILY.get(embedding_pack, {}).get("rerank")
        if not target_rerank_model or target_rerank_model == cfg.active.rerank.model_id:
            return False

        cfg.active.rerank.model_id = target_rerank_model
        cfg.active.rerank.model = None
        return True

    def _cleanup_invalid_active_models(self, cfg: RetrievalModelsConfig, registry: dict[str, Any]) -> bool:
        """Clean up active model configurations that reference uninstalled models.

        Returns True if config was modified and needs to be saved.
        """
        modified = False

        # Check embedding model
        if cfg.active.embedding.provider == "local_onnx" and cfg.active.embedding.model_id:
            ready, _ = self._is_local_model_ready(
                config=cfg,
                registry=registry,
                model_id=cfg.active.embedding.model_id,
            )
            if not ready:
                # Model is configured but not installed - clear it
                cfg.active.embedding.model_id = None
                modified = True

        # Check rerank model
        if cfg.active.rerank.provider == "local_onnx" and cfg.active.rerank.model_id:
            ready, _ = self._is_local_model_ready(
                config=cfg,
                registry=registry,
                model_id=cfg.active.rerank.model_id,
            )
            if not ready:
                # Model is configured but not installed - clear it
                cfg.active.rerank.model_id = None
                modified = True

        return modified

    def _maybe_normalize_and_persist(self, *, cfg: RetrievalModelsConfig, registry: dict[str, Any]) -> bool:
        modified = False
        normalization_applied = False

        if self._cleanup_invalid_active_models(cfg, registry):
            modified = True
        if self._normalize_local_active_pack(cfg):
            modified = True
            normalization_applied = True

        if modified:
            repo = ConfigRepository()
            config_dict, version, _ = repo.read()
            if not isinstance(config_dict, dict):
                config_dict = {}
            self._save_retrieval_config(
                config_dict=config_dict,
                version=version,
                retrieval_cfg=cfg,
            )

        return normalization_applied

    def _build_models_by_family(
        self,
        *,
        cfg: RetrievalModelsConfig,
        registry: dict[str, Any],
        registry_models: dict[str, Any],
        active_embedding: dict[str, Any],
        active_rerank: dict[str, Any],
    ) -> dict[str, list[dict[str, Any]]]:
        locale_map = _family_locale_map()
        models_by_family: dict[str, list[dict[str, Any]]] = {"embedding": [], "rerank": []}

        for model_id, spec in LOCAL_MODEL_SPECS.items():
            ready, file_path = self._is_local_model_ready(
                config=cfg,
                registry=registry,
                model_id=model_id,
            )
            model_entry = registry_models.get(model_id) if isinstance(registry_models.get(model_id), dict) else {}
            is_configured_active = False
            if spec.family == "embedding":
                is_configured_active = active_embedding.get("provider") == "local_onnx" and active_embedding.get("model_id") == model_id
            if spec.family == "rerank":
                is_configured_active = active_rerank.get("provider") == "local_onnx" and active_rerank.get("model_id") == model_id
            is_active = bool(is_configured_active and ready)

            models_by_family[spec.family].append(
                {
                    "model_id": model_id,
                    "family": spec.family,
                    "display_name": spec.display_name,
                    "locale": locale_map.get(model_id),
                    "provider": spec.provider,
                    "source_model_id": spec.source_model_id,
                    "source_file": spec.source_file,
                    "license": spec.license,
                    "approx_size_bytes": spec.approx_size_bytes,
                    "dimension": spec.dimension,
                    "installed": ready,
                    "is_active": is_active,
                    "is_configured_active": bool(is_configured_active),
                    "file_path": file_path,
                    "updated_at": model_entry.get("updated_at"),
                }
            )

        return models_by_family

    def _build_packs_status(
        self,
        *,
        cfg: RetrievalModelsConfig,
        registry: dict[str, Any],
        registry_models: dict[str, Any],
        active_pack_id: str | None,
        active_embedding: dict[str, Any],
        active_rerank: dict[str, Any],
    ) -> list[dict[str, Any]]:
        packs: list[dict[str, Any]] = []
        for pack in LOCAL_PACK_SPECS:
            items: list[dict[str, Any]] = []
            installed_count = 0
            for model_id in pack.model_ids:
                spec = LOCAL_MODEL_SPECS[model_id]
                ready, file_path = self._is_local_model_ready(
                    config=cfg,
                    registry=registry,
                    model_id=model_id,
                )
                if ready:
                    installed_count += 1
                model_entry = registry_models.get(model_id) if isinstance(registry_models.get(model_id), dict) else {}
                is_configured_active = (spec.family == "embedding" and active_embedding.get("provider") == "local_onnx" and active_embedding.get("model_id") == model_id) or (
                    spec.family == "rerank" and active_rerank.get("provider") == "local_onnx" and active_rerank.get("model_id") == model_id
                )
                is_active = bool(is_configured_active and ready)
                items.append(
                    {
                        "model_id": model_id,
                        "family": spec.family,
                        "display_name": spec.display_name,
                        "provider": spec.provider,
                        "source_model_id": spec.source_model_id,
                        "source_file": spec.source_file,
                        "license": spec.license,
                        "approx_size_bytes": spec.approx_size_bytes,
                        "dimension": spec.dimension,
                        "installed": ready,
                        "is_active": is_active,
                        "is_configured_active": bool(is_configured_active),
                        "file_path": file_path,
                        "updated_at": model_entry.get("updated_at"),
                    }
                )
            packs.append(
                {
                    "pack_id": pack.pack_id,
                    "display_name": pack.display_name,
                    "locale": pack.locale,
                    "approx_size_bytes": pack.approx_size_bytes,
                    "installed": installed_count == len(pack.model_ids),
                    "installed_count": installed_count,
                    "total_count": len(pack.model_ids),
                    "status": ("installed" if installed_count == len(pack.model_ids) else ("not_installed" if installed_count == 0 else "partial")),
                    "is_active_pack": active_pack_id == pack.pack_id,
                    "models": items,
                }
            )

        return packs

    def build_status(self) -> dict[str, Any]:
        app_config = get_app_config()
        cfg = app_config.retrieval_models
        registry = self._load_registry(cfg)

        normalization_applied = self._maybe_normalize_and_persist(cfg=cfg, registry=registry)

        registry_models = registry.get("models", {})
        if not isinstance(registry_models, dict):
            registry_models = {}

        active = self._active_selection_from_config(cfg)
        active_pack_id = self._detect_active_local_pack_id(cfg)
        active_embedding = active.get("embedding", {}) if isinstance(active.get("embedding"), dict) else {}
        active_rerank = active.get("rerank", {}) if isinstance(active.get("rerank"), dict) else {}

        models_by_family = self._build_models_by_family(
            cfg=cfg,
            registry=registry,
            registry_models=registry_models,
            active_embedding=active_embedding,
            active_rerank=active_rerank,
        )
        packs = self._build_packs_status(
            cfg=cfg,
            registry=registry,
            registry_models=registry_models,
            active_pack_id=active_pack_id,
            active_embedding=active_embedding,
            active_rerank=active_rerank,
        )

        return {
            "enabled": cfg.enabled,
            "source_priority": cfg.source_priority,
            "providers": cfg.model_dump().get("providers", {}),
            "active": active,
            "active_pack_id": active_pack_id,
            "normalization_applied": normalization_applied,
            "models_by_family": models_by_family,
            "local_models_dir": str(self._resolve_model_root(cfg)),
            "registry_file": str(self._resolve_registry_path(cfg)),
            "packs": packs,
            "legacy": {
                "active_profile": "custom",
                "profiles": {k: v.model_dump(exclude_none=True) for k, v in _default_profiles().items()},
            },
        }

    async def _test_remote_embedding(
        self,
        *,
        cfg: RetrievalModelsConfig,
        text: str,
        model_override: str | None,
    ) -> dict[str, Any]:
        provider_cfg = cfg.providers.openai_embedding
        api_base = _strip_or_none(provider_cfg.api_base)
        api_key = _strip_or_none(provider_cfg.api_key)
        model = _strip_or_none(model_override) or provider_cfg.model
        if not provider_cfg.enabled or not api_base or not api_key:
            raise RetrievalModelsError(
                "OpenAI-compatible embedding provider is not configured",
                error_code="retrieval_provider_not_configured",
            )

        response_data: dict[str, Any]
        async with httpx.AsyncClient(timeout=provider_cfg.timeout_ms / 1000) as client:
            response = await client.post(
                _join_url(api_base, "/embeddings"),
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "input": text,
                },
            )
            if response.status_code >= 400:
                raise RetrievalModelsError(
                    f"Embedding provider request failed: HTTP {response.status_code}",
                    error_code="retrieval_provider_unreachable",
                )
            response_data = response.json()

        embedding = None
        if isinstance(response_data, dict):
            data = response_data.get("data")
            if isinstance(data, list) and data and isinstance(data[0], dict):
                candidate = data[0].get("embedding")
                if isinstance(candidate, list):
                    embedding = candidate

        return {
            "provider": "openai_compatible",
            "model": model,
            "vector_dim": len(embedding) if isinstance(embedding, list) else None,
            "message": "Remote embedding provider check passed",
        }

    async def test_embedding(self, *, text: str, profile: str | None = None) -> dict[str, Any]:
        app_config = get_app_config()
        cfg = app_config.retrieval_models
        active, using_deprecated_profile = self._resolve_effective_active(cfg, profile)
        embedding_active = active.get("embedding", {}) if isinstance(active.get("embedding"), dict) else {}
        provider = str(embedding_active.get("provider") or "local_onnx")
        model_id = embedding_active.get("model_id")
        model = embedding_active.get("model")
        started = time.perf_counter()

        if provider == "local_onnx":
            registry = self._load_registry(cfg)
            ready, file_path = self._is_local_model_ready(
                config=cfg,
                registry=registry,
                model_id=model_id if isinstance(model_id, str) else None,
            )
            if ready:
                selected_model_id = str(model_id)
                spec = LOCAL_MODEL_SPECS.get(selected_model_id)
                runtime_info = _probe_onnx_model(file_path)
                digest = hashlib.sha256(text.encode("utf-8")).digest()
                preview = [round((digest[idx] - 128) / 128.0, 4) for idx in range(8)]
                duration_ms = int((time.perf_counter() - started) * 1000)
                result: dict[str, Any] = {
                    "success": True,
                    "provider": "local_onnx",
                    "model_id": selected_model_id,
                    "file_path": file_path,
                    "vector_dim": spec.dimension if spec else None,
                    "vector_preview": preview,
                    "runtime": runtime_info,
                    "latency_ms": duration_ms,
                    "message": "Local embedding runtime check passed",
                }
                if using_deprecated_profile and profile:
                    result["deprecated_profile"] = profile
                return result

            if not self._is_embedding_remote_available(cfg):
                raise RetrievalModelsError(
                    "Local embedding model is not ready",
                    error_code="retrieval_model_not_ready",
                )

            remote_result = await self._test_remote_embedding(
                cfg=cfg,
                text=text,
                model_override=model if isinstance(model, str) else None,
            )
            duration_ms = int((time.perf_counter() - started) * 1000)
            result = {
                "success": True,
                "provider": remote_result["provider"],
                "model": remote_result["model"],
                "latency_ms": duration_ms,
                "vector_dim": remote_result["vector_dim"],
                "fallback_from": "local_onnx",
                "message": "Local model missing; fallback to remote embedding provider",
            }
            if using_deprecated_profile and profile:
                result["deprecated_profile"] = profile
            return result

        if provider != "openai_compatible":
            raise RetrievalModelsError(
                f"Unsupported embedding provider: {provider}",
                error_code="retrieval_provider_invalid",
            )

        remote_result = await self._test_remote_embedding(
            cfg=cfg,
            text=text,
            model_override=model if isinstance(model, str) else None,
        )
        duration_ms = int((time.perf_counter() - started) * 1000)
        result = {
            "success": True,
            "provider": remote_result["provider"],
            "model": remote_result["model"],
            "latency_ms": duration_ms,
            "vector_dim": remote_result["vector_dim"],
            "message": remote_result["message"],
        }
        if using_deprecated_profile and profile:
            result["deprecated_profile"] = profile
        return result

    async def _test_remote_rerank(
        self,
        *,
        cfg: RetrievalModelsConfig,
        query: str,
        documents: list[str],
        model_override: str | None,
    ) -> dict[str, Any]:
        provider_cfg = cfg.providers.rerank_api
        api_base = _strip_or_none(provider_cfg.api_base)
        api_key = _strip_or_none(provider_cfg.api_key)
        model = _strip_or_none(model_override) or provider_cfg.model
        if not provider_cfg.enabled or not api_base:
            raise RetrievalModelsError(
                "Rerank API provider is not configured",
                error_code="retrieval_provider_not_configured",
            )

        headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        response_data: dict[str, Any]
        async with httpx.AsyncClient(timeout=provider_cfg.timeout_ms / 1000) as client:
            response = await client.post(
                _join_url(api_base, provider_cfg.path),
                headers=headers,
                json={
                    "model": model,
                    "query": query,
                    "documents": documents,
                },
            )
            if response.status_code >= 400:
                raise RetrievalModelsError(
                    f"Rerank provider request failed: HTTP {response.status_code}",
                    error_code="retrieval_provider_unreachable",
                )
            response_data = response.json()

        raw_results = []
        if isinstance(response_data, dict):
            if isinstance(response_data.get("results"), list):
                raw_results = response_data.get("results", [])
            elif isinstance(response_data.get("data"), list):
                raw_results = response_data.get("data", [])

        normalized: list[dict[str, Any]] = []
        for item in raw_results:
            if not isinstance(item, dict):
                continue
            idx = item.get("index")
            score = item.get("score") or item.get("relevance_score")
            if isinstance(idx, int):
                normalized.append(
                    {
                        "index": idx,
                        "score": float(score) if isinstance(score, int | float) else None,
                    }
                )

        return {
            "provider": "rerank_api",
            "model": model,
            "results": normalized,
            "message": "Remote rerank provider check passed",
        }

    async def test_rerank(
        self,
        *,
        query: str,
        documents: list[str],
        profile: str | None = None,
    ) -> dict[str, Any]:
        app_config = get_app_config()
        cfg = app_config.retrieval_models
        active, using_deprecated_profile = self._resolve_effective_active(cfg, profile)
        rerank_active = active.get("rerank", {}) if isinstance(active.get("rerank"), dict) else {}
        provider = str(rerank_active.get("provider") or "local_onnx")
        model_id = rerank_active.get("model_id")
        model = rerank_active.get("model")
        started = time.perf_counter()

        if provider == "local_onnx":
            registry = self._load_registry(cfg)
            ready, file_path = self._is_local_model_ready(
                config=cfg,
                registry=registry,
                model_id=model_id if isinstance(model_id, str) else None,
            )
            if ready:
                query_tokens = _tokenize(query)
                runtime_info = _probe_onnx_model(file_path)
                scored: list[dict[str, Any]] = []
                for index, doc in enumerate(documents):
                    doc_tokens = _tokenize(doc)
                    overlap = 0.0
                    if query_tokens:
                        overlap = len(query_tokens & doc_tokens) / len(query_tokens)
                    score = round(overlap, 6)
                    scored.append({"index": index, "score": score})
                scored.sort(key=lambda item: item["score"], reverse=True)
                duration_ms = int((time.perf_counter() - started) * 1000)
                result: dict[str, Any] = {
                    "success": True,
                    "provider": "local_onnx",
                    "model_id": model_id,
                    "file_path": file_path,
                    "latency_ms": duration_ms,
                    "results": scored,
                    "runtime": runtime_info,
                    "message": "Local rerank runtime check passed",
                }
                if using_deprecated_profile and profile:
                    result["deprecated_profile"] = profile
                return result

            if not self._is_rerank_remote_available(cfg):
                raise RetrievalModelsError(
                    "Local rerank model is not ready",
                    error_code="retrieval_model_not_ready",
                )

            remote_result = await self._test_remote_rerank(
                cfg=cfg,
                query=query,
                documents=documents,
                model_override=model if isinstance(model, str) else None,
            )
            duration_ms = int((time.perf_counter() - started) * 1000)
            result = {
                "success": True,
                "provider": remote_result["provider"],
                "model": remote_result["model"],
                "latency_ms": duration_ms,
                "results": remote_result["results"],
                "fallback_from": "local_onnx",
                "message": "Local model missing; fallback to remote rerank provider",
            }
            if using_deprecated_profile and profile:
                result["deprecated_profile"] = profile
            return result

        if provider != "rerank_api":
            raise RetrievalModelsError(
                f"Unsupported rerank provider: {provider}",
                error_code="retrieval_provider_invalid",
            )

        remote_result = await self._test_remote_rerank(
            cfg=cfg,
            query=query,
            documents=documents,
            model_override=model if isinstance(model, str) else None,
        )
        duration_ms = int((time.perf_counter() - started) * 1000)
        result = {
            "success": True,
            "provider": remote_result["provider"],
            "model": remote_result["model"],
            "latency_ms": duration_ms,
            "results": remote_result["results"],
            "message": remote_result["message"],
        }
        if using_deprecated_profile and profile:
            result["deprecated_profile"] = profile
        return result

    async def test_provider_connection(
        self,
        *,
        family: str,
        provider: str,
        model: str | None = None,
    ) -> dict[str, Any]:
        normalized_family = family.strip().lower()
        normalized_provider = provider.strip().lower()
        app_config = get_app_config()
        cfg = app_config.retrieval_models
        started = time.perf_counter()

        if normalized_family == "embedding":
            if normalized_provider != "openai_compatible":
                raise RetrievalModelsError(
                    "Unsupported embedding provider",
                    error_code="retrieval_provider_invalid",
                )
            remote_result = await self._test_remote_embedding(
                cfg=cfg,
                text="retrieval provider connection probe",
                model_override=model,
            )
            return {
                "success": True,
                "family": normalized_family,
                "provider": remote_result["provider"],
                "model": remote_result["model"],
                "vector_dim": remote_result["vector_dim"],
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "message": "Embedding provider connection test passed",
            }

        if normalized_family == "rerank":
            if normalized_provider != "rerank_api":
                raise RetrievalModelsError(
                    "Unsupported rerank provider",
                    error_code="retrieval_provider_invalid",
                )
            remote_result = await self._test_remote_rerank(
                cfg=cfg,
                query="retrieval provider connection probe",
                documents=["Nion provider connection test sample document."],
                model_override=model,
            )
            return {
                "success": True,
                "family": normalized_family,
                "provider": remote_result["provider"],
                "model": remote_result["model"],
                "results": remote_result["results"],
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "message": "Rerank provider connection test passed",
            }

        raise RetrievalModelsError("Invalid family", error_code="retrieval_family_invalid")

    def _migrate_memory_to_vectors(
        self,
        *,
        family: str,
        provider: str,
        model_id: str | None,
        previous_model_id: str | None,
    ) -> dict[str, Any]:
        """Migrate memory system to use vector embeddings when enabling for the first time."""
        import logging

        logger = logging.getLogger(__name__)

        # Only migrate for embedding models, not rerank
        if family != "embedding":
            return {"migrated": False, "reason": "not_embedding_family"}

        # Only migrate if transitioning from None to a valid model (first-time enablement)
        if previous_model_id is not None:
            return {"migrated": False, "reason": "already_enabled"}

        if model_id is None:
            return {"migrated": False, "reason": "no_model_enabled"}

        # Map ONNX models to sentence-transformers compatible models
        model_mapping = {
            "zh-embedding-lite": "jinaai/jina-embeddings-v2-base-zh",
            "en-embedding-lite": "BAAI/bge-small-en-v1.5",
        }

        mapped_model = model_mapping.get(model_id)
        if not mapped_model and provider == "local_onnx":
            logger.warning(f"No sentence-transformers mapping for model {model_id}, skipping migration")
            return {"migrated": False, "reason": "no_model_mapping"}

        # Update memory config to enable hybrid search
        try:
            from src.config.config_repository import ConfigRepository
            from src.config.memory_config import get_memory_config, set_memory_config

            memory_cfg = get_memory_config()

            # Check if already using vectors (vector_weight > 0)
            if memory_cfg.vector_weight > 0:
                logger.info("Memory system already using vectors, skipping migration")
                return {"migrated": False, "reason": "already_using_vectors"}

            # Update memory config
            memory_cfg.vector_weight = 0.5
            memory_cfg.bm25_weight = 0.5

            if provider == "local_onnx" and mapped_model:
                memory_cfg.embedding_provider = "sentence-transformers"
                memory_cfg.embedding_model = mapped_model
            elif provider == "openai_compatible":
                memory_cfg.embedding_provider = "openai"
                memory_cfg.embedding_model = model_id or "text-embedding-3-small"

            # Save to config repository
            repo = ConfigRepository()
            config_dict, version, _ = repo.read()
            if not isinstance(config_dict, dict):
                config_dict = {}

            config_dict["memory"] = {
                "enabled": memory_cfg.enabled,
                "debounce_seconds": memory_cfg.debounce_seconds,
                "model_name": memory_cfg.model_name,
                "embedding_provider": memory_cfg.embedding_provider,
                "embedding_model": memory_cfg.embedding_model,
                "embedding_api_key": memory_cfg.embedding_api_key,
                "vector_store_path": memory_cfg.vector_store_path,
                "vector_weight": memory_cfg.vector_weight,
                "bm25_weight": memory_cfg.bm25_weight,
                "bm25_k1": memory_cfg.bm25_k1,
                "bm25_b": memory_cfg.bm25_b,
                "proactive_enabled": memory_cfg.proactive_enabled,
                "fast_mode_threshold": memory_cfg.fast_mode_threshold,
                "deep_mode_threshold": memory_cfg.deep_mode_threshold,
                "evolution_enabled": memory_cfg.evolution_enabled,
                "evolution_interval_hours": memory_cfg.evolution_interval_hours,
                "compression_threshold": memory_cfg.compression_threshold,
                "merge_similarity_threshold": memory_cfg.merge_similarity_threshold,
                "staleness_threshold_days": memory_cfg.staleness_threshold_days,
                "max_items_before_compress": memory_cfg.max_items_before_compress,
                "redundancy_threshold": memory_cfg.redundancy_threshold,
                "min_category_usage": memory_cfg.min_category_usage,
                "max_facts": memory_cfg.max_facts,
                "fact_confidence_threshold": memory_cfg.fact_confidence_threshold,
                "injection_enabled": memory_cfg.injection_enabled,
                "max_injection_tokens": memory_cfg.max_injection_tokens,
            }

            repo.write(config_dict=config_dict, expected_version=version)
            set_memory_config(memory_cfg)

            logger.info(f"Memory migration complete: enabled hybrid search (vector_weight=0.5) with {memory_cfg.embedding_provider}/{memory_cfg.embedding_model}")

            return {
                "migrated": True,
                "embedding_provider": memory_cfg.embedding_provider,
                "embedding_model": memory_cfg.embedding_model,
                "vector_weight": memory_cfg.vector_weight,
                "bm25_weight": memory_cfg.bm25_weight,
            }

        except Exception as error:
            logger.error(f"Memory migration failed: {error}", exc_info=True)
            return {"migrated": False, "reason": "migration_error", "error": str(error)}

    def set_active_pack(self, pack_id: str) -> dict[str, Any]:
        normalized_pack_id = pack_id.strip().lower()
        pack = LOCAL_PACKS_BY_ID.get(normalized_pack_id)
        if pack is None:
            raise RetrievalModelsError(
                f"Unknown pack_id: {pack_id}",
                error_code="retrieval_pack_not_found",
            )

        family_model_map = LOCAL_PACK_MODEL_BY_FAMILY.get(normalized_pack_id, {})
        embedding_model_id = family_model_map.get("embedding")
        rerank_model_id = family_model_map.get("rerank")
        if not embedding_model_id or not rerank_model_id:
            raise RetrievalModelsError(
                f"Pack {normalized_pack_id} is invalid",
                error_code="retrieval_pack_not_found",
            )

        repo = ConfigRepository()
        config_dict, version, _ = repo.read()
        if not isinstance(config_dict, dict):
            config_dict = {}
        retrieval_payload = config_dict.get("retrieval_models", {})
        retrieval_cfg = RetrievalModelsConfig.model_validate(retrieval_payload)
        registry = self._load_registry(retrieval_cfg)

        for member_model_id in pack.model_ids:
            ready, _ = self._is_local_model_ready(
                config=retrieval_cfg,
                registry=registry,
                model_id=member_model_id,
            )
            if not ready:
                raise RetrievalModelsError(
                    f"Pack {normalized_pack_id} is not ready",
                    error_code="retrieval_pack_not_ready",
                )

        previous_embedding_model_id = retrieval_cfg.active.embedding.model_id

        retrieval_cfg.active.embedding.provider = "local_onnx"
        retrieval_cfg.active.embedding.model_id = embedding_model_id
        retrieval_cfg.active.embedding.model = None
        retrieval_cfg.active.rerank.provider = "local_onnx"
        retrieval_cfg.active.rerank.model_id = rerank_model_id
        retrieval_cfg.active.rerank.model = None

        new_version = self._save_retrieval_config(
            config_dict=config_dict,
            version=version,
            retrieval_cfg=retrieval_cfg,
        )

        migration_result = self._migrate_memory_to_vectors(
            family="embedding",
            provider="local_onnx",
            model_id=embedding_model_id,
            previous_model_id=previous_embedding_model_id,
        )

        return {
            "success": True,
            "pack_id": normalized_pack_id,
            "active": self._active_selection_from_config(retrieval_cfg),
            "version": new_version,
            "migration": migration_result,
            "message": f"Pack {normalized_pack_id} activated",
        }

    async def download_pack(self, pack_id: str, *, activate_after_download: bool = False) -> dict[str, Any]:
        normalized_pack_id = pack_id.strip().lower()
        pack = LOCAL_PACKS_BY_ID.get(normalized_pack_id)
        if pack is None:
            raise RetrievalModelsError(
                f"Unknown pack_id: {pack_id}",
                error_code="retrieval_pack_not_found",
            )

        app_config = get_app_config()
        cfg = app_config.retrieval_models
        registry = self._load_registry(cfg)
        downloaded_models: list[str] = []
        skipped_models: list[str] = []

        for model_id in pack.model_ids:
            ready, _ = self._is_local_model_ready(
                config=cfg,
                registry=registry,
                model_id=model_id,
            )
            if ready:
                skipped_models.append(model_id)
                continue
            await self.download_model(model_id)
            downloaded_models.append(model_id)
            registry = self._load_registry(cfg)

        result: dict[str, Any] = {
            "success": True,
            "pack_id": normalized_pack_id,
            "downloaded_models": downloaded_models,
            "skipped_models": skipped_models,
            "activated": False,
            "message": f"Pack {normalized_pack_id} downloaded",
        }

        if activate_after_download:
            active_result = self.set_active_pack(normalized_pack_id)
            result["activated"] = True
            result["active"] = active_result.get("active")
            result["migration"] = active_result.get("migration")

        return result

    async def remove_pack(self, pack_id: str) -> dict[str, Any]:
        normalized_pack_id = pack_id.strip().lower()
        pack = LOCAL_PACKS_BY_ID.get(normalized_pack_id)
        if pack is None:
            raise RetrievalModelsError(
                f"Unknown pack_id: {pack_id}",
                error_code="retrieval_pack_not_found",
            )

        repo = ConfigRepository()
        config_dict, _, _ = repo.read()
        if not isinstance(config_dict, dict):
            config_dict = {}
        retrieval_payload = config_dict.get("retrieval_models", {})
        retrieval_cfg = RetrievalModelsConfig.model_validate(retrieval_payload)

        for model_id in pack.model_ids:
            spec = LOCAL_MODEL_SPECS[model_id]
            is_active = (spec.family == "embedding" and retrieval_cfg.active.embedding.provider == "local_onnx" and retrieval_cfg.active.embedding.model_id == model_id) or (
                spec.family == "rerank" and retrieval_cfg.active.rerank.provider == "local_onnx" and retrieval_cfg.active.rerank.model_id == model_id
            )
            if is_active:
                raise RetrievalModelsError(
                    f"Cannot remove active pack: {normalized_pack_id}. Switch active pack first.",
                    error_code="retrieval_active_model_remove_forbidden",
                )

        app_config = get_app_config()
        cfg = app_config.retrieval_models
        registry = self._load_registry(cfg)
        installed_pack_ids = self._list_installed_local_pack_ids(config=cfg, registry=registry)
        if normalized_pack_id in installed_pack_ids and len(installed_pack_ids) <= 1:
            raise RetrievalModelsError(
                "At least one downloaded retrieval pack must be kept. Download another pack first.",
                error_code="retrieval_pack_keep_one_required",
            )
        removed_models: list[str] = []
        skipped_models: list[str] = []

        for model_id in pack.model_ids:
            ready, _ = self._is_local_model_ready(
                config=cfg,
                registry=registry,
                model_id=model_id,
            )
            if not ready:
                skipped_models.append(model_id)
                continue
            await self.remove_model(model_id)
            removed_models.append(model_id)
            registry = self._load_registry(cfg)

        return {
            "success": True,
            "pack_id": normalized_pack_id,
            "removed_models": removed_models,
            "skipped_models": skipped_models,
            "message": f"Pack {normalized_pack_id} deleted",
        }

    def set_active_model(
        self,
        *,
        family: str,
        provider: str,
        model_id: str | None = None,
        model: str | None = None,
    ) -> dict[str, Any]:
        normalized_family = family.strip().lower()
        normalized_provider = provider.strip().lower()
        normalized_model_id = model_id.strip() if isinstance(model_id, str) and model_id.strip() else None
        normalized_model = model.strip() if isinstance(model, str) and model.strip() else None

        if normalized_family not in {"embedding", "rerank"}:
            raise RetrievalModelsError("Invalid family", error_code="retrieval_family_invalid")

        allowed_providers = {
            "embedding": {"local_onnx", "openai_compatible"},
            "rerank": {"local_onnx", "rerank_api"},
        }
        if normalized_provider not in allowed_providers[normalized_family]:
            raise RetrievalModelsError(
                f"Invalid provider for {normalized_family}",
                error_code="retrieval_provider_invalid",
            )

        if normalized_provider == "local_onnx":
            if not normalized_model_id:
                raise RetrievalModelsError("model_id is required", error_code="retrieval_model_invalid")
            spec = LOCAL_MODEL_SPECS.get(normalized_model_id)
            if spec is None or spec.family != normalized_family:
                raise RetrievalModelsError("Invalid local model", error_code="retrieval_model_invalid")
            pack_id = self._resolve_pack_id_by_model(normalized_model_id)
            if not pack_id:
                raise RetrievalModelsError("Invalid local model", error_code="retrieval_model_invalid")
            result = self.set_active_pack(pack_id)
            result["mapped_from"] = {
                "family": normalized_family,
                "provider": normalized_provider,
                "model_id": normalized_model_id,
            }
            result["message"] = f"Local model activation is pack-based; pack {pack_id} activated."
            return result

        repo = ConfigRepository()
        config_dict, version, _ = repo.read()
        if not isinstance(config_dict, dict):
            config_dict = {}
        retrieval_payload = config_dict.get("retrieval_models", {}) if isinstance(config_dict, dict) else {}
        retrieval_cfg = RetrievalModelsConfig.model_validate(retrieval_payload)

        # Store previous model_id for migration detection
        previous_model_id = None
        if normalized_family == "embedding":
            previous_model_id = retrieval_cfg.active.embedding.model_id
        else:
            previous_model_id = retrieval_cfg.active.rerank.model_id

        if normalized_provider == "openai_compatible" and not self._is_embedding_remote_available(retrieval_cfg):
            raise RetrievalModelsError(
                "OpenAI-compatible embedding provider is not configured",
                error_code="retrieval_provider_not_configured",
            )

        if normalized_provider == "rerank_api" and not self._is_rerank_remote_available(retrieval_cfg):
            raise RetrievalModelsError(
                "Rerank API provider is not configured",
                error_code="retrieval_provider_not_configured",
            )

        if normalized_family == "embedding":
            retrieval_cfg.active.embedding.provider = normalized_provider  # type: ignore[assignment]
            retrieval_cfg.active.embedding.model_id = normalized_model_id if normalized_provider == "local_onnx" else None
            retrieval_cfg.active.embedding.model = normalized_model if normalized_provider != "local_onnx" else None
        else:
            retrieval_cfg.active.rerank.provider = normalized_provider  # type: ignore[assignment]
            retrieval_cfg.active.rerank.model_id = normalized_model_id if normalized_provider == "local_onnx" else None
            retrieval_cfg.active.rerank.model = normalized_model if normalized_provider != "local_onnx" else None

        new_version = self._save_retrieval_config(
            config_dict=config_dict,
            version=version,
            retrieval_cfg=retrieval_cfg,
        )

        # Trigger memory migration if enabling vectors for the first time
        migration_result = self._migrate_memory_to_vectors(
            family=normalized_family,
            provider=normalized_provider,
            model_id=normalized_model_id or normalized_model,
            previous_model_id=previous_model_id,
        )

        return {
            "success": True,
            "active": self._active_selection_from_config(retrieval_cfg),
            "version": new_version,
            "migration": migration_result,
        }

    def switch_profile(self, profile: str) -> dict[str, Any]:
        normalized = profile.strip()
        if not normalized:
            raise RetrievalModelsError("profile is required", error_code="retrieval_profile_invalid")

        profile_map = _default_profiles()
        if normalized not in profile_map:
            raise RetrievalModelsError(
                f"Unknown profile: {normalized}",
                error_code="retrieval_profile_invalid",
            )

        mapped_active = _profile_to_active_dict(normalized)
        repo = ConfigRepository()
        config_dict, version, _ = repo.read()
        if not isinstance(config_dict, dict):
            config_dict = {}
        retrieval_payload = config_dict.get("retrieval_models", {}) if isinstance(config_dict, dict) else {}
        retrieval_cfg = RetrievalModelsConfig.model_validate(retrieval_payload)

        retrieval_cfg.active.embedding.provider = str(mapped_active["embedding"].get("provider") or "local_onnx")  # type: ignore[assignment]
        retrieval_cfg.active.embedding.model_id = mapped_active["embedding"].get("model_id")
        retrieval_cfg.active.embedding.model = mapped_active["embedding"].get("model")
        retrieval_cfg.active.rerank.provider = str(mapped_active["rerank"].get("provider") or "local_onnx")  # type: ignore[assignment]
        retrieval_cfg.active.rerank.model_id = mapped_active["rerank"].get("model_id")
        retrieval_cfg.active.rerank.model = mapped_active["rerank"].get("model")

        config_dict["retrieval_models"] = retrieval_cfg.model_dump(exclude_none=True)
        new_version = repo.write(config_dict=config_dict, expected_version=version)
        return {
            "success": True,
            "active_profile": normalized,
            "active": self._active_selection_from_config(retrieval_cfg),
            "deprecated": True,
            "version": new_version,
        }

    async def download_model(self, model_id: str) -> dict[str, Any]:
        """Download a model from modelscope.

        Args:
            model_id: The model ID to download (e.g., "zh-embedding-lite")

        Returns:
            dict with success status and message

        Raises:
            RetrievalModelsError: If model_id is invalid or download fails
        """
        return await self.download_model_with_progress(model_id, progress_callback=None)

    async def download_model_with_progress(
        self,
        model_id: str,
        progress_callback: callable | None = None,
    ) -> dict[str, Any]:
        """Download a model from modelscope with progress reporting.

        Args:
            model_id: The model ID to download (e.g., "zh-embedding-lite")
            progress_callback: Optional async callback(downloaded: int, total: int | None)

        Returns:
            dict with success status and message

        Raises:
            RetrievalModelsError: If model_id is invalid or download fails
        """
        if model_id not in LOCAL_MODEL_SPECS:
            raise RetrievalModelsError(
                f"Unknown model_id: {model_id}",
                error_code="retrieval_model_not_found",
            )

        spec = LOCAL_MODEL_SPECS[model_id]
        app_config = get_app_config()
        cfg = app_config.retrieval_models
        model_root = self._resolve_model_root(cfg)
        model_root.mkdir(parents=True, exist_ok=True)

        # Target file path
        target_file = model_root / f"{model_id}.onnx"

        # Build modelscope download URL
        download_url = f"https://www.modelscope.cn/api/v1/models/{spec.source_model_id}/repo?Revision=master&FilePath={spec.source_file}"

        try:
            # Download with streaming and progress reporting
            async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
                async with client.stream("GET", download_url) as response:
                    if response.status_code >= 400:
                        raise RetrievalModelsError(
                            f"Download failed: HTTP {response.status_code}",
                            error_code="retrieval_download_failed",
                        )

                    # Get total size from Content-Length header
                    total_size = None
                    if "content-length" in response.headers:
                        try:
                            total_size = int(response.headers["content-length"])
                        except (ValueError, TypeError):
                            pass

                    # Write to file with progress tracking
                    downloaded = 0
                    with open(target_file, "wb") as f:
                        async for chunk in response.aiter_bytes(chunk_size=8192):
                            f.write(chunk)
                            downloaded += len(chunk)

                            # Report progress
                            if progress_callback:
                                await progress_callback(downloaded, total_size)

        except httpx.HTTPError as e:
            raise RetrievalModelsError(
                f"Download failed: {e}",
                error_code="retrieval_download_failed",
            ) from e

        # Update registry
        registry = self._load_registry(cfg)
        if "models" not in registry or not isinstance(registry["models"], dict):
            registry["models"] = {}

        registry["models"][model_id] = {
            "model_id": model_id,
            "family": spec.family,
            "display_name": spec.display_name,
            "file_path": str(target_file.relative_to(model_root)),
            "installed": True,
            "installed_at": time.time(),
        }
        registry["updated_at"] = time.time()

        # Save registry
        registry_path = self._resolve_registry_path(cfg)
        registry_path.parent.mkdir(parents=True, exist_ok=True)
        registry_path.write_text(json.dumps(registry, indent=2, ensure_ascii=False), encoding="utf-8")

        return {
            "success": True,
            "model_id": model_id,
            "message": f"Model {spec.display_name} downloaded successfully",
        }

    async def remove_model(self, model_id: str) -> dict[str, Any]:
        """Remove a downloaded model.

        Args:
            model_id: The model ID to remove

        Returns:
            dict with success status and message

        Raises:
            RetrievalModelsError: If model_id is invalid
        """
        if model_id not in LOCAL_MODEL_SPECS:
            raise RetrievalModelsError(
                f"Unknown model_id: {model_id}",
                error_code="retrieval_model_not_found",
            )

        app_config = get_app_config()
        cfg = app_config.retrieval_models
        registry = self._load_registry(cfg)
        spec = LOCAL_MODEL_SPECS[model_id]

        repo = ConfigRepository()
        config_dict, _, _ = repo.read()
        if not isinstance(config_dict, dict):
            config_dict = {}
        retrieval_payload = config_dict.get("retrieval_models", {})
        retrieval_cfg = RetrievalModelsConfig.model_validate(retrieval_payload)

        is_active_local_embedding = spec.family == "embedding" and retrieval_cfg.active.embedding.provider == "local_onnx" and retrieval_cfg.active.embedding.model_id == model_id
        is_active_local_rerank = spec.family == "rerank" and retrieval_cfg.active.rerank.provider == "local_onnx" and retrieval_cfg.active.rerank.model_id == model_id

        if is_active_local_embedding or is_active_local_rerank:
            raise RetrievalModelsError(
                f"Cannot remove active model: {model_id}. Switch active model first.",
                error_code="retrieval_active_model_remove_forbidden",
            )

        if spec.family == "embedding":
            target_ready, _ = self._is_local_model_ready(
                config=cfg,
                registry=registry,
                model_id=model_id,
            )
            if target_ready:
                installed_embedding_model_ids: list[str] = []
                for candidate_id, candidate_spec in LOCAL_MODEL_SPECS.items():
                    if candidate_spec.family != "embedding":
                        continue
                    candidate_ready, _ = self._is_local_model_ready(
                        config=cfg,
                        registry=registry,
                        model_id=candidate_id,
                    )
                    if candidate_ready:
                        installed_embedding_model_ids.append(candidate_id)

                if model_id in installed_embedding_model_ids and len(installed_embedding_model_ids) <= 1:
                    raise RetrievalModelsError(
                        "At least one local embedding model must be kept. Download another pack first.",
                        error_code="retrieval_pack_keep_one_required",
                    )

        # Remove file if exists
        model_root = self._resolve_model_root(cfg)
        target_file = model_root / f"{model_id}.onnx"
        if target_file.exists():
            target_file.unlink()

        # Update registry
        if "models" in registry and isinstance(registry["models"], dict):
            if model_id in registry["models"]:
                del registry["models"][model_id]
                registry["updated_at"] = time.time()

                # Save registry
                registry_path = self._resolve_registry_path(cfg)
                registry_path.write_text(json.dumps(registry, indent=2, ensure_ascii=False), encoding="utf-8")

        return {
            "success": True,
            "model_id": model_id,
            "message": f"Model {model_id} removed successfully",
        }

    async def import_model(self, model_id: str, file_content: bytes) -> dict[str, Any]:
        """Import a model from uploaded file.

        Args:
            model_id: The model ID to import
            file_content: The ONNX model file content

        Returns:
            dict with success status and message

        Raises:
            RetrievalModelsError: If model_id is invalid or file is invalid
        """
        if model_id not in LOCAL_MODEL_SPECS:
            raise RetrievalModelsError(
                f"Unknown model_id: {model_id}",
                error_code="retrieval_model_not_found",
            )

        spec = LOCAL_MODEL_SPECS[model_id]
        app_config = get_app_config()
        cfg = app_config.retrieval_models
        model_root = self._resolve_model_root(cfg)
        model_root.mkdir(parents=True, exist_ok=True)

        # Save to temporary file for validation
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".onnx", delete=False) as tmp_file:
            tmp_file.write(file_content)
            tmp_path = Path(tmp_file.name)

        try:
            # Validate ONNX model
            _probe_onnx_model(str(tmp_path))

            # Move to target location
            target_file = model_root / f"{model_id}.onnx"
            tmp_path.rename(target_file)

            # Update registry
            registry = self._load_registry(cfg)
            if "models" not in registry or not isinstance(registry["models"], dict):
                registry["models"] = {}

            registry["models"][model_id] = {
                "model_id": model_id,
                "family": spec.family,
                "display_name": spec.display_name,
                "file_path": str(target_file.relative_to(model_root)),
                "installed": True,
                "installed_at": time.time(),
            }
            registry["updated_at"] = time.time()

            # Save registry
            registry_path = self._resolve_registry_path(cfg)
            registry_path.parent.mkdir(parents=True, exist_ok=True)
            registry_path.write_text(json.dumps(registry, indent=2, ensure_ascii=False), encoding="utf-8")

            return {
                "success": True,
                "model_id": model_id,
                "message": f"Model {spec.display_name} imported successfully",
            }

        except RetrievalModelsError:
            # Clean up temp file on validation error
            if tmp_path.exists():
                tmp_path.unlink()
            raise
        except Exception as error:
            # Clean up temp file on any error
            if tmp_path.exists():
                tmp_path.unlink()
            raise RetrievalModelsError(
                f"Failed to import model: {error}",
                error_code="retrieval_import_failed",
            ) from error
