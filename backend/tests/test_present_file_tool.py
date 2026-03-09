from types import SimpleNamespace
from unittest.mock import patch

from src.tools.builtins.present_file_tool import present_file_tool


def test_present_files_filters_non_virtual_paths():
    command = present_file_tool.func(
        runtime=None,
        filepaths=[
            "/mnt/user-data/outputs/report.md",
            "mnt/user-data/uploads/image.png",
            "/Users/demo/Desktop/private.txt",
            "../etc/passwd",
        ],
        tool_call_id="tool-1",
    )

    assert command.update is not None
    artifacts = command.update["artifacts"]
    assert artifacts == [
        "/mnt/user-data/outputs/report.md",
        "/mnt/user-data/uploads/image.png",
    ]
    message = command.update["messages"][0].content
    assert "Ignored 2 path(s)" in message


def test_present_files_accepts_only_virtual_prefix():
    command = present_file_tool.func(
        runtime=None,
        filepaths=["/mnt/user-data/outputs/a.txt", "mnt/user-data/outputs/b.txt"],
        tool_call_id="tool-2",
    )
    assert command.update is not None
    assert command.update["artifacts"] == [
        "/mnt/user-data/outputs/a.txt",
        "/mnt/user-data/outputs/b.txt",
    ]


def test_present_files_runtime_normalizes_existing_output_file(tmp_path):
    outputs_dir = tmp_path / "outputs"
    outputs_dir.mkdir(parents=True)
    target = outputs_dir / "result.md"
    target.write_text("ok", encoding="utf-8")

    runtime = SimpleNamespace(
        state={"thread_data": {"outputs_path": str(outputs_dir)}},
        context={"thread_id": "thread-1"},
    )

    command = present_file_tool.func(
        runtime=runtime,
        filepaths=[str(target)],
        tool_call_id="tool-3",
    )

    assert command.update is not None
    assert command.update["artifacts"] == ["/mnt/user-data/outputs/result.md"]
    assert command.update["messages"][0].content == "Successfully presented files"


def test_present_files_runtime_rejects_missing_file(tmp_path):
    outputs_dir = tmp_path / "outputs"
    outputs_dir.mkdir(parents=True)

    runtime = SimpleNamespace(
        state={"thread_data": {"outputs_path": str(outputs_dir)}},
        context={"thread_id": "thread-1"},
    )
    missing = outputs_dir / "missing.md"

    with patch("src.tools.builtins.present_file_tool.resolve_thread_virtual_path") as resolver_mock:
        # Ensure virtual path branch still resolves for completeness.
        resolver_mock.return_value = missing
        command = present_file_tool.func(
            runtime=runtime,
            filepaths=["/mnt/user-data/outputs/missing.md"],
            tool_call_id="tool-4",
        )

    assert command.update is not None
    assert command.update["messages"][0].content.startswith("Error: File not found")
