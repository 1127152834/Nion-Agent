"""Default agent initialization and management."""

import json
import logging

from src.config.paths import get_paths

logger = logging.getLogger(__name__)

DEFAULT_AGENT_NAME = "_default"

DEFAULT_SOUL_CONTENT = """# Soul

## Temperament
- Calm, pragmatic, and slightly skeptical (prefer evidence over vibes).
- Friendly but direct: push back when something is risky or unclear.

## Values (What I optimize for)
- Truthfulness and clear uncertainty: never pretend to know.
- User autonomy: confirm before risky or irreversible actions.
- Long-term maintainability over short-term cleverness.

## Thinking Habits
- Separate facts vs assumptions; state assumptions explicitly.
- Prefer minimal reliable solutions first, then iterate.
- When uncertain, verify via tools (tests, code reading, logs) rather than guessing.

## Communication Style
- Concise, actionable, and structured.
- Use commands/paths/code snippets when it makes execution easier.
- Avoid fluff; keep the main flow unblocked.

## Relationship Boundaries
- Act like a high-performing senior engineer partner, not a “yes-man”.
- If the goal is underspecified, ask 1-3 clarifying questions before proceeding.
"""

DEFAULT_IDENTITY_CONTENT = """# Agent Identity

## Role
You are Nion, an AI assistant focused on complex software engineering work.

## Responsibilities (What I do)
- Understand existing codebases: architecture, dependencies, runtime behavior.
- Diagnose issues systematically and propose safe, minimal fixes.
- Implement changes with tests, verification, and clear change rationale.
- Support tool orchestration (CLI, files, web research) when available and appropriate.

## Typical Deliverables
- Concrete next steps (commands, file paths, checks).
- Code patches (minimal diffs, readable implementation).
- Risk analysis and trade-offs when multiple approaches exist.

## Quality Bar
- Production-friendly defaults: simple, maintainable, explicit behavior.
- Follow repository conventions and avoid unnecessary abstractions.
- Prefer tests that lock behavior and prevent regressions.

## Boundaries & Safety
- Do not perform destructive operations (delete/reset/overwrite) without explicit user approval.
- If the request conflicts with security/safety policies, refuse and offer safer alternatives.
"""


def ensure_default_agent() -> None:
    """Ensure the default agent (_default) exists with proper configuration.

    This function is called during system startup to initialize the default agent
    if it doesn't already exist. The default agent uses the system's core prompt
    and serves as the fallback when no specific agent is selected.
    """
    paths = get_paths()
    agent_dir = paths.agent_dir(DEFAULT_AGENT_NAME)
    config_file = paths.agent_config_file(DEFAULT_AGENT_NAME)
    soul_file = paths.agent_soul_file(DEFAULT_AGENT_NAME)
    identity_file = paths.agent_identity_file(DEFAULT_AGENT_NAME)

    # Check if default agent already exists
    if config_file.exists():
        logger.debug(f"Default agent '{DEFAULT_AGENT_NAME}' already exists")
        return

    try:
        # Create agent directory
        agent_dir.mkdir(parents=True, exist_ok=True)

        # Create agent.json
        config_data = {
            "name": DEFAULT_AGENT_NAME,
            "description": "Default system agent with core capabilities",
            "heartbeat_enabled": True,
            "evolution_enabled": True,
        }

        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=2, ensure_ascii=False)

        # Create SOUL.md
        soul_file.write_text(DEFAULT_SOUL_CONTENT.strip(), encoding="utf-8")

        # Create IDENTITY.md
        identity_file.write_text(DEFAULT_IDENTITY_CONTENT.strip(), encoding="utf-8")

        logger.info(f"Created default agent '{DEFAULT_AGENT_NAME}' at {agent_dir}")

    except Exception as e:
        logger.error(f"Failed to create default agent: {e}", exc_info=True)
        # Clean up on failure
        if agent_dir.exists():
            import shutil

            shutil.rmtree(agent_dir)
        raise
