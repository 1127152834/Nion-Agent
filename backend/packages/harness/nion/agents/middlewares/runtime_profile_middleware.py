import os
from typing import Literal, NotRequired, override

from langgraph.runtime import Runtime

from src.agents.memory.policy import resolve_memory_policy
from src.agents.middlewares.langchain_compat import AgentMiddleware, AgentState
from src.config.app_config import ensure_latest_app_config
from src.runtime_profile import RuntimeProfileRepository, RuntimeProfileValidationError


class RuntimeProfileMiddlewareState(AgentState):
    execution_mode: NotRequired[str | None]
    host_workdir: NotRequired[str | None]
    runtime_profile_locked: NotRequired[bool]
    session_mode: NotRequired[str | None]
    memory_read: NotRequired[bool | None]
    memory_write: NotRequired[bool | None]


class RuntimeProfileMiddleware(AgentMiddleware[RuntimeProfileMiddlewareState]):
    """Load and lock thread runtime profile before execution."""

    state_schema = RuntimeProfileMiddlewareState

    def __init__(self):
        super().__init__()
        self._repository = RuntimeProfileRepository()

    @staticmethod
    def _parse_requested_mode(value: object) -> Literal["sandbox", "host"] | None:
        if not isinstance(value, str):
            return None
        normalized = value.strip().lower()
        if normalized == "host":
            return "host"
        if normalized == "sandbox":
            return "sandbox"
        return None

    @staticmethod
    def _normalize_workdir(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = value.strip()
        return normalized or None

    @staticmethod
    def _is_desktop_runtime() -> bool:
        return os.getenv("NION_DESKTOP_RUNTIME", "0") == "1"

    @staticmethod
    def _has_memory_session_inputs(
        state: RuntimeProfileMiddlewareState,
        runtime: Runtime,
    ) -> bool:
        fields = ("session_mode", "memory_read", "memory_write")
        for field_name in fields:
            if state.get(field_name) is not None:
                return True
            if runtime.context.get(field_name) is not None:
                return True
        return False

    def _get_requested_profile(
        self,
        state: RuntimeProfileMiddlewareState,
        runtime: Runtime,
    ) -> tuple[Literal["sandbox", "host"] | None, str | None]:
        requested_mode = self._parse_requested_mode(state.get("execution_mode"))
        requested_workdir = self._normalize_workdir(state.get("host_workdir"))

        # New threads send the initial runtime profile via runtime.context before
        # state is persisted. Fall back to that source for the first run.
        if requested_mode is None:
            requested_mode = self._parse_requested_mode(runtime.context.get("execution_mode"))
        if requested_workdir is None:
            requested_workdir = self._normalize_workdir(runtime.context.get("host_workdir"))

        return requested_mode, requested_workdir

    @override
    def before_agent(self, state: RuntimeProfileMiddlewareState, runtime: Runtime) -> dict | None:
        thread_id = runtime.context.get("thread_id")
        if not thread_id:
            return None

        app_config = ensure_latest_app_config(process_name="langgraph")
        strict_mode = bool(getattr(app_config.sandbox, "strict_mode", False))

        profile = self._repository.read(thread_id)
        requested_mode, requested_workdir = self._get_requested_profile(state, runtime)

        # Strict sandbox mode: always run in sandbox mode, ignore requested host mode.
        if strict_mode:
            if not profile["locked"] and profile["execution_mode"] != "sandbox":
                # Best-effort: ensure first-run profile is locked in sandbox mode
                # to match the effective runtime behavior under strict mode.
                try:
                    profile = self._repository.update(
                        thread_id,
                        execution_mode="sandbox",
                        host_workdir=None,
                    )
                except RuntimeProfileValidationError as exc:
                    raise ValueError(str(exc)) from exc

            if not profile["locked"]:
                profile = self._repository.lock(thread_id)

            result = {
                "execution_mode": "sandbox",
                "host_workdir": None,
                "runtime_profile_locked": profile["locked"],
            }
            if self._has_memory_session_inputs(state, runtime):
                policy = resolve_memory_policy(state=state, runtime_context=runtime.context)
                result.update(
                    {
                        "session_mode": policy.session_mode,
                        "memory_read": policy.allow_read,
                        "memory_write": policy.allow_write,
                    }
                )
            return result

        # Support first-run profile bootstrap for brand new threads.
        if not profile["locked"]:
            next_mode = profile["execution_mode"]
            next_workdir = profile["host_workdir"]

            if requested_mode is not None:
                if requested_mode == "host":
                    if not self._is_desktop_runtime():
                        raise ValueError("Host mode is only available in desktop runtime")
                    next_mode = "host"
                    next_workdir = requested_workdir
                elif requested_mode == "sandbox":
                    next_mode = "sandbox"
                    next_workdir = None

            if next_mode == "host" and not self._is_desktop_runtime():
                raise ValueError("Host mode is only available in desktop runtime")

            if next_mode != profile["execution_mode"] or next_workdir != profile["host_workdir"]:
                try:
                    profile = self._repository.update(
                        thread_id,
                        execution_mode=next_mode,
                        host_workdir=next_workdir,
                    )
                except RuntimeProfileValidationError as exc:
                    raise ValueError(str(exc)) from exc

            profile = self._repository.lock(thread_id)
        elif profile["execution_mode"] == "host" and not self._is_desktop_runtime():
            raise ValueError("Host mode is only available in desktop runtime")

        result = {
            "execution_mode": profile["execution_mode"],
            "host_workdir": profile["host_workdir"],
            "runtime_profile_locked": profile["locked"],
        }
        if self._has_memory_session_inputs(state, runtime):
            policy = resolve_memory_policy(state=state, runtime_context=runtime.context)
            result.update(
                {
                    "session_mode": policy.session_mode,
                    "memory_read": policy.allow_read,
                    "memory_write": policy.allow_write,
                }
            )

        return result
