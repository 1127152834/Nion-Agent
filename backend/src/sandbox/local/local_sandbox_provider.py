from src.sandbox.local.local_sandbox import LocalSandbox
from src.sandbox.sandbox import Sandbox
from src.sandbox.sandbox_provider import SandboxProvider

_singleton: LocalSandbox | None = None


class LocalSandboxProvider(SandboxProvider):
    def __init__(self):
        """Initialize the local sandbox provider with path mappings and Python path."""
        self._path_mappings = self._setup_path_mappings()
        self._python_path = self._setup_python_path()

    def _setup_python_path(self) -> str | None:
        """
        Setup Python path from configuration.

        Returns:
            Python executable path from config, or None to use system Python
        """
        try:
            from src.config import get_app_config
            import os

            config = get_app_config()
            python_path = config.sandbox.python_path

            # Resolve environment variable if path starts with $
            if python_path and python_path.startswith("$"):
                env_var = python_path[1:]
                python_path = os.environ.get(env_var)

            return python_path
        except Exception as e:
            # Log but don't fail if config loading fails
            print(f"Warning: Could not setup Python path: {e}")
            return None

    def _setup_path_mappings(self) -> dict[str, str]:
        """
        Setup path mappings for local sandbox.

        Maps container paths to actual local paths, including skills directory.

        Returns:
            Dictionary of path mappings
        """
        mappings = {}

        # Map skills container path to local skills directory
        try:
            from src.config import get_app_config

            config = get_app_config()
            skills_path = config.skills.get_skills_path()
            container_path = config.skills.container_path

            # Only add mapping if skills directory exists
            if skills_path.exists():
                mappings[container_path] = str(skills_path)
        except Exception as e:
            # Log but don't fail if config loading fails
            print(f"Warning: Could not setup skills path mapping: {e}")

        return mappings

    def acquire(self, thread_id: str | None = None) -> str:
        global _singleton
        if _singleton is None:
            _singleton = LocalSandbox("local", path_mappings=self._path_mappings, python_path=self._python_path)
        return _singleton.id

    def get(self, sandbox_id: str) -> Sandbox | None:
        if sandbox_id == "local":
            if _singleton is None:
                self.acquire()
            return _singleton
        return None

    def release(self, sandbox_id: str) -> None:
        # LocalSandbox uses singleton pattern - no cleanup needed.
        # Note: This method is intentionally not called by SandboxMiddleware
        # to allow sandbox reuse across multiple turns in a thread.
        # For Docker-based providers (e.g., AioSandboxProvider), cleanup
        # happens at application shutdown via the shutdown() method.
        pass
