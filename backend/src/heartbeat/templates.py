"""Default Heartbeat templates."""

from src.heartbeat.models import HeartbeatCategory, HeartbeatResultType, HeartbeatTemplate

DEFAULT_TEMPLATES = {
    "daily_review": HeartbeatTemplate(
        template_id="daily_review",
        name="每日回顾",
        description="总结今天、整理待办、更新 top-of-mind",
        category=HeartbeatCategory.REVIEW,
        default_enabled=True,
        default_cron="0 21 * * *",
        default_timezone="Asia/Shanghai",
        result_type=HeartbeatResultType.SUMMARY,
        memory_scope="read_write",
        soul_scope="read",
        estimated_duration_seconds=120,
    ),
    "weekly_reset": HeartbeatTemplate(
        template_id="weekly_reset",
        name="每周整理",
        description="回顾本周项目、整理长期目标、提示下周重点",
        category=HeartbeatCategory.REVIEW,
        default_enabled=True,
        default_cron="0 19 * * 0",
        default_timezone="Asia/Shanghai",
        result_type=HeartbeatResultType.SUMMARY,
        memory_scope="read_write",
        soul_scope="read",
        estimated_duration_seconds=300,
    ),
    "memory_maintenance": HeartbeatTemplate(
        template_id="memory_maintenance",
        name="记忆维护",
        description="复用 Memory Core 的 usage / compact / rebuild",
        category=HeartbeatCategory.MAINTENANCE,
        default_enabled=True,
        default_cron="0 2 * * 1",
        default_timezone="UTC",
        result_type=HeartbeatResultType.MAINTENANCE_REPORT,
        memory_scope="read_write",
        soul_scope="none",
        estimated_duration_seconds=180,
    ),
    "memory_governance": HeartbeatTemplate(
        template_id="memory_governance",
        name="记忆治理",
        description="处理上卷候选、冲突状态与共享目录刷新",
        category=HeartbeatCategory.MAINTENANCE,
        default_enabled=True,
        default_cron="0 */6 * * *",
        default_timezone="UTC",
        result_type=HeartbeatResultType.MAINTENANCE_REPORT,
        memory_scope="read_write",
        soul_scope="read",
        estimated_duration_seconds=120,
    ),
    "identity_check": HeartbeatTemplate(
        template_id="identity_check",
        name="身份检查",
        description="读取 Soul Core，产出身份/风格/边界建议摘要",
        category=HeartbeatCategory.CHECK,
        default_enabled=True,
        default_cron="0 10 1 * *",
        default_timezone="Asia/Shanghai",
        result_type=HeartbeatResultType.SUGGESTION,
        memory_scope="read",
        soul_scope="read",
        estimated_duration_seconds=240,
    ),
}


def get_default_templates() -> dict[str, HeartbeatTemplate]:
    """Get all default templates."""
    return DEFAULT_TEMPLATES.copy()


def get_template(template_id: str) -> HeartbeatTemplate | None:
    """Get specific template."""
    return DEFAULT_TEMPLATES.get(template_id)
