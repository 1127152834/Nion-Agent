"""Enforce harness→app import boundary.

The harness layer (packages/harness/nion/) must NEVER import from the app layer (app/).
This test statically scans all harness Python files to verify the boundary.
"""

from __future__ import annotations

import ast
from pathlib import Path

HARNESS_ROOT = Path(__file__).parent.parent / "packages" / "harness" / "nion"
BANNED_PREFIXES = ("app.",)


def test_harness_does_not_import_app():
    """Harness layer must not contain any imports from app layer."""
    violations: list[str] = []
    for py_file in sorted(HARNESS_ROOT.rglob("*.py")):
        try:
            source = py_file.read_text(encoding="utf-8")
            tree = ast.parse(source)
        except (SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if any(alias.name == p.rstrip(".") or alias.name.startswith(p) for p in BANNED_PREFIXES):
                        rel = py_file.relative_to(HARNESS_ROOT.parent.parent.parent)
                        violations.append(f"  {rel}:{node.lineno}  import {alias.name}")
            elif isinstance(node, ast.ImportFrom) and node.module:
                if any(node.module == p.rstrip(".") or node.module.startswith(p) for p in BANNED_PREFIXES):
                    rel = py_file.relative_to(HARNESS_ROOT.parent.parent.parent)
                    violations.append(f"  {rel}:{node.lineno}  from {node.module}")
    assert not violations, "Harness layer must not import from app layer:\n" + "\n".join(violations)


def test_no_residual_src_imports():
    """No Python file should still reference legacy `src.*` imports after migration."""
    violations: list[str] = []
    search_roots = [
        HARNESS_ROOT,
        Path(__file__).parent.parent / "app",
        Path(__file__).parent,  # tests/
    ]
    for root in search_roots:
        if not root.exists():
            continue
        for py_file in sorted(root.rglob("*.py")):
            try:
                source = py_file.read_text(encoding="utf-8")
                tree = ast.parse(source)
            except (SyntaxError, UnicodeDecodeError):
                continue
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name == "src" or alias.name.startswith("src."):
                            rel = py_file.relative_to(Path(__file__).parent.parent)
                            violations.append(f"  {rel}:{node.lineno}  import {alias.name}")
                elif isinstance(node, ast.ImportFrom) and node.module:
                    if node.module == "src" or node.module.startswith("src."):
                        rel = py_file.relative_to(Path(__file__).parent.parent)
                        violations.append(f"  {rel}:{node.lineno}  from {node.module}")
    assert not violations, "Residual src.* imports found:\n" + "\n".join(violations)
