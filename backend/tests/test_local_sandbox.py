from __future__ import annotations

import builtins
from pathlib import Path

import pytest

from nion.sandbox.local.local_sandbox import LocalSandbox


@pytest.mark.parametrize(
    "method_name, content",
    [
        ("read_file", None),
        ("write_file", "hello"),
        ("update_file", b"hello"),
    ],
)
def test_local_sandbox_file_errors_keep_requested_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    method_name: str,
    content: str | bytes | None,
) -> None:
    host_root = tmp_path / "host-root"
    requested_path = "/mnt/workspace/docs/example.txt"
    resolved_path = str(host_root / "docs" / "example.txt")
    sandbox = LocalSandbox(
        "test-sandbox",
        path_mappings={"/mnt/workspace": str(host_root)},
    )

    def _raise_with_resolved_path(*args, **kwargs):
        raise FileNotFoundError(2, "No such file or directory", resolved_path)

    monkeypatch.setattr(builtins, "open", _raise_with_resolved_path)

    with pytest.raises(FileNotFoundError) as exc_info:
        if method_name == "read_file":
            sandbox.read_file(requested_path)
        elif method_name == "write_file":
            sandbox.write_file(requested_path, content if isinstance(content, str) else "")
        else:
            sandbox.update_file(requested_path, content if isinstance(content, bytes) else b"")

    message = str(exc_info.value)
    assert requested_path in message
    assert resolved_path not in message
