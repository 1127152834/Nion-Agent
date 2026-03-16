import logging
from typing import Any, Literal
from urllib.parse import urlsplit, urlunsplit

try:
    from langchain_core.language_models.chat_models import BaseChatModel
except Exception:  # pragma: no cover - compatibility fallback
    from langchain.chat_models import BaseChatModel  # type: ignore

from src.config import get_app_config, get_tracing_config, is_tracing_enabled
from src.reflection import resolve_class

logger = logging.getLogger(__name__)

# 元数据字段，不传递给模型构造函数
_RUNTIME_METADATA_KEYS = {
    "provider_id",
    "provider_protocol",
    "supports_video",
    "context_window",
    "supports_thinking",
    "supports_reasoning_effort",
    "when_thinking_enabled",
    "supports_vision",
}


def _strip_optional(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return str(value)


def _normalize_provider_protocol(value: Any) -> Literal["auto", "openai-compatible", "anthropic-compatible"]:
    normalized = (_strip_optional(value) or "auto").lower()
    if normalized in {"openai", "openai-compatible"}:
        return "openai-compatible"
    if normalized in {"anthropic", "anthropic-compatible"}:
        return "anthropic-compatible"
    return "auto"


def _normalize_anthropic_api_base(value: Any) -> str | None:
    """Normalize anthropic-compatible base URL."""
    raw = _strip_optional(value)
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


def _prepare_model_runtime_kwargs(use: str, settings: dict[str, Any]) -> dict[str, Any]:
    """Prepare runtime settings by removing metadata keys and normalizing provider-specific fields."""
    runtime_settings = dict(settings)

    # 移除元数据字段，不传递给模型构造函数
    for key in _RUNTIME_METADATA_KEYS:
        runtime_settings.pop(key, None)

    model_kwargs = runtime_settings.get("model_kwargs")
    if isinstance(model_kwargs, dict):
        cleaned_model_kwargs = dict(model_kwargs)
        for key in _RUNTIME_METADATA_KEYS:
            cleaned_model_kwargs.pop(key, None)
        runtime_settings["model_kwargs"] = cleaned_model_kwargs

    protocol = _normalize_provider_protocol(settings.get("provider_protocol"))
    use_lower = use.strip().lower()
    api_key = _strip_optional(runtime_settings.get("api_key"))
    api_base = _strip_optional(runtime_settings.get("api_base"))

    # Anthropic 兼容 API 处理
    is_anthropic = protocol == "anthropic-compatible" or "anthropic" in use_lower
    if is_anthropic:
        normalized_api_base = _normalize_anthropic_api_base(api_base)
        if api_key and not _strip_optional(runtime_settings.get("anthropic_api_key")):
            runtime_settings["anthropic_api_key"] = api_key
        if normalized_api_base and not _strip_optional(runtime_settings.get("anthropic_api_url")):
            runtime_settings["anthropic_api_url"] = normalized_api_base
        runtime_settings.pop("api_key", None)
        runtime_settings.pop("api_base", None)
        return runtime_settings

    # OpenAI 兼容 API 处理
    is_langchain_openai = "langchain_openai" in use_lower
    if is_langchain_openai:
        if api_key and not _strip_optional(runtime_settings.get("openai_api_key")):
            runtime_settings["openai_api_key"] = api_key
        if api_base and not _strip_optional(runtime_settings.get("base_url")):
            runtime_settings["base_url"] = api_base
        runtime_settings.pop("api_base", None)

    return runtime_settings


def create_chat_model(name: str | None = None, thinking_enabled: bool = False, **kwargs) -> BaseChatModel:
    """Create a chat model instance from the config.

    Args:
        name: The name of the model to create. If None, the first model in the config will be used.

    Returns:
        A chat model instance.
    """
    config = get_app_config()
    if name is None:
        name = config.models[0].name
    model_config = config.get_model_config(name)
    if model_config is None:
        raise ValueError(f"Model {name} not found in configuration") from None
    model_class = resolve_class(model_config.use, BaseChatModel)
    model_settings_from_config = model_config.model_dump(
        exclude_none=True,
        exclude={
            "use",
            "name",
            "display_name",
            "description",
            "supports_thinking",
            "supports_reasoning_effort",
            "when_thinking_enabled",
            "thinking",
            "supports_vision",
        },
    )
    # Compute effective when_thinking_enabled by merging in the `thinking` shortcut field.
    # The `thinking` shortcut is equivalent to setting when_thinking_enabled["thinking"].
    has_thinking_settings = (model_config.when_thinking_enabled is not None) or (model_config.thinking is not None)
    effective_wte: dict = dict(model_config.when_thinking_enabled) if model_config.when_thinking_enabled else {}
    if model_config.thinking is not None:
        merged_thinking = {**(effective_wte.get("thinking") or {}), **model_config.thinking}
        effective_wte = {**effective_wte, "thinking": merged_thinking}
    if thinking_enabled and has_thinking_settings:
        if not model_config.supports_thinking:
            raise ValueError(f"Model {name} does not support thinking. Set `supports_thinking: true` for this model via Config Center (UI) or the Config Center API (/api/config) to enable thinking.") from None
        if effective_wte:
            model_settings_from_config.update(effective_wte)
    if not thinking_enabled and has_thinking_settings:
        if effective_wte.get("extra_body", {}).get("thinking", {}).get("type"):
            # OpenAI-compatible gateway: thinking is nested under extra_body
            kwargs.update({"extra_body": {"thinking": {"type": "disabled"}}})
            kwargs.update({"reasoning_effort": "minimal"})
        elif effective_wte.get("thinking", {}).get("type"):
            # Native langchain_anthropic: thinking is a direct constructor parameter
            kwargs.update({"thinking": {"type": "disabled"}})
    if not model_config.supports_reasoning_effort and "reasoning_effort" in kwargs:
        # Only strip reasoning_effort if it was set by thinking-disabled logic.
        del kwargs["reasoning_effort"]

    # 使用运行时设置处理函数
    model_settings_from_config = _prepare_model_runtime_kwargs(
        model_config.use,
        model_settings_from_config,
    )
    model_instance = model_class(**kwargs, **model_settings_from_config)

    if is_tracing_enabled():
        try:
            from langchain_core.tracers.langchain import LangChainTracer

            tracing_config = get_tracing_config()
            tracer = LangChainTracer(
                project_name=tracing_config.project,
            )
            existing_callbacks = model_instance.callbacks or []
            model_instance.callbacks = [*existing_callbacks, tracer]
            logger.debug(f"LangSmith tracing attached to model '{name}' (project='{tracing_config.project}')")
        except Exception as e:
            logger.warning(f"Failed to attach LangSmith tracing to model '{name}': {e}")
    return model_instance
