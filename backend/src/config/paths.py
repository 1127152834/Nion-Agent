import os
import re
from pathlib import Path

# Virtual path prefix seen by agents inside the sandbox
VIRTUAL_PATH_PREFIX = "/mnt/user-data"
CLIS_VIRTUAL_ROOT = "/mnt/clis"

_SAFE_THREAD_ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")


class Paths:
    """
    Centralized path configuration for Nion application data.

    Directory layout (host side):
        {base_dir}/
        ├── USER.md
        ├── agents/
        │   └── {agent_name}/
        │       ├── agent.json
        │       ├── SOUL.md
        │       └── IDENTITY.md
        ├── openviking/
        │   ├── global/
        │   ├── agent-*/
        │   └── memory_index.db
        └── threads/
            └── {thread_id}/
                └── user-data/         <-- mounted as /mnt/user-data/ inside sandbox
                    ├── workspace/     <-- /mnt/user-data/workspace/
                    ├── uploads/       <-- /mnt/user-data/uploads/
                    └── outputs/       <-- /mnt/user-data/outputs/

    BaseDir resolution (in priority order):
        1. Constructor argument `base_dir`
        2. NION_HOME environment variable
        3. Local dev fallback: cwd/.nion  (when cwd is the backend/ dir)
        4. Default: $HOME/.nion
    """

    def __init__(self, base_dir: str | Path | None = None) -> None:
        self._base_dir = Path(base_dir).resolve() if base_dir is not None else None

    @property
    def base_dir(self) -> Path:
        """Root directory for all application data."""
        if self._base_dir is not None:
            return self._base_dir

        if env_home := os.getenv("NION_HOME"):
            return Path(env_home).resolve()

        cwd = Path.cwd()
        if cwd.name == "backend" or (cwd / "pyproject.toml").exists():
            return cwd / ".nion"

        return Path.home() / ".nion"

    @property
    def user_md_file(self) -> Path:
        """Path to the global user profile file: `{base_dir}/USER.md`."""
        return self.base_dir / "USER.md"

    def agent_soul_file(self, name: str) -> Path:
        """Per-agent SOUL.md: `{base_dir}/agents/{name}/SOUL.md`."""
        return self.agent_dir(name) / "SOUL.md"

    def agent_identity_file(self, name: str) -> Path:
        """Per-agent IDENTITY.md: `{base_dir}/agents/{name}/IDENTITY.md`."""
        return self.agent_dir(name) / "IDENTITY.md"

    @property
    def agents_dir(self) -> Path:
        """Root directory for all custom agents: `{base_dir}/agents/`."""
        return self.base_dir / "agents"

    def agent_dir(self, name: str) -> Path:
        """Directory for a specific agent: `{base_dir}/agents/{name}/`."""
        return self.agents_dir / name.lower()

    def agent_config_file(self, name: str) -> Path:
        """Per-agent config file: `{base_dir}/agents/{name}/agent.json`."""
        return self.agent_dir(name) / "agent.json"

    def agent_heartbeat_file(self, name: str) -> Path:
        """Per-agent heartbeat file: `{base_dir}/agents/{name}/heartbeat.json`."""
        return self.agent_dir(name) / "heartbeat.json"

    def agent_evolution_file(self, name: str) -> Path:
        """Per-agent evolution file: `{base_dir}/agents/{name}/evolution.json`."""
        return self.agent_dir(name) / "evolution.json"

    def thread_dir(self, thread_id: str) -> Path:
        """
        Host path for a thread's data: `{base_dir}/threads/{thread_id}/`

        This directory contains a `user-data/` subdirectory that is mounted
        as `/mnt/user-data/` inside the sandbox.

        Raises:
            ValueError: If `thread_id` contains unsafe characters (path separators
                        or `..`) that could cause directory traversal.
        """
        if not _SAFE_THREAD_ID_RE.match(thread_id):
            raise ValueError(f"Invalid thread_id {thread_id!r}: only alphanumeric characters, hyphens, and underscores are allowed.")
        return self.base_dir / "threads" / thread_id

    def sandbox_work_dir(self, thread_id: str) -> Path:
        """
        Host path for the agent's workspace directory.
        Host: `{base_dir}/threads/{thread_id}/user-data/workspace/`
        Sandbox: `/mnt/user-data/workspace/`
        """
        return self.thread_dir(thread_id) / "user-data" / "workspace"

    def sandbox_uploads_dir(self, thread_id: str) -> Path:
        """
        Host path for user-uploaded files.
        Host: `{base_dir}/threads/{thread_id}/user-data/uploads/`
        Sandbox: `/mnt/user-data/uploads/`
        """
        return self.thread_dir(thread_id) / "user-data" / "uploads"

    def sandbox_outputs_dir(self, thread_id: str) -> Path:
        """
        Host path for agent-generated artifacts.
        Host: `{base_dir}/threads/{thread_id}/user-data/outputs/`
        Sandbox: `/mnt/user-data/outputs/`
        """
        return self.thread_dir(thread_id) / "user-data" / "outputs"

    def sandbox_user_data_dir(self, thread_id: str) -> Path:
        """
        Host path for the user-data root.
        Host: `{base_dir}/threads/{thread_id}/user-data/`
        Sandbox: `/mnt/user-data/`
        """
        return self.thread_dir(thread_id) / "user-data"

    @property
    def retrieval_models_dir(self) -> Path:
        """Root directory for retrieval models (embedding + rerank models): `{base_dir}/retrieval_models/`."""
        return self.base_dir / "retrieval_models"

    @property
    def openviking_root(self) -> Path:
        """Root directory for OpenViking scopes: `{base_dir}/openviking/`."""
        return self.base_dir / "openviking"

    def openviking_scope_dir(self, agent_name: str | None = None) -> Path:
        """Scope directory for OpenViking data."""
        if agent_name:
            scope_name = f"agent-{agent_name.lower()}"
        else:
            scope_name = "global"
        return self.openviking_root / scope_name

    @property
    def openviking_index_db(self) -> Path:
        """SQLite database for OpenViking local ledger/index metadata."""
        return self.openviking_root / "memory_index.db"

    def openviking_data_dir(self, agent_name: str | None = None) -> Path:
        """OpenViking data directory for a scope."""
        return self.openviking_scope_dir(agent_name) / "data"

    def openviking_config_file(self, agent_name: str | None = None) -> Path:
        """OpenViking config file for a scope."""
        return self.openviking_scope_dir(agent_name) / "ov.conf"

    @property
    def security_dir(self) -> Path:
        """Root directory for security policy state: `{base_dir}/security/`."""
        return self.base_dir / "security"

    def ensure_thread_dirs(self, thread_id: str) -> None:
        """Create all standard sandbox directories for a thread."""
        self.sandbox_work_dir(thread_id).mkdir(parents=True, exist_ok=True)
        self.sandbox_uploads_dir(thread_id).mkdir(parents=True, exist_ok=True)
        self.sandbox_outputs_dir(thread_id).mkdir(parents=True, exist_ok=True)

    # ── CLI toolchain (global, non-thread) ───────────────────────────────

    @property
    def clis_root_dir(self) -> Path:
        """Root directory for managed CLIs: `{base_dir}/clis/`."""
        return self.base_dir / "clis"

    @property
    def clis_store_dir(self) -> Path:
        """Managed CLI store directory: `{base_dir}/clis/store/`."""
        return self.clis_root_dir / "store"

    @property
    def clis_bin_dir(self) -> Path:
        """Managed CLI bin directory (shims): `{base_dir}/clis/bin/`."""
        return self.clis_root_dir / "bin"

    @property
    def clis_manifests_dir(self) -> Path:
        """Managed CLI manifests directory: `{base_dir}/clis/manifests/`."""
        return self.clis_root_dir / "manifests"

    def resolve_virtual_path(self, thread_id: str, virtual_path: str) -> Path:
        """Resolve a sandbox virtual path to the actual host filesystem path.

        Args:
            thread_id: The thread ID.
            virtual_path: Virtual path as seen inside the sandbox, e.g.
                          ``/mnt/user-data/outputs/report.pdf``.
                          Leading slashes are stripped before matching.

        Returns:
            The resolved absolute host filesystem path.

        Raises:
            ValueError: If the path does not start with the expected virtual
                        prefix or a path-traversal attempt is detected.
        """
        stripped = virtual_path.lstrip("/")
        prefix = VIRTUAL_PATH_PREFIX.lstrip("/")

        # Require an exact segment-boundary match to avoid prefix confusion
        # (e.g. reject paths like "mnt/user-dataX/...").
        if stripped != prefix and not stripped.startswith(prefix + "/"):
            raise ValueError(f"Path must start with /{prefix}")

        relative = stripped[len(prefix) :].lstrip("/")
        base = self.sandbox_user_data_dir(thread_id).resolve()
        actual = (base / relative).resolve()

        try:
            actual.relative_to(base)
        except ValueError:
            raise ValueError("Access denied: path traversal detected")

        return actual


# ── Singleton ────────────────────────────────────────────────────────────

_paths: Paths | None = None


def get_paths() -> Paths:
    """Return the global Paths singleton (lazy-initialized)."""
    global _paths
    if _paths is None:
        _paths = Paths()
    return _paths


def resolve_path(path: str) -> Path:
    """Resolve *path* to an absolute ``Path``.

    Relative paths are resolved relative to the application base directory.
    Absolute paths are returned as-is (after normalisation).
    """
    p = Path(path)
    if not p.is_absolute():
        p = get_paths().base_dir / path
    return p.resolve()
