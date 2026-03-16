from __future__ import annotations

import pytest

from src.agents.memory.prompt import format_memory_for_injection


@pytest.mark.unit
def test_BE_CORE_MEM_INJECT_501_excludes_trace_expired_and_non_active():
    memory_data = {
        "facts": [
            {"content": "profile-a", "tier": "profile", "status": "active", "quality_score": 0.9},
            {"content": "pref-a", "tier": "preference", "status": "active", "quality_score": 0.8},
            {"content": "episode-a", "tier": "episode", "status": "active", "quality_score": 0.7},
            {"content": "trace-a", "tier": "trace", "status": "active", "quality_score": 1.0},
            {
                "content": "expired-episode",
                "tier": "episode",
                "status": "active",
                "quality_score": 0.99,
                "expires_at": "2020-01-01T00:00:00Z",
            },
            {"content": "archived-pref", "tier": "preference", "status": "archived", "quality_score": 0.99},
        ]
    }

    rendered = format_memory_for_injection(memory_data, max_tokens=500)

    assert "Profile:" in rendered
    assert "Preference:" in rendered
    assert "Episodes:" in rendered
    assert "profile-a" in rendered
    assert "pref-a" in rendered
    assert "episode-a" in rendered
    assert "trace-a" not in rendered
    assert "expired-episode" not in rendered
    assert "archived-pref" not in rendered


@pytest.mark.unit
def test_BE_CORE_MEM_INJECT_502_limits_episodes_to_top5_by_quality_score():
    memory_data = {
        "facts": [
            {"content": "profile-a", "tier": "profile", "status": "active", "quality_score": 0.9},
            {"content": "pref-a", "tier": "preference", "status": "active", "quality_score": 0.8},
            {"content": "ep1", "tier": "episode", "status": "active", "quality_score": 0.1},
            {"content": "ep2", "tier": "episode", "status": "active", "quality_score": 0.2},
            {"content": "ep3", "tier": "episode", "status": "active", "quality_score": 0.3},
            {"content": "ep4", "tier": "episode", "status": "active", "quality_score": 0.4},
            {"content": "ep5", "tier": "episode", "status": "active", "quality_score": 0.5},
            {"content": "ep6", "tier": "episode", "status": "active", "quality_score": 0.6},
        ]
    }

    rendered = format_memory_for_injection(memory_data, max_tokens=500)

    # Keep only top 5 episodes: ep2-ep6; ep1 is the lowest and should be excluded.
    assert "ep6" in rendered
    assert "ep5" in rendered
    assert "ep4" in rendered
    assert "ep3" in rendered
    assert "ep2" in rendered
    assert "ep1" not in rendered


@pytest.mark.unit
def test_BE_CORE_MEM_INJECT_503_drops_episodes_first_when_over_budget():
    memory_data = {
        "facts": [
            {"content": "profile-a", "tier": "profile", "status": "active", "quality_score": 0.9},
            {"content": "pref-a", "tier": "preference", "status": "active", "quality_score": 0.8},
            {
                "content": "episode-long:" + ("x" * 5000),
                "tier": "episode",
                "status": "active",
                "quality_score": 0.99,
            },
        ]
    }

    rendered = format_memory_for_injection(memory_data, max_tokens=80)

    assert "Profile:" in rendered
    assert "Preference:" in rendered
    assert "Episodes:" not in rendered
    assert "episode-long:" not in rendered

