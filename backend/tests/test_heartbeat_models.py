"""Test Heartbeat models and templates."""

from app.heartbeat.models import (
    HeartbeatCategory,
    HeartbeatLogRecord,
    HeartbeatResultType,
    HeartbeatSettings,
    HeartbeatTemplate,
    TemplateConfig,
)
from app.heartbeat.templates import get_default_templates, get_template


def test_heartbeat_template_model():
    """Test HeartbeatTemplate model."""
    template = HeartbeatTemplate(
        template_id="test",
        name="Test",
        description="Test template",
        category=HeartbeatCategory.REVIEW,
        default_cron="0 0 * * *",
        result_type=HeartbeatResultType.SUMMARY,
    )
    assert template.template_id == "test"
    assert template.default_enabled is True
    assert template.category == HeartbeatCategory.REVIEW


def test_default_templates():
    """Test default templates."""
    templates = get_default_templates()
    assert len(templates) == 5
    assert "daily_review" in templates
    assert "weekly_reset" in templates
    assert "memory_maintenance" in templates
    assert "memory_governance" in templates
    assert "identity_check" in templates


def test_get_template():
    """Test get_template."""
    template = get_template("daily_review")
    assert template is not None
    assert template.template_id == "daily_review"
    assert template.category == HeartbeatCategory.REVIEW
    assert template.default_cron == "0 21 * * *"


def test_template_config():
    """Test TemplateConfig model."""
    config = TemplateConfig(
        template_id="daily_review",
        enabled=True,
        cron="0 21 * * *",
    )
    assert config.template_id == "daily_review"
    assert config.enabled is True
    assert config.generate_log is True


def test_heartbeat_settings():
    """Test HeartbeatSettings model."""
    settings = HeartbeatSettings(
        enabled=True,
        timezone="Asia/Shanghai",
        templates={},
    )
    assert settings.enabled is True
    assert settings.timezone == "Asia/Shanghai"


def test_heartbeat_log_record():
    """Test HeartbeatLogRecord model."""
    from datetime import datetime

    record = HeartbeatLogRecord(
        heartbeat_type="daily_review",
        timestamp=datetime.now(),
        status="success",
        result_type=HeartbeatResultType.SUMMARY,
        result={"summary": "Test summary"},
        duration_seconds=10,
    )
    assert record.heartbeat_type == "daily_review"
    assert record.status == "success"
    assert record.user_visible is True
