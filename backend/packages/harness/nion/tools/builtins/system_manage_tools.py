"""Chat tools for system management (skills, MCP, models)."""

from __future__ import annotations

import asyncio
import json
import threading
from typing import Literal

from langgraph.typing import ContextT

from nion.agents.thread_state import ThreadState
from nion.config import get_app_config
from nion.config.config_repository import ConfigRepository
from nion.config.extensions_config import get_extensions_config
from nion.skills import load_skills
from nion.tools.builtins._service_ops import (
    McpConfigUpdateRequest,
    McpServerConfigResponse,
    ModelConnectionTestRequest,
    SkillInstallRequest,
    SkillUpdateRequest,
    get_mcp_configuration,
    install_skill,
    test_model_connection,
    update_mcp_configuration,
    update_skill,
)
from nion.tools.builtins.confirmation_store import consume_confirmation_token, issue_confirmation_token
from nion.tools.builtins.langchain_compat import ToolRuntime, tool
from nion.tools.builtins.management_response import build_action_card, build_management_response


def _run_async(coro):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    result: dict[str, object] = {}

    def runner() -> None:
        try:
            result["value"] = asyncio.run(coro)
        except Exception as exc:  # noqa: BLE001
            result["error"] = exc

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    thread.join()

    if "error" in result:
        raise result["error"]  # type: ignore[misc]
    return result.get("value")


def _runtime_thread_id(runtime: ToolRuntime[ContextT, ThreadState] | None) -> str | None:
    if runtime is None:
        return None
    context = runtime.context or {}
    if isinstance(context, dict):
        thread_id = context.get("thread_id")
        if isinstance(thread_id, str) and thread_id.strip():
            return thread_id.strip()
    return None


def _nion_manage_usage() -> str:
    # Keep this as plain text because it is shown to both Agent and UI.
    return (
        "Usage:\n"
        "  nion_manage help\n"
        "  nion_manage doctor [--tail N] [--include-logs] [--include-processlog]\n"
        "  nion_manage skills <subcommand> [...]\n"
        "\n"
        "Commands:\n"
        "  help\n"
        "    Show this message.\n"
        "  doctor\n"
        "    Collect runtime diagnostics for troubleshooting (Task 3).\n"
        "  skills\n"
        "    Manage skills (list/enable/disable/install/rename).\n"
        "\n"
        "Notes:\n"
        "  - This is an agent-facing control-plane tool (CLI-shaped) and returns JSON.\n"
        "  - Destructive operations may require a confirmation token.\n"
    )


@tool("nion_manage")
def nion_manage_tool(
    runtime: ToolRuntime[ContextT, ThreadState] | None = None,
    argv: list[str] | None = None,
    confirmation_token: str | None = None,
    thread_id: str | None = None,
) -> str:
    """Agent-only control-plane tool (CLI-shaped) that routes argv-style commands."""
    # Normalize argv: ensure we only deal with non-empty tokens.
    normalized_argv = [str(item).strip() for item in (argv or []) if str(item).strip()]
    if not normalized_argv or normalized_argv[0] in {"help", "-h", "--help"}:
        return build_management_response(
            success=True,
            message=_nion_manage_usage(),
            data={"argv": normalized_argv},
        )

    command = normalized_argv[0]
    if command == "doctor":
        # Task 3 will implement this. Keep a stable placeholder to avoid accidental silent failures.
        return build_management_response(
            success=False,
            message="doctor 暂未实现（等待 Task 3）。",
            data={"argv": normalized_argv},
        )

    if command == "skills":
        # Task 4 will implement argv routing for skills (including custom-skill rename).
        return build_management_response(
            success=False,
            message="skills 子命令暂未实现（等待后续任务）。",
            data={"argv": normalized_argv},
        )

    _ = runtime, confirmation_token, thread_id  # explicitly reserved for future subcommands
    return build_management_response(
        success=False,
        message=f"未知命令：{command}。运行 nion_manage help 查看用法。",
        data={"argv": normalized_argv},
    )


@tool("skills_manage")
def skills_manage_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    action: Literal["list", "set_enabled", "install"],
    skill_name: str | None = None,
    enabled: bool | None = None,
    skill_package_path: str | None = None,
    thread_id: str | None = None,
    confirmation_token: str | None = None,
) -> str:
    """Manage skills from chat (list, enable/disable, install)."""
    if action == "list":
        skills = load_skills(enabled_only=False)
        return build_management_response(
            success=True,
            message=f"共 {len(skills)} 个技能。",
            data={
                "skills": [
                    {
                        "name": item.name,
                        "description": item.description,
                        "enabled": item.enabled,
                        "category": item.category,
                    }
                    for item in skills
                ]
            },
        )

    if action == "set_enabled":
        if not skill_name or enabled is None:
            return build_management_response(
                success=False,
                message="set_enabled 需要 skill_name 和 enabled 参数。",
            )

        if not enabled and not confirmation_token:
            token = issue_confirmation_token(action="disable", target=f"skills:{skill_name}:disable")
            return build_management_response(
                success=False,
                message=f"禁用技能 {skill_name} 需要二次确认。",
                data={"skill_name": skill_name, "enabled": enabled},
                requires_confirmation=True,
                confirmation_token=token,
                ui_card=build_action_card(
                    title="需要二次确认",
                    description=f"禁用技能 {skill_name} 可能影响对话能力。",
                    status="warning",
                ),
            )

        if not enabled and confirmation_token:
            ok, reason = consume_confirmation_token(
                token=confirmation_token,
                action="disable",
                target=f"skills:{skill_name}:disable",
            )
            if not ok:
                return build_management_response(
                    success=False,
                    message=reason,
                    data={"skill_name": skill_name},
                )

        try:
            updated = _run_async(update_skill(skill_name, SkillUpdateRequest(enabled=enabled)))
        except Exception as exc:  # noqa: BLE001
            return build_management_response(success=False, message=f"更新技能失败：{exc}")
        return build_management_response(
            success=True,
            message=f"技能 {updated.name} 已{'启用' if updated.enabled else '禁用'}。",
            data={"skill_name": updated.name, "enabled": updated.enabled},
        )

    if action == "install":
        resolved_thread_id = thread_id or _runtime_thread_id(runtime)
        if not resolved_thread_id or not skill_package_path:
            return build_management_response(
                success=False,
                message="install 需要 skill_package_path，且必须有 thread_id 上下文。",
            )

        try:
            result = _run_async(
                install_skill(
                    SkillInstallRequest(
                        thread_id=resolved_thread_id,
                        path=skill_package_path,
                    )
                )
            )
        except Exception as exc:  # noqa: BLE001
            return build_management_response(success=False, message=f"安装技能失败：{exc}")

        return build_management_response(
            success=result.success,
            message=result.message,
            data={"skill_name": result.skill_name},
            ui_card=build_action_card(
                title="技能安装完成",
                description=result.message,
                status="success" if result.success else "error",
            ),
        )

    return build_management_response(success=False, message=f"未知 action：{action}")


@tool("mcp_manage")
def mcp_manage_tool(
    action: Literal["list", "upsert", "set_enabled", "delete"],
    server_name: str | None = None,
    server_config_json: str | None = None,
    enabled: bool | None = None,
    confirmation_token: str | None = None,
) -> str:
    """Manage MCP server settings from chat."""
    if action == "list":
        config = _run_async(get_mcp_configuration())
        return build_management_response(
            success=True,
            message=f"共 {len(config.mcp_servers)} 个 MCP 服务。",
            data={"mcp_servers": {name: item.model_dump() for name, item in config.mcp_servers.items()}},
        )

    if not server_name:
        return build_management_response(success=False, message="该操作需要 server_name。")

    extensions = get_extensions_config()
    existing = server_name in extensions.mcp_servers

    if action == "upsert":
        if not server_config_json:
            return build_management_response(success=False, message="upsert 需要 server_config_json。")

        if existing and not confirmation_token:
            token = issue_confirmation_token(action="overwrite", target=f"mcp:{server_name}:overwrite")
            return build_management_response(
                success=False,
                message=f"覆盖 MCP 服务 {server_name} 需要二次确认。",
                data={"server_name": server_name, "operation": "upsert"},
                requires_confirmation=True,
                confirmation_token=token,
                ui_card=build_action_card(
                    title="需要二次确认",
                    description=f"MCP 服务 {server_name} 已存在，确认覆盖配置。",
                    status="warning",
                ),
            )

        if existing and confirmation_token:
            ok, reason = consume_confirmation_token(
                token=confirmation_token,
                action="overwrite",
                target=f"mcp:{server_name}:overwrite",
            )
            if not ok:
                return build_management_response(success=False, message=reason, data={"server_name": server_name})

        try:
            parsed = json.loads(server_config_json)
            server_cfg = McpServerConfigResponse.model_validate(parsed)
        except Exception as exc:  # noqa: BLE001
            return build_management_response(success=False, message=f"server_config_json 无效：{exc}")

        servers = {name: McpServerConfigResponse(**item.model_dump()) for name, item in extensions.mcp_servers.items()}
        servers[server_name] = server_cfg
        updated = _run_async(update_mcp_configuration(McpConfigUpdateRequest(mcp_servers=servers)))
        return build_management_response(
            success=True,
            message=f"MCP 服务 {server_name} 已保存。",
            data={"server_name": server_name, "mcp_servers": {name: item.model_dump() for name, item in updated.mcp_servers.items()}},
        )

    if action == "set_enabled":
        if enabled is None:
            return build_management_response(success=False, message="set_enabled 需要 enabled。")
        if not enabled and not confirmation_token:
            token = issue_confirmation_token(action="disable", target=f"mcp:{server_name}:disable")
            return build_management_response(
                success=False,
                message=f"禁用 MCP 服务 {server_name} 需要二次确认。",
                data={"server_name": server_name, "enabled": enabled},
                requires_confirmation=True,
                confirmation_token=token,
            )
        if not enabled and confirmation_token:
            ok, reason = consume_confirmation_token(
                token=confirmation_token,
                action="disable",
                target=f"mcp:{server_name}:disable",
            )
            if not ok:
                return build_management_response(success=False, message=reason, data={"server_name": server_name})

        if not existing:
            return build_management_response(success=False, message=f"MCP 服务不存在：{server_name}")

        servers = {name: McpServerConfigResponse(**item.model_dump()) for name, item in extensions.mcp_servers.items()}
        current = servers[server_name]
        servers[server_name] = current.model_copy(update={"enabled": enabled})
        _run_async(update_mcp_configuration(McpConfigUpdateRequest(mcp_servers=servers)))
        return build_management_response(
            success=True,
            message=f"MCP 服务 {server_name} 已{'启用' if enabled else '禁用'}。",
            data={"server_name": server_name, "enabled": enabled},
        )

    if action == "delete":
        if not confirmation_token:
            token = issue_confirmation_token(action="delete", target=f"mcp:{server_name}:delete")
            return build_management_response(
                success=False,
                message=f"删除 MCP 服务 {server_name} 需要二次确认。",
                data={"server_name": server_name},
                requires_confirmation=True,
                confirmation_token=token,
            )
        ok, reason = consume_confirmation_token(
            token=confirmation_token,
            action="delete",
            target=f"mcp:{server_name}:delete",
        )
        if not ok:
            return build_management_response(success=False, message=reason, data={"server_name": server_name})

        if not existing:
            return build_management_response(success=False, message=f"MCP 服务不存在：{server_name}")

        servers = {name: McpServerConfigResponse(**item.model_dump()) for name, item in extensions.mcp_servers.items()}
        servers.pop(server_name, None)
        _run_async(update_mcp_configuration(McpConfigUpdateRequest(mcp_servers=servers)))
        return build_management_response(
            success=True,
            message=f"MCP 服务 {server_name} 已删除。",
            data={"server_name": server_name},
        )

    return build_management_response(success=False, message=f"未知 action：{action}")


@tool("models_manage")
def models_manage_tool(
    action: Literal["list", "test_connection", "upsert", "delete"],
    model_name: str | None = None,
    model_config_json: str | None = None,
    test_request_json: str | None = None,
    confirmation_token: str | None = None,
) -> str:
    """Manage model settings from chat."""
    if action == "list":
        config = get_app_config()
        return build_management_response(
            success=True,
            message=f"共 {len(config.models)} 个模型。",
            data={
                "models": [
                    {
                        "name": model.name,
                        "display_name": model.display_name,
                        "model": model.model,
                        "use": model.use,
                        "supports_thinking": model.supports_thinking,
                        "supports_vision": model.supports_vision,
                    }
                    for model in config.models
                ]
            },
        )

    if action == "test_connection":
        if not test_request_json:
            return build_management_response(success=False, message="test_connection 需要 test_request_json。")
        try:
            req = ModelConnectionTestRequest.model_validate(json.loads(test_request_json))
            resp = _run_async(test_model_connection(req))
        except Exception as exc:  # noqa: BLE001
            return build_management_response(success=False, message=f"连接测试失败：{exc}")
        return build_management_response(
            success=resp.success,
            message=resp.message,
            data={
                "latency_ms": resp.latency_ms,
                "response_preview": resp.response_preview,
            },
        )

    repo = ConfigRepository()
    config_dict, version, _ = repo.read()
    models = config_dict.get("models")
    if not isinstance(models, list):
        return build_management_response(success=False, message="当前配置缺少 models 列表。")

    if action == "upsert":
        if not model_config_json:
            return build_management_response(success=False, message="upsert 需要 model_config_json。")
        try:
            payload = json.loads(model_config_json)
        except Exception as exc:  # noqa: BLE001
            return build_management_response(success=False, message=f"model_config_json 无效：{exc}")

        target_name = str(payload.get("name") or model_name or "").strip()
        if not target_name:
            return build_management_response(success=False, message="model_config_json 必须包含 name。")
        if "use" not in payload or "model" not in payload:
            return build_management_response(success=False, message="model_config_json 必须包含 use 和 model。")

        existing_index = next((i for i, item in enumerate(models) if isinstance(item, dict) and item.get("name") == target_name), None)
        if existing_index is not None and not confirmation_token:
            token = issue_confirmation_token(action="overwrite", target=f"models:{target_name}:overwrite")
            return build_management_response(
                success=False,
                message=f"覆盖模型 {target_name} 需要二次确认。",
                data={"model_name": target_name},
                requires_confirmation=True,
                confirmation_token=token,
            )

        if existing_index is not None and confirmation_token:
            ok, reason = consume_confirmation_token(
                token=confirmation_token,
                action="overwrite",
                target=f"models:{target_name}:overwrite",
            )
            if not ok:
                return build_management_response(success=False, message=reason, data={"model_name": target_name})

        if existing_index is None:
            models.append(payload)
        else:
            models[existing_index] = payload

        config_dict["models"] = models
        try:
            new_version = repo.write(config_dict=config_dict, expected_version=version)
        except Exception as exc:  # noqa: BLE001
            return build_management_response(success=False, message=f"保存模型配置失败：{exc}")

        return build_management_response(
            success=True,
            message=f"模型 {target_name} 已保存。",
            data={"model_name": target_name, "version": new_version},
        )

    if action == "delete":
        if not model_name:
            return build_management_response(success=False, message="delete 需要 model_name。")
        if not confirmation_token:
            token = issue_confirmation_token(action="delete", target=f"models:{model_name}:delete")
            return build_management_response(
                success=False,
                message=f"删除模型 {model_name} 需要二次确认。",
                data={"model_name": model_name},
                requires_confirmation=True,
                confirmation_token=token,
            )
        ok, reason = consume_confirmation_token(
            token=confirmation_token,
            action="delete",
            target=f"models:{model_name}:delete",
        )
        if not ok:
            return build_management_response(success=False, message=reason, data={"model_name": model_name})

        next_models = [item for item in models if not (isinstance(item, dict) and item.get("name") == model_name)]
        if len(next_models) == len(models):
            return build_management_response(success=False, message=f"模型不存在：{model_name}")

        config_dict["models"] = next_models
        try:
            new_version = repo.write(config_dict=config_dict, expected_version=version)
        except Exception as exc:  # noqa: BLE001
            return build_management_response(success=False, message=f"删除模型失败：{exc}")
        return build_management_response(
            success=True,
            message=f"模型 {model_name} 已删除。",
            data={"model_name": model_name, "version": new_version},
        )

    return build_management_response(success=False, message=f"未知 action：{action}")
