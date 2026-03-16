import asyncio
import os
import time
from collections.abc import Sequence
from typing import Any, Literal
from urllib.parse import urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, HTTPException

try:
    from langchain_core.language_models.chat_models import BaseChatModel
except Exception:  # pragma: no cover - compatibility fallback
    from langchain.chat_models import BaseChatModel  # type: ignore
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from nion.config import get_app_config
from nion.reflection import resolve_class
from nion.tools.builtins._service_ops import (
    ModelConnectionTestRequest,
    ModelConnectionTestResponse,
    ModelResponse,
    ModelsListResponse,
    ProviderModelListUnsupportedError,
    test_model_connection as _test_model_connection,
)

router = APIRouter(prefix="/api", tags=["models"])

_MODELS_DEV_CACHE: dict[str, Any] | None = None
_MODELS_DEV_CACHE_AT = 0.0
_MODELS_DEV_CACHE_TTL_SECONDS = 600.0


class ProviderModelsRequest(BaseModel):
    """Request model for fetching model list from a provider."""

    use: str = Field(..., min_length=1, description="Provider class path")
    api_key: str | None = Field(default=None, description="Provider API key or env placeholder")
    api_base: str | None = Field(default=None, description="Provider API base URL")
    provider_protocol: Literal["auto", "openai-compatible", "anthropic-compatible"] | None = Field(
        default="auto",
        description="Provider protocol type: auto, openai-compatible, or anthropic-compatible",
    )
    timeout_seconds: float = Field(default=15.0, ge=1.0, le=60.0, description="Request timeout in seconds")


class ProviderModelOption(BaseModel):
    """A single model option available from provider model catalog."""

    id: str = Field(..., description="Provider model id")
    name: str | None = Field(default=None, description="Display name")
    supports_thinking: bool | None = Field(default=None, description="Whether reasoning mode is supported")
    supports_vision: bool | None = Field(default=None, description="Whether image/pdf understanding is supported")
    supports_video: bool | None = Field(default=None, description="Whether video understanding is supported")
    context_window: int | None = Field(default=None, description="Maximum context window")
    max_output_tokens: int | None = Field(default=None, description="Maximum output tokens")
    source: str = Field(default="provider", description="Metadata source: provider or provider+models.dev")


class ProviderModelsResponse(BaseModel):
    """Response model for provider model list request."""

    success: bool = Field(..., description="Whether model list fetch succeeded")
    message: str = Field(..., description="Result message")
    provider_type: str = Field(..., description="Detected provider protocol type")
    models: list[ProviderModelOption] = Field(default_factory=list, description="Available models")


class ModelMetadataRequest(BaseModel):
    """Request model for enriching a single model with models.dev metadata."""

    model: str = Field(..., min_length=1, description="Model id to inspect")
    use: str = Field(default="", description="Provider class path used for provider key inference")
    api_base: str | None = Field(default=None, description="Provider API base URL")
    provider_protocol: Literal["auto", "openai-compatible", "anthropic-compatible"] | None = Field(
        default="auto",
        description="Provider protocol type: auto, openai-compatible, or anthropic-compatible",
    )
    timeout_seconds: float = Field(default=10.0, ge=1.0, le=60.0, description="Request timeout in seconds")


class ModelMetadataResponse(BaseModel):
    """Response model for single model metadata inspection."""

    success: bool = Field(..., description="Whether metadata lookup succeeded")
    found: bool = Field(..., description="Whether metadata was found")
    message: str = Field(..., description="Lookup message")
    model: ProviderModelOption | None = Field(default=None, description="Resolved model metadata when found")


def _strip_optional(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _resolve_env_placeholder(value: str | None) -> str | None:
    stripped = _strip_optional(value)
    if stripped is None:
        return None
    if stripped.startswith("$"):
        return os.getenv(stripped[1:], stripped)
    return stripped


def _sanitize_error_message(raw_message: str, secrets: Sequence[str | None] | None = None) -> str:
    message = raw_message.strip() or "Unknown error"
    for secret in secrets or []:
        if secret:
            message = message.replace(secret, "***")
    return message


def _extract_text_preview(response: Any, max_len: int = 180) -> str | None:
    content = getattr(response, "content", response)
    if content is None:
        return None

    if isinstance(content, str):
        text = content.strip()
    elif isinstance(content, Sequence):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        text = " ".join(part.strip() for part in parts if part.strip())
    else:
        text = str(content).strip()

    if not text:
        return None
    if len(text) <= max_len:
        return text
    return f"{text[:max_len].rstrip()}..."


def _normalize_provider_protocol(
    provider_protocol: str | None,
) -> Literal["auto", "openai-compatible", "anthropic-compatible"]:
    normalized = (_strip_optional(provider_protocol) or "auto").lower()
    if normalized in ("openai", "openai-compatible"):
        return "openai-compatible"
    if normalized in ("anthropic", "anthropic-compatible"):
        return "anthropic-compatible"
    return "auto"


def _normalize_anthropic_api_base(api_base: str | None) -> str | None:
    raw = _strip_optional(api_base)
    if raw is None:
        return None

    parsed = urlsplit(raw)
    if not parsed.scheme or not parsed.netloc:
        return raw.rstrip("/")

    host = parsed.netloc.lower()
    path = (parsed.path or "").rstrip("/")
    if path.lower() == "/v1":
        path = ""

    if path == "" and ("minimax" in host or "minimaxi" in host):
        path = "/anthropic"

    normalized = urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, parsed.fragment))
    return normalized.rstrip("/")


def _detect_provider_type(
    use: str,
    api_base: str | None,
    provider_protocol: str | None = None,
) -> str:
    explicit_protocol = _normalize_provider_protocol(provider_protocol)
    if explicit_protocol != "auto":
        return explicit_protocol

    use_lower = use.lower()
    api_base_lower = (api_base or "").lower()
    if "anthropic" in use_lower:
        return "anthropic-compatible"
    if any(keyword in use_lower for keyword in ("openai", "deepseek", "moonshot")):
        return "openai-compatible"
    if _strip_optional(api_base):
        if "anthropic" in api_base_lower:
            return "anthropic-compatible"
        return "openai-compatible"
    return "unknown"


def _guess_models_dev_provider_key(use: str, api_base: str | None) -> str | None:
    use_lower = use.lower()
    api_base_lower = (api_base or "").lower()

    if "openrouter" in use_lower or "openrouter.ai" in api_base_lower:
        return "openrouter"
    if "siliconflow" in use_lower or "siliconflow.cn" in api_base_lower:
        return "siliconflow"
    if "groq" in use_lower or "api.groq.com" in api_base_lower:
        return "groq"
    if "xai" in use_lower or "api.x.ai" in api_base_lower:
        return "xai"
    if "dashscope" in use_lower or "dashscope.aliyuncs.com" in api_base_lower:
        return "alibaba"
    if "minimax" in use_lower or "minimax" in api_base_lower:
        return "minimax"
    if "moonshot" in use_lower or "moonshot" in api_base_lower or "kimi" in use_lower or "kimi" in api_base_lower:
        return "moonshotai"
    if "zhipu" in use_lower or "bigmodel" in use_lower or "glm" in use_lower or "zhipu" in api_base_lower or "bigmodel" in api_base_lower or "glm" in api_base_lower:
        return "zhipuai"
    if "anthropic" in use_lower:
        return "anthropic"
    if "deepseek" in use_lower:
        return "deepseek"
    if "openai" in use_lower:
        return "openai"
    return None


def _coerce_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        as_int = int(value)
        return as_int if as_int > 0 else None
    except (TypeError, ValueError):
        return None


def _lookup_models_dev_model(
    models_dev_models: dict[str, dict[str, Any]],
    target_model_id: str,
) -> tuple[str, dict[str, Any]] | None:
    normalized_target = target_model_id.strip().lower()
    if not normalized_target:
        return None

    for model_id, model_meta in models_dev_models.items():
        if not isinstance(model_meta, dict):
            continue
        if model_id.strip().lower() == normalized_target:
            return model_id, model_meta
    return None


def _build_provider_model_option_with_models_dev(
    model_id: str,
    meta: dict[str, Any],
    *,
    fallback_name: str | None = None,
    source: str = "models.dev",
) -> ProviderModelOption:
    modalities = meta.get("modalities", {})
    input_modalities_raw = modalities.get("input") if isinstance(modalities, dict) else []
    if not isinstance(input_modalities_raw, list):
        input_modalities_raw = []
    input_modalities = {str(modality).strip().lower() for modality in input_modalities_raw if isinstance(modality, str)}

    supports_thinking = bool(meta.get("reasoning")) if "reasoning" in meta else None
    supports_vision = True if {"image", "pdf"} & input_modalities else False if input_modalities else None
    supports_video = True if "video" in input_modalities else False if input_modalities else None

    context_window = None
    max_output_tokens = None
    limit = meta.get("limit", {})
    if isinstance(limit, dict):
        context_window = _coerce_int(limit.get("context"))
        max_output_tokens = _coerce_int(limit.get("output"))

    return ProviderModelOption(
        id=model_id,
        name=fallback_name or (str(meta.get("name")).strip() if "name" in meta else None),
        supports_thinking=supports_thinking,
        supports_vision=supports_vision,
        supports_video=supports_video,
        context_window=context_window,
        max_output_tokens=max_output_tokens,
        source=source,
    )


def _build_provider_init_kwargs(
    use: str,
    model: str,
    api_key: str | None,
    api_base: str | None,
    provider_protocol: str | None,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"model": model}
    use_lower = use.lower()
    provider_type = _detect_provider_type(use=use, api_base=api_base, provider_protocol=provider_protocol)

    if provider_type == "anthropic-compatible" or "anthropic" in use_lower:
        normalized_anthropic_base = _normalize_anthropic_api_base(api_base)
        if api_key is not None:
            kwargs["anthropic_api_key"] = api_key
        if normalized_anthropic_base is not None:
            kwargs["anthropic_api_url"] = normalized_anthropic_base
        return kwargs

    if "langchain_openai" in use_lower:
        if api_key is not None:
            kwargs["openai_api_key"] = api_key
        if api_base is not None:
            kwargs["base_url"] = api_base
        return kwargs

    # DeepSeek / custom OpenAI-compatible wrappers often accept api_key/api_base.
    if api_key is not None:
        kwargs["api_key"] = api_key
    if api_base is not None:
        kwargs["api_base"] = api_base
    return kwargs


async def _fetch_provider_models_openai_compatible(
    api_base: str | None,
    api_key: str | None,
    timeout_seconds: float,
) -> list[dict[str, str]]:
    base = _strip_optional(api_base) or "https://api.openai.com/v1"
    base = base.rstrip("/")
    candidate_urls: list[str] = [f"{base}/models"]
    if not base.endswith("/v1"):
        candidate_urls.append(f"{base}/v1/models")
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        payload: Any = None
        unsupported_errors: list[str] = []
        for url in candidate_urls:
            response = await client.get(url, headers=headers or None)
            if response.status_code in {404, 405, 501}:
                unsupported_errors.append(f"{response.status_code} {url}")
                continue
            response.raise_for_status()
            payload = response.json()
            break

    if payload is None:
        detail = "; ".join(unsupported_errors) if unsupported_errors else "models endpoint unavailable"
        raise ProviderModelListUnsupportedError(detail)

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return []

    result: list[dict[str, str]] = []
    seen = set()
    for item in data:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id", "")).strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        name = str(item.get("name", "")).strip() or model_id
        result.append({"id": model_id, "name": name})
    return result


async def _fetch_provider_models_anthropic(
    api_base: str | None,
    api_key: str | None,
    timeout_seconds: float,
) -> list[dict[str, str]]:
    base = _normalize_anthropic_api_base(api_base) or "https://api.anthropic.com"
    base = base.rstrip("/")
    candidate_urls: list[str] = [
        f"{base}/v1/models",
        f"{base}/models",
    ]
    headers: dict[str, str] = {
        "anthropic-version": "2023-06-01",
    }
    if api_key:
        headers["x-api-key"] = api_key

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        payload: Any = None
        unsupported_errors: list[str] = []
        for url in candidate_urls:
            response = await client.get(url, headers=headers)
            if response.status_code in {404, 405, 501}:
                unsupported_errors.append(f"{response.status_code} {url}")
                continue
            response.raise_for_status()
            payload = response.json()
            break

    if payload is None:
        detail = "; ".join(unsupported_errors) if unsupported_errors else "models endpoint unavailable"
        raise ProviderModelListUnsupportedError(detail)

    candidates: list[Any] = []
    if isinstance(payload, dict):
        if isinstance(payload.get("data"), list):
            candidates = payload["data"]
        elif isinstance(payload.get("models"), list):
            candidates = payload["models"]

    result: list[dict[str, str]] = []
    seen = set()
    for item in candidates:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id", "")).strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        display_name = str(item.get("display_name", "")).strip()
        name = display_name or str(item.get("name", "")).strip() or model_id
        result.append({"id": model_id, "name": name})
    return result


async def _load_models_dev_catalog(timeout_seconds: float) -> dict[str, Any]:
    global _MODELS_DEV_CACHE, _MODELS_DEV_CACHE_AT

    now = time.monotonic()
    if _MODELS_DEV_CACHE is not None and now - _MODELS_DEV_CACHE_AT < _MODELS_DEV_CACHE_TTL_SECONDS:
        return _MODELS_DEV_CACHE

    timeout = min(max(timeout_seconds, 1.0), 30.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get("https://models.dev/api.json")
        response.raise_for_status()
        payload = response.json()

    if not isinstance(payload, dict):
        return {}

    _MODELS_DEV_CACHE = payload
    _MODELS_DEV_CACHE_AT = now
    return payload


async def _fetch_models_dev_provider_models(
    provider_key: str | None,
    timeout_seconds: float,
) -> dict[str, dict[str, Any]]:
    if not provider_key:
        return {}

    catalog = await _load_models_dev_catalog(timeout_seconds)
    provider_item = catalog.get(provider_key)
    if not isinstance(provider_item, dict):
        return {}
    models = provider_item.get("models")
    if not isinstance(models, dict):
        return {}

    result: dict[str, dict[str, Any]] = {}
    for model_id, model_meta in models.items():
        if isinstance(model_id, str) and isinstance(model_meta, dict):
            result[model_id] = model_meta
    return result


def _merge_provider_models_with_models_dev(
    provider_models: list[dict[str, str]],
    models_dev_models: dict[str, dict[str, Any]],
) -> list[ProviderModelOption]:
    merged: list[ProviderModelOption] = []
    for item in provider_models:
        model_id = item.get("id", "").strip()
        if not model_id:
            continue

        hit = _lookup_models_dev_model(models_dev_models, model_id)
        if hit is not None:
            _, meta = hit
            merged.append(
                _build_provider_model_option_with_models_dev(
                    model_id=model_id,
                    meta=meta,
                    fallback_name=item.get("name"),
                    source="provider+models.dev",
                )
            )
            continue

        merged.append(
            ProviderModelOption(
                id=model_id,
                name=item.get("name") or None,
                source="provider",
            )
        )

    return merged


async def _find_models_dev_model_metadata(
    model_id: str,
    provider_key: str | None,
    timeout_seconds: float,
) -> tuple[str, dict[str, Any]] | None:
    models_by_provider = await _fetch_models_dev_provider_models(provider_key, timeout_seconds)
    direct_hit = _lookup_models_dev_model(models_by_provider, model_id)
    if direct_hit is not None:
        return direct_hit

    catalog = await _load_models_dev_catalog(timeout_seconds)
    normalized_target = model_id.strip().lower()
    if not normalized_target:
        return None

    for provider_item in catalog.values():
        if not isinstance(provider_item, dict):
            continue
        models = provider_item.get("models")
        if not isinstance(models, dict):
            continue
        for catalog_model_id, catalog_meta in models.items():
            if not isinstance(catalog_model_id, str) or not isinstance(catalog_meta, dict):
                continue
            if catalog_model_id.strip().lower() == normalized_target:
                return catalog_model_id, catalog_meta
    return None


@router.post(
    "/models/model-metadata",
    response_model=ModelMetadataResponse,
    summary="Inspect Model Metadata",
    description="Resolve a model's capabilities from models.dev (thinking, vision/video, context, output).",
)
async def inspect_model_metadata(
    request: ModelMetadataRequest,
) -> ModelMetadataResponse:
    target_model_id = request.model.strip()
    provider_key = _guess_models_dev_provider_key(
        request.use.strip(),
        _strip_optional(request.api_base),
    )

    try:
        hit = await _find_models_dev_model_metadata(
            model_id=target_model_id,
            provider_key=provider_key,
            timeout_seconds=request.timeout_seconds,
        )
    except Exception as exc:  # pragma: no cover - branch tested through api behavior
        return ModelMetadataResponse(
            success=False,
            found=False,
            message=f"Failed to inspect model metadata: {_sanitize_error_message(str(exc))}",
            model=None,
        )

    if hit is None:
        return ModelMetadataResponse(
            success=True,
            found=False,
            message="No models.dev metadata found for this model",
            model=None,
        )

    matched_model_id, metadata = hit
    option = _build_provider_model_option_with_models_dev(
        model_id=matched_model_id,
        meta=metadata,
        source="models.dev",
    )
    return ModelMetadataResponse(
        success=True,
        found=True,
        message="models.dev metadata loaded",
        model=option,
    )


@router.get(
    "/models",
    response_model=ModelsListResponse,
    summary="List All Models",
    description="Retrieve a list of all available AI models configured in the system.",
)
async def list_models() -> ModelsListResponse:
    """List all available models from configuration.

    Returns model information suitable for frontend display,
    excluding sensitive fields like API keys and internal configuration.

    Returns:
        A list of all configured models with their metadata.

    Example Response:
        ```json
        {
            "models": [
                {
                    "name": "gpt-4",
                    "display_name": "GPT-4",
                    "description": "OpenAI GPT-4 model",
                    "supports_thinking": false
                },
                {
                    "name": "claude-3-opus",
                    "display_name": "Claude 3 Opus",
                    "description": "Anthropic Claude 3 Opus model",
                    "supports_thinking": true
                }
            ]
        }
        ```
    """
    config = get_app_config()
    models = [
        ModelResponse(
            name=model.name,
            display_name=model.display_name,
            description=model.description,
            supports_thinking=model.supports_thinking,
            supports_reasoning_effort=model.supports_reasoning_effort,
            supports_vision=model.supports_vision,
            supports_video=bool(getattr(model, "supports_video", False)),
        )
        for model in config.models
    ]
    return ModelsListResponse(models=models)


@router.get(
    "/models/{model_name}",
    response_model=ModelResponse,
    summary="Get Model Details",
    description="Retrieve detailed information about a specific AI model by its name.",
)
async def get_model(model_name: str) -> ModelResponse:
    """Get a specific model by name.

    Args:
        model_name: The unique name of the model to retrieve.

    Returns:
        Model information if found.

    Raises:
        HTTPException: 404 if model not found.

    Example Response:
        ```json
        {
            "name": "gpt-4",
            "display_name": "GPT-4",
            "description": "OpenAI GPT-4 model",
            "supports_thinking": false
        }
        ```
    """
    config = get_app_config()
    model = config.get_model_config(model_name)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")

    return ModelResponse(
        name=model.name,
        display_name=model.display_name,
        description=model.description,
        supports_thinking=model.supports_thinking,
        supports_reasoning_effort=model.supports_reasoning_effort,
        supports_vision=model.supports_vision,
        supports_video=bool(getattr(model, "supports_video", False)),
    )


@router.post(
    "/models/test-connection",
    response_model=ModelConnectionTestResponse,
    summary="Test Model Provider Connection",
    description="Test provider connectivity with a lightweight model invocation.",
)
async def test_model_connection(
    request: ModelConnectionTestRequest,
) -> ModelConnectionTestResponse:
    return await _test_model_connection(request)


@router.post(
    "/models/provider-models",
    response_model=ProviderModelsResponse,
    summary="List Provider Models",
    description="Fetch model list from provider API and enrich capabilities with models.dev metadata.",
)
async def list_provider_models(
    request: ProviderModelsRequest,
) -> ProviderModelsResponse:
    """List models from provider and enrich capabilities."""
    provider_type = _detect_provider_type(
        request.use.strip(),
        request.api_base,
        request.provider_protocol,
    )
    raw_api_key = _strip_optional(request.api_key)
    api_key = _resolve_env_placeholder(request.api_key)
    api_base = _strip_optional(request.api_base)

    if provider_type == "unknown":
        return ProviderModelsResponse(
            success=False,
            message="Provider model listing is not supported for this provider type yet",
            provider_type=provider_type,
            models=[],
        )

    provider_models: list[dict[str, str]] = []
    provider_fetch_error: str | None = None
    provider_listing_unsupported = False
    try:
        if provider_type == "anthropic-compatible":
            provider_models = await _fetch_provider_models_anthropic(
                api_base=api_base,
                api_key=api_key,
                timeout_seconds=request.timeout_seconds,
            )
        else:
            provider_models = await _fetch_provider_models_openai_compatible(
                api_base=api_base,
                api_key=api_key,
                timeout_seconds=request.timeout_seconds,
            )
    except ProviderModelListUnsupportedError as exc:
        provider_listing_unsupported = True
        provider_fetch_error = _sanitize_error_message(str(exc))
    except Exception as exc:  # pragma: no cover - branch tested through api behavior
        provider_fetch_error = _sanitize_error_message(str(exc), [raw_api_key, api_key])

    if not provider_models:
        if provider_listing_unsupported:
            return ProviderModelsResponse(
                success=True,
                message="Provider does not expose model list API. Please add models manually.",
                provider_type=provider_type,
                models=[],
            )
        if provider_fetch_error:
            return ProviderModelsResponse(
                success=False,
                message=f"Failed to load model list: {provider_fetch_error}",
                provider_type=provider_type,
                models=[],
            )
        return ProviderModelsResponse(
            success=True,
            message="No models returned by provider",
            provider_type=provider_type,
            models=[],
        )

    models_dev_provider_key = _guess_models_dev_provider_key(request.use.strip(), api_base)
    models_dev_models: dict[str, dict[str, Any]] = {}
    try:
        models_dev_models = await _fetch_models_dev_provider_models(
            provider_key=models_dev_provider_key,
            timeout_seconds=request.timeout_seconds,
        )
    except Exception:
        models_dev_models = {}

    merged_models = _merge_provider_models_with_models_dev(
        provider_models=provider_models,
        models_dev_models=models_dev_models,
    )

    message = f"Loaded {len(merged_models)} models"
    if models_dev_provider_key and not models_dev_models:
        message = f"Loaded {len(merged_models)} models (models.dev metadata unavailable)"

    return ProviderModelsResponse(
        success=True,
        message=message,
        provider_type=provider_type,
        models=merged_models,
    )
