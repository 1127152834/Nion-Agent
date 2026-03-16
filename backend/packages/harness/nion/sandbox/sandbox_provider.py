from abc import ABC, abstractmethod

from nion.config.app_config import ensure_latest_app_config
from nion.reflection import resolve_class
from nion.sandbox.sandbox import Sandbox


class SandboxProvider(ABC):
    """Abstract base class for sandbox providers"""

    @abstractmethod
    def acquire(self, thread_id: str | None = None) -> str:
        """Acquire a sandbox environment and return its ID.

        Returns:
            The ID of the acquired sandbox environment.
        """
        pass

    @abstractmethod
    def get(self, sandbox_id: str) -> Sandbox | None:
        """Get a sandbox environment by ID.

        Args:
            sandbox_id: The ID of the sandbox environment to retain.
        """
        pass

    @abstractmethod
    def release(self, sandbox_id: str) -> None:
        """Release a sandbox environment.

        Args:
            sandbox_id: The ID of the sandbox environment to destroy.
        """
        pass


_default_sandbox_provider: SandboxProvider | None = None
_default_sandbox_provider_use: str | None = None


def get_sandbox_provider(**kwargs) -> SandboxProvider:
    """Get the sandbox provider singleton.

    Returns a cached singleton instance. Use `reset_sandbox_provider()` to clear
    the cache, or `shutdown_sandbox_provider()` to properly shutdown and clear.

    Returns:
        A sandbox provider instance.
    """
    global _default_sandbox_provider
    global _default_sandbox_provider_use

    config = ensure_latest_app_config()
    sandbox_use = str(getattr(config.sandbox, "use", "") or "")

    if bool(getattr(config.sandbox, "strict_mode", False)) and "LocalSandboxProvider" in sandbox_use:
        raise RuntimeError("Strict sandbox mode requires a container-based sandbox provider. Switch sandbox.use to nion.community.aio_sandbox:AioSandboxProvider.")

    # Reload provider when the `sandbox.use` config changes.
    if _default_sandbox_provider is None or _default_sandbox_provider_use != sandbox_use:
        if _default_sandbox_provider is not None and hasattr(_default_sandbox_provider, "shutdown"):
            _default_sandbox_provider.shutdown()
        cls = resolve_class(sandbox_use, SandboxProvider)
        _default_sandbox_provider = cls(**kwargs)
        _default_sandbox_provider_use = sandbox_use
    return _default_sandbox_provider


def reset_sandbox_provider() -> None:
    """Reset the sandbox provider singleton.

    This clears the cached instance without calling shutdown.
    The next call to `get_sandbox_provider()` will create a new instance.
    Useful for testing or when switching configurations.

    Note: If the provider has active sandboxes, they will be orphaned.
    Use `shutdown_sandbox_provider()` for proper cleanup.
    """
    global _default_sandbox_provider
    _default_sandbox_provider = None
    global _default_sandbox_provider_use
    _default_sandbox_provider_use = None


def shutdown_sandbox_provider() -> None:
    """Shutdown and reset the sandbox provider.

    This properly shuts down the provider (releasing all sandboxes)
    before clearing the singleton. Call this when the application
    is shutting down or when you need to completely reset the sandbox system.
    """
    global _default_sandbox_provider
    if _default_sandbox_provider is not None:
        if hasattr(_default_sandbox_provider, "shutdown"):
            _default_sandbox_provider.shutdown()
        _default_sandbox_provider = None
    global _default_sandbox_provider_use
    _default_sandbox_provider_use = None


def set_sandbox_provider(provider: SandboxProvider) -> None:
    """Set a custom sandbox provider instance.

    This allows injecting a custom or mock provider for testing purposes.

    Args:
        provider: The SandboxProvider instance to use.
    """
    global _default_sandbox_provider
    _default_sandbox_provider = provider
    global _default_sandbox_provider_use
    _default_sandbox_provider_use = None
