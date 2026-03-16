"""Security audit checks for sandbox and host-mode policy configuration."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from src.config.app_config import AppConfig, get_app_config

Severity = Literal["info", "low", "medium", "high"]

_SEVERITY_WEIGHT: dict[Severity, int] = {
    "info": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
}


def severity_at_least(current: Severity, threshold: Severity) -> bool:
    """Return True when ``current`` severity is equal or higher than ``threshold``."""
    if current not in _SEVERITY_WEIGHT:
        raise ValueError(f"Unknown severity: {current}")
    if threshold not in _SEVERITY_WEIGHT:
        raise ValueError(f"Unknown severity threshold: {threshold}")
    return _SEVERITY_WEIGHT[current] >= _SEVERITY_WEIGHT[threshold]


_RISKY_HOST_PATH_PREFIXES = [
    "/",
    "/Users",
    "/home",
    "/private",
    "C:\\",
]


@dataclass(slots=True)
class AuditFinding:
    code: str
    severity: Severity
    title: str
    detail: str
    recommendation: str


@dataclass(slots=True)
class AuditReport:
    generated_at: str
    findings: list[AuditFinding]

    @property
    def counts(self) -> dict[str, int]:
        result: dict[str, int] = {"info": 0, "low": 0, "medium": 0, "high": 0}
        for finding in self.findings:
            result[finding.severity] += 1
        return result

    @property
    def highest_severity(self) -> Severity:
        if not self.findings:
            return "info"
        return max(self.findings, key=lambda item: _SEVERITY_WEIGHT[item.severity]).severity

    def as_dict(self) -> dict[str, Any]:
        return {
            "generated_at": self.generated_at,
            "counts": self.counts,
            "highest_severity": self.highest_severity,
            "findings": [asdict(finding) for finding in self.findings],
        }


def _normalize_host_path(path: str) -> str:
    if path == "":
        return ""
    return str(Path(path).expanduser().resolve(strict=False))


def _is_risky_host_mount_path(host_path: str) -> bool:
    normalized = _normalize_host_path(host_path)
    for prefix in _RISKY_HOST_PATH_PREFIXES:
        if normalized == prefix or normalized.startswith(prefix.rstrip("/\\") + "/"):
            return True
        if normalized.lower().startswith(prefix.lower()):
            return True
    return False


def _audit_sandbox_config(config: AppConfig, findings: list[AuditFinding]) -> None:
    sandbox_use = config.sandbox.use
    if "LocalSandboxProvider" in sandbox_use:
        findings.append(
            AuditFinding(
                code="sandbox.local_runtime",
                severity="medium",
                title="正在使用本地沙箱运行时",
                detail="LocalSandboxProvider 运行在主机进程上下文，不具备容器级隔离。",
                recommendation="生产默认切换到容器隔离沙箱，或严格限制可用工具与路径边界。",
            )
        )

    for mount in config.sandbox.mounts:
        if not mount.read_only and _is_risky_host_mount_path(mount.host_path):
            findings.append(
                AuditFinding(
                    code="sandbox.mount.risky_rw",
                    severity="high",
                    title="检测到高风险可写主机挂载",
                    detail=f"挂载 {mount.host_path} -> {mount.container_path} 为可写，可能导致主机文件被批量修改。",
                    recommendation="将高风险挂载改为只读，或缩小到最小必要目录。",
                )
            )
        elif not mount.read_only:
            findings.append(
                AuditFinding(
                    code="sandbox.mount.writable",
                    severity="medium",
                    title="检测到可写主机挂载",
                    detail=f"挂载 {mount.host_path} -> {mount.container_path} 可写。",
                    recommendation="若非必要改为只读，并增加审批与审计。",
                )
            )


def _audit_tool_config(config: AppConfig, findings: list[AuditFinding]) -> None:
    for tool in config.tools:
        use_value = tool.use.strip()
        if use_value.endswith(":bash_tool"):
            findings.append(
                AuditFinding(
                    code="tools.bash.enabled",
                    severity="medium",
                    title="检测到 bash 工具暴露",
                    detail=f"工具 {tool.name} 使用 {use_value}，具备命令执行能力。",
                    recommendation="默认禁用 bash，仅在开发模式开启，并配合 deny/ask 规则。",
                )
            )


def _audit_host_mode_policy(config: AppConfig, findings: list[AuditFinding]) -> None:
    payload = config.model_dump()
    host_mode = payload.get("host_mode")
    if not isinstance(host_mode, dict):
        findings.append(
            AuditFinding(
                code="host_mode.policy.default",
                severity="low",
                title="主机模式安全策略使用默认值",
                detail="配置中未声明 host_mode，系统将使用内置危险/拒绝规则。",
                recommendation="建议在设置页明确配置危险规则、拒绝规则和受保护路径。",
            )
        )
        return

    dangerous = host_mode.get("dangerous_patterns")
    deny = host_mode.get("deny_patterns")
    protected = host_mode.get("protected_paths")
    ttl = host_mode.get("confirm_ttl_seconds")

    if not isinstance(dangerous, list) or len(dangerous) == 0:
        findings.append(
            AuditFinding(
                code="host_mode.dangerous_patterns.empty",
                severity="medium",
                title="主机模式缺少危险规则",
                detail="dangerous_patterns 为空时，系统无法对高风险命令进行二次确认。",
                recommendation="至少保留 rm -rf、关机重启、磁盘格式化、危险管道等规则。",
            )
        )

    if not isinstance(deny, list) or len(deny) == 0:
        findings.append(
            AuditFinding(
                code="host_mode.deny_patterns.empty",
                severity="high",
                title="主机模式缺少拒绝规则",
                detail="deny_patterns 为空时，极端危险命令无法被硬拒绝。",
                recommendation="建议将全盘删除、磁盘破坏类命令加入拒绝规则。",
            )
        )

    if not isinstance(protected, list) or len(protected) == 0:
        findings.append(
            AuditFinding(
                code="host_mode.protected_paths.empty",
                severity="medium",
                title="主机模式缺少受保护路径",
                detail="protected_paths 为空时，系统目录命中检测范围不足。",
                recommendation="至少加入系统目录（如 /System、/usr、C:\\Windows 等）。",
            )
        )

    try:
        ttl_int = int(ttl)
    except (TypeError, ValueError):
        ttl_int = 300

    if ttl_int <= 0:
        findings.append(
            AuditFinding(
                code="host_mode.confirm_ttl.invalid",
                severity="medium",
                title="确认放行 TTL 配置无效",
                detail=f"confirm_ttl_seconds={ttl!r}，将导致放行窗口不可预测。",
                recommendation="将 confirm_ttl_seconds 设为正整数（例如 300 秒）。",
            )
        )
    elif ttl_int > 3600:
        findings.append(
            AuditFinding(
                code="host_mode.confirm_ttl.too_long",
                severity="low",
                title="确认放行 TTL 过长",
                detail=f"confirm_ttl_seconds={ttl_int}，一次确认可在较长时间内复用。",
                recommendation="建议控制在 300-900 秒，降低误操作风险。",
            )
        )


def run_security_audit(
    *,
    config: AppConfig | None = None,
) -> AuditReport:
    app_config = config or get_app_config(process_name="gateway")
    findings: list[AuditFinding] = []
    _audit_sandbox_config(app_config, findings)
    _audit_tool_config(app_config, findings)
    _audit_host_mode_policy(app_config, findings)

    return AuditReport(
        generated_at=datetime.now(UTC).isoformat(),
        findings=findings,
    )
