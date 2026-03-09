"""Thread-scoped runtime profile repository.

Stores per-thread execution profile in JSON files:
  {base_dir}/threads/{thread_id}/runtime_profile.json
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, TypedDict

from src.config.paths import VIRTUAL_PATH_PREFIX, get_paths

ExecutionMode = Literal["sandbox", "host"]

_IGNORABLE_EMPTY_DIR_FILENAMES = {
    ".DS_Store",
    ".localized",
    ".gitkeep",
    ".keep",
    "Thumbs.db",
    "desktop.ini",
    "Icon\r",
}


class RuntimeProfile(TypedDict):
    execution_mode: ExecutionMode
    host_workdir: str | None
    locked: bool
    updated_at: str


class RuntimeProfileError(Exception):
    """Base runtime profile error."""


class RuntimeProfileValidationError(RuntimeProfileError):
    """Raised when profile input is invalid."""


class RuntimeProfileLockedError(RuntimeProfileError):
    """Raised when attempting to modify a locked profile."""


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _normalize_mode(value: str | None) -> ExecutionMode:
    if value == "host":
        return "host"
    return "sandbox"


def _normalize_host_workdir(value: str | None) -> str | None:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    return str(Path(raw).expanduser().resolve())


def _default_profile() -> RuntimeProfile:
    return RuntimeProfile(
        execution_mode="sandbox",
        host_workdir=None,
        locked=False,
        updated_at=_now_iso(),
    )


class RuntimeProfileRepository:
    def __init__(self):
        self._paths = get_paths()

    def _profile_path(self, thread_id: str) -> Path:
        return self._paths.thread_dir(thread_id) / "runtime_profile.json"

    @staticmethod
    def _coerce_profile(raw: dict[str, Any]) -> RuntimeProfile:
        mode = _normalize_mode(raw.get("execution_mode"))  # type: ignore[arg-type]
        host_workdir = _normalize_host_workdir(raw.get("host_workdir"))  # type: ignore[arg-type]
        locked = bool(raw.get("locked", False))
        updated_at = str(raw.get("updated_at") or _now_iso())
        return RuntimeProfile(
            execution_mode=mode,
            host_workdir=host_workdir,
            locked=locked,
            updated_at=updated_at,
        )

    def read(self, thread_id: str) -> RuntimeProfile:
        path = self._profile_path(thread_id)
        if not path.exists():
            return _default_profile()

        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return _default_profile()

        if not isinstance(payload, dict):
            return _default_profile()
        return self._coerce_profile(payload)

    def write(self, thread_id: str, profile: RuntimeProfile) -> RuntimeProfile:
        path = self._profile_path(thread_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(profile, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return profile

    @staticmethod
    def _is_ignorable_empty_dir_entry(entry: Path) -> bool:
        name = entry.name
        if name.startswith("._"):
            return entry.is_file()
        if name in _IGNORABLE_EMPTY_DIR_FILENAMES:
            return entry.is_file()
        # Ignore hidden metadata files created by desktop OS integrations.
        if name.startswith(".") and entry.is_file():
            return True
        return False

    @classmethod
    def _first_user_content_entry(cls, path: Path) -> str | None:
        for entry in path.iterdir():
            if cls._is_ignorable_empty_dir_entry(entry):
                continue
            return entry.name
        return None

    @staticmethod
    def validate_host_workdir(path_value: str | None) -> str:
        normalized = _normalize_host_workdir(path_value)
        if normalized is None:
            raise RuntimeProfileValidationError("host_workdir is required when execution_mode is host")

        path = Path(normalized)
        if not path.is_absolute():
            raise RuntimeProfileValidationError("host_workdir must be an absolute path")
        if not path.exists():
            raise RuntimeProfileValidationError(f"host_workdir does not exist: {normalized}")
        if not path.is_dir():
            raise RuntimeProfileValidationError(f"host_workdir is not a directory: {normalized}")
        if not os.access(path, os.W_OK):
            raise RuntimeProfileValidationError(f"host_workdir is not writable: {normalized}")

        try:
            first_content = RuntimeProfileRepository._first_user_content_entry(path)
            if first_content is not None:
                raise RuntimeProfileValidationError(
                    f"host_workdir must be an empty directory (found: {first_content})",
                )
        except OSError as exc:
            raise RuntimeProfileValidationError(f"host_workdir cannot be read: {normalized}") from exc

        return normalized

    def update(
        self,
        thread_id: str,
        *,
        execution_mode: ExecutionMode,
        host_workdir: str | None,
    ) -> RuntimeProfile:
        existing = self.read(thread_id)
        next_mode = _normalize_mode(execution_mode)
        next_workdir = _normalize_host_workdir(host_workdir)
        existing_workdir = _normalize_host_workdir(existing["host_workdir"])

        # A thread is permanently bound to its first selected host directory.
        if existing_workdir is not None:
            if next_mode == "host":
                if next_workdir is None:
                    next_workdir = existing_workdir
                elif next_workdir != existing_workdir:
                    raise RuntimeProfileValidationError("host_workdir is already bound to this thread")
            else:
                next_workdir = existing_workdir

        if next_mode == "host":
            next_workdir = self.validate_host_workdir(next_workdir)
        else:
            next_workdir = existing_workdir

        if existing["locked"] and (
            existing["execution_mode"] != next_mode
            or _normalize_host_workdir(existing["host_workdir"]) != next_workdir
        ):
            raise RuntimeProfileLockedError("Runtime profile is locked after first run")

        next_profile = RuntimeProfile(
            execution_mode=next_mode,
            host_workdir=next_workdir,
            locked=existing["locked"],
            updated_at=_now_iso(),
        )
        return self.write(thread_id, next_profile)

    def lock(self, thread_id: str) -> RuntimeProfile:
        profile = self.read(thread_id)
        if profile["locked"]:
            return profile
        profile["locked"] = True
        profile["updated_at"] = _now_iso()
        return self.write(thread_id, profile)

    @staticmethod
    def resolve_host_virtual_path(virtual_path: str, host_workdir: str) -> Path:
        stripped = virtual_path.lstrip("/")
        prefix = VIRTUAL_PATH_PREFIX.lstrip("/")
        if stripped != prefix and not stripped.startswith(prefix + "/"):
            raise RuntimeProfileValidationError(f"Path must start with /{prefix}")

        relative = stripped[len(prefix) :].lstrip("/")
        if relative:
            parts = relative.split("/", 1)
            if parts[0] in {"workspace", "uploads", "outputs"}:
                relative = parts[1] if len(parts) > 1 else ""

        root = Path(host_workdir).resolve()
        target = (root / relative).resolve() if relative else root

        try:
            target.relative_to(root)
        except ValueError as exc:
            raise RuntimeProfileValidationError("Access denied: path traversal detected") from exc

        return target
