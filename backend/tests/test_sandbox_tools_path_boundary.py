from nion.sandbox.tools import _is_path_in_allowed_thread_dirs


def test_path_boundary_allows_paths_within_thread_dirs(tmp_path):
    thread_data = {
        "workspace_path": str(tmp_path / "workspace"),
        "uploads_path": str(tmp_path / "uploads"),
        "outputs_path": str(tmp_path / "outputs"),
    }
    (tmp_path / "workspace").mkdir(parents=True)
    file_path = tmp_path / "workspace" / "main.py"
    file_path.write_text("print('ok')", encoding="utf-8")

    assert _is_path_in_allowed_thread_dirs(str(file_path), thread_data) is True


def test_path_boundary_rejects_outside_paths(tmp_path):
    thread_data = {
        "workspace_path": str(tmp_path / "workspace"),
        "uploads_path": str(tmp_path / "uploads"),
        "outputs_path": str(tmp_path / "outputs"),
    }
    (tmp_path / "workspace").mkdir(parents=True)
    outside_path = tmp_path / "other" / "secret.txt"
    outside_path.parent.mkdir(parents=True, exist_ok=True)
    outside_path.write_text("secret", encoding="utf-8")

    assert _is_path_in_allowed_thread_dirs(str(outside_path), thread_data) is False
