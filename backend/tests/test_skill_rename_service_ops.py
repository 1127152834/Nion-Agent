import json
from pathlib import Path

import pytest

from nion.config.extensions_config import ExtensionsConfig, reset_extensions_config
from nion.skills.loader import load_skills
from nion.tools.builtins._service_ops import rename_skill


def _write_skill(dir_path: Path, *, name: str) -> None:
    dir_path.mkdir(parents=True, exist_ok=True)
    (dir_path / "SKILL.md").write_text(f"---\nname: {name}\ndescription: test\n---\n", encoding="utf-8")


@pytest.mark.unit
def test_rename_skill_custom_updates_skill_and_extensions_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    base_dir = tmp_path / "nion-home"
    skills_root = tmp_path / "skills"

    _write_skill(skills_root / "custom" / "alpha", name="alpha")
    _write_skill(skills_root / "public" / "bootstrap", name="bootstrap")

    monkeypatch.setenv("NION_HOME", str(base_dir))

    reset_extensions_config()
    cfg_path = ExtensionsConfig.default_config_path()
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    cfg_path.write_text(json.dumps({"skills": {"alpha": {"enabled": False}}}, ensure_ascii=False), encoding="utf-8")

    # act
    renamed = rename_skill("alpha", "beta", skills_path=skills_root)

    # assert: skill name changed
    skills = load_skills(skills_path=skills_root, use_config=False, enabled_only=False)
    names = {s.name for s in skills}
    assert "alpha" not in names
    assert "beta" in names

    # assert: extensions state moved
    payload = json.loads(cfg_path.read_text(encoding="utf-8"))
    assert payload["skills"]["beta"]["enabled"] is False
    assert "alpha" not in payload["skills"]
    assert renamed.name == "beta"

