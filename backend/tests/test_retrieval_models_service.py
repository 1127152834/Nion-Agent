from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from src.config.retrieval_models_config import RetrievalModelsConfig
from src.retrieval_models.service import RetrievalModelsError, RetrievalModelsService


def _build_retrieval_config(
    *,
    model_root: Path,
    active_embedding_model_id: str | None = None,
    active_rerank_model_id: str | None = None,
) -> RetrievalModelsConfig:
    return RetrievalModelsConfig.model_validate(
        {
            "local_models_dir": str(model_root),
            "registry_file": str(model_root / "registry.json"),
            "active": {
                "embedding": {
                    "provider": "local_onnx",
                    "model_id": active_embedding_model_id,
                },
                "rerank": {
                    "provider": "local_onnx",
                    "model_id": active_rerank_model_id,
                },
            },
        }
    )


def _seed_local_model(model_root: Path, model_id: str) -> None:
    model_root.mkdir(parents=True, exist_ok=True)
    (model_root / f"{model_id}.onnx").write_bytes(b"dummy-onnx")
    registry_file = model_root / "registry.json"
    if registry_file.exists():
        registry_payload = json.loads(registry_file.read_text(encoding="utf-8"))
    else:
        registry_payload = {"version": 1, "updated_at": 0, "models": {}}
    models = registry_payload.get("models")
    if not isinstance(models, dict):
        models = {}
        registry_payload["models"] = models
    models[model_id] = {
        "model_id": model_id,
        "family": "embedding" if "embedding" in model_id else "rerank",
        "display_name": model_id,
        "file_path": f"{model_id}.onnx",
        "installed": True,
    }
    registry_file.write_text(json.dumps(registry_payload), encoding="utf-8")


def _patch_runtime(monkeypatch: pytest.MonkeyPatch, cfg: RetrievalModelsConfig) -> dict[str, object]:
    config_dict: dict[str, object] = {"retrieval_models": cfg.model_dump(exclude_none=True)}

    class _FakeConfigRepository:
        def read(self) -> tuple[dict[str, object], str, Path]:
            return config_dict, "version-1", Path("config.yaml")

        def write(self, config_dict: dict[str, object], expected_version: str) -> str:  # noqa: ANN001
            _ = expected_version
            current = config_dict.get("retrieval_models")
            if isinstance(current, dict):
                config_dict_ref["retrieval_models"] = current
            return "version-2"

    config_dict_ref = config_dict

    monkeypatch.setattr(
        "src.retrieval_models.service.get_app_config",
        lambda: SimpleNamespace(retrieval_models=cfg),
    )
    monkeypatch.setattr(
        "src.retrieval_models.service.ConfigRepository",
        _FakeConfigRepository,
    )
    return config_dict


def test_remove_model_rejects_active_embedding(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    model_root = tmp_path / "models"
    model_id = "zh-embedding-lite"
    _seed_local_model(model_root, model_id)
    cfg = _build_retrieval_config(model_root=model_root, active_embedding_model_id=model_id)
    _patch_runtime(monkeypatch, cfg)

    service = RetrievalModelsService()
    with pytest.raises(RetrievalModelsError) as exc:
        asyncio.run(service.remove_model(model_id))

    assert exc.value.error_code == "retrieval_active_model_remove_forbidden"
    assert (model_root / f"{model_id}.onnx").exists()


def test_remove_model_rejects_active_rerank(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    model_root = tmp_path / "models"
    model_id = "zh-rerank-lite"
    _seed_local_model(model_root, model_id)
    cfg = _build_retrieval_config(model_root=model_root, active_rerank_model_id=model_id)
    _patch_runtime(monkeypatch, cfg)

    service = RetrievalModelsService()
    with pytest.raises(RetrievalModelsError) as exc:
        asyncio.run(service.remove_model(model_id))

    assert exc.value.error_code == "retrieval_active_model_remove_forbidden"
    assert (model_root / f"{model_id}.onnx").exists()


def test_remove_model_allows_inactive_model(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    model_root = tmp_path / "models"
    model_id = "zh-embedding-lite"
    _seed_local_model(model_root, model_id)
    _seed_local_model(model_root, "en-embedding-lite")
    cfg = _build_retrieval_config(model_root=model_root, active_rerank_model_id="zh-rerank-lite")
    _patch_runtime(monkeypatch, cfg)

    service = RetrievalModelsService()
    result = asyncio.run(service.remove_model(model_id))

    assert result["success"] is True
    assert not (model_root / f"{model_id}.onnx").exists()
    registry = json.loads((model_root / "registry.json").read_text(encoding="utf-8"))
    assert model_id not in registry.get("models", {})


def test_remove_model_rejects_last_embedding_model(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    model_root = tmp_path / "models"
    model_id = "zh-embedding-lite"
    _seed_local_model(model_root, model_id)
    cfg = _build_retrieval_config(model_root=model_root)
    cfg.active.embedding.provider = "openai_compatible"
    cfg.active.embedding.model_id = None
    _patch_runtime(monkeypatch, cfg)

    service = RetrievalModelsService()
    with pytest.raises(RetrievalModelsError) as exc:
        asyncio.run(service.remove_model(model_id))

    assert exc.value.error_code == "retrieval_pack_keep_one_required"
    assert (model_root / f"{model_id}.onnx").exists()


def test_set_active_pack_updates_embedding_and_rerank(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    model_root = tmp_path / "models"
    _seed_local_model(model_root, "zh-embedding-lite")
    _seed_local_model(model_root, "zh-rerank-lite")
    cfg = _build_retrieval_config(model_root=model_root)
    _patch_runtime(monkeypatch, cfg)

    service = RetrievalModelsService()
    result = service.set_active_pack("zh")

    active = result["active"]
    assert result["pack_id"] == "zh"
    assert active["embedding"]["provider"] == "local_onnx"
    assert active["embedding"]["model_id"] == "zh-embedding-lite"
    assert active["rerank"]["provider"] == "local_onnx"
    assert active["rerank"]["model_id"] == "zh-rerank-lite"


def test_set_active_model_local_maps_to_pack(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    model_root = tmp_path / "models"
    _seed_local_model(model_root, "en-embedding-lite")
    _seed_local_model(model_root, "en-rerank-lite")
    cfg = _build_retrieval_config(model_root=model_root)
    _patch_runtime(monkeypatch, cfg)

    service = RetrievalModelsService()
    result = service.set_active_model(
        family="embedding",
        provider="local_onnx",
        model_id="en-embedding-lite",
    )

    active = result["active"]
    assert result["pack_id"] == "en"
    assert active["embedding"]["model_id"] == "en-embedding-lite"
    assert active["rerank"]["model_id"] == "en-rerank-lite"
    assert result["mapped_from"]["model_id"] == "en-embedding-lite"


def test_build_status_normalizes_mixed_local_config(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    model_root = tmp_path / "models"
    _seed_local_model(model_root, "zh-embedding-lite")
    _seed_local_model(model_root, "zh-rerank-lite")
    _seed_local_model(model_root, "en-rerank-lite")

    cfg = _build_retrieval_config(
        model_root=model_root,
        active_embedding_model_id="zh-embedding-lite",
        active_rerank_model_id="en-rerank-lite",
    )
    config_dict = _patch_runtime(monkeypatch, cfg)

    service = RetrievalModelsService()
    status = service.build_status()

    active = status["active"]
    assert status["normalization_applied"] is True
    assert status["active_pack_id"] == "zh"
    assert active["embedding"]["model_id"] == "zh-embedding-lite"
    assert active["rerank"]["model_id"] == "zh-rerank-lite"

    persisted = config_dict["retrieval_models"]
    assert isinstance(persisted, dict)
    persisted_active = persisted["active"]
    assert persisted_active["rerank"]["model_id"] == "zh-rerank-lite"


def test_set_active_pack_requires_complete_pack(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    model_root = tmp_path / "models"
    _seed_local_model(model_root, "zh-embedding-lite")
    cfg = _build_retrieval_config(model_root=model_root)
    _patch_runtime(monkeypatch, cfg)

    service = RetrievalModelsService()
    with pytest.raises(RetrievalModelsError) as exc:
        service.set_active_pack("zh")

    assert exc.value.error_code == "retrieval_pack_not_ready"


def test_remove_pack_rejects_active_pack(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    model_root = tmp_path / "models"
    _seed_local_model(model_root, "zh-embedding-lite")
    _seed_local_model(model_root, "zh-rerank-lite")
    _seed_local_model(model_root, "en-embedding-lite")
    _seed_local_model(model_root, "en-rerank-lite")
    cfg = _build_retrieval_config(
        model_root=model_root,
        active_embedding_model_id="zh-embedding-lite",
        active_rerank_model_id="zh-rerank-lite",
    )
    _patch_runtime(monkeypatch, cfg)

    service = RetrievalModelsService()
    with pytest.raises(RetrievalModelsError) as exc:
        asyncio.run(service.remove_pack("zh"))

    assert exc.value.error_code == "retrieval_active_model_remove_forbidden"
    assert (model_root / "zh-embedding-lite.onnx").exists()
    assert (model_root / "zh-rerank-lite.onnx").exists()


def test_remove_pack_requires_keeping_one_downloaded_pack(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    model_root = tmp_path / "models"
    _seed_local_model(model_root, "zh-embedding-lite")
    _seed_local_model(model_root, "zh-rerank-lite")
    cfg = _build_retrieval_config(model_root=model_root)
    cfg.active.embedding.provider = "openai_compatible"
    cfg.active.embedding.model_id = None
    cfg.active.rerank.provider = "rerank_api"
    cfg.active.rerank.model_id = None
    _patch_runtime(monkeypatch, cfg)

    service = RetrievalModelsService()
    with pytest.raises(RetrievalModelsError) as exc:
        asyncio.run(service.remove_pack("zh"))

    assert exc.value.error_code == "retrieval_pack_keep_one_required"
    assert (model_root / "zh-embedding-lite.onnx").exists()
    assert (model_root / "zh-rerank-lite.onnx").exists()


def test_remove_pack_allows_inactive_pack_when_another_pack_remains(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    model_root = tmp_path / "models"
    _seed_local_model(model_root, "zh-embedding-lite")
    _seed_local_model(model_root, "zh-rerank-lite")
    _seed_local_model(model_root, "en-embedding-lite")
    _seed_local_model(model_root, "en-rerank-lite")
    cfg = _build_retrieval_config(
        model_root=model_root,
        active_embedding_model_id="zh-embedding-lite",
        active_rerank_model_id="zh-rerank-lite",
    )
    _patch_runtime(monkeypatch, cfg)

    service = RetrievalModelsService()
    result = asyncio.run(service.remove_pack("en"))

    assert result["success"] is True
    assert result["pack_id"] == "en"
    assert not (model_root / "en-embedding-lite.onnx").exists()
    assert not (model_root / "en-rerank-lite.onnx").exists()
    assert (model_root / "zh-embedding-lite.onnx").exists()
    assert (model_root / "zh-rerank-lite.onnx").exists()
