"""Phase 1 tests for memory system v2.0 core modules."""

from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path

MEMORY_DIR = Path(__file__).resolve().parents[1] / "src" / "agents" / "memory"


def _load_module(module_name: str, relative_path: str):
    module_path = MEMORY_DIR / relative_path
    assert module_path.exists(), f"Missing module file: {module_path}"

    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None and spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_phase1_module_files_loadable() -> None:
    _load_module("memory_types", "types.py")
    _load_module("memory_search_embeddings", "search/embeddings.py")
    _load_module("memory_search_bm25", "search/bm25.py")
    _load_module("memory_search_vector_store", "search/vector_store.py")
    _load_module("memory_search_hybrid", "search/hybrid.py")


def test_bm25_returns_relevant_document() -> None:
    bm25_module = _load_module("memory_search_bm25", "search/bm25.py")
    bm25 = bm25_module.BM25()

    docs = [
        "I like Python and machine learning.",
        "This project uses Golang for backend services.",
        "Python embeddings and vector search are useful.",
    ]

    bm25.fit(docs)
    results = bm25.search("python embeddings", top_k=2)

    assert results
    assert results[0]["document"] == "Python embeddings and vector search are useful."
    assert results[0]["score"] > 0


def test_vector_store_add_and_search(tmp_path) -> None:
    store_module = _load_module("memory_search_vector_store", "search/vector_store.py")
    store = store_module.VectorStore(str(tmp_path / "memory_vectors.db"))

    try:
        store.add_vector(
            id="item_a",
            content="python",
            embedding=[1.0, 0.0],
            category="knowledge",
            metadata={"source": "test"},
        )
        store.add_vector(
            id="item_b",
            content="golang",
            embedding=[0.0, 1.0],
            category="knowledge",
        )

        results = store.search_similar([0.9, 0.1], k=2)

        assert len(results) == 2
        assert results[0]["id"] == "item_a"
        assert results[0]["similarity"] > results[1]["similarity"]
    finally:
        store.close()


def test_vector_store_upsert_preserves_access_stats(tmp_path) -> None:
    store_module = _load_module("memory_search_vector_store_upsert", "search/vector_store.py")
    db_path = tmp_path / "memory_vectors_upsert.db"
    store = store_module.VectorStore(str(db_path))

    try:
        store.add_vector(
            id="item_a",
            content="python",
            embedding=[1.0, 0.0],
            category="knowledge",
            metadata={"source": "test"},
        )
        store.update_access("item_a")
        store.add_vector(
            id="item_a",
            content="python-updated",
            embedding=[1.0, 0.0],
            category="knowledge",
            metadata={"source": "test-v2"},
        )

        with sqlite3.connect(db_path) as conn:
            row = conn.execute(
                """
                SELECT access_count, content
                FROM memory_vectors
                WHERE id = ?
                """,
                ("item_a",),
            ).fetchone()

        assert row is not None
        assert row[0] == 1
        assert row[1] == "python-updated"
    finally:
        store.close()


def test_hybrid_search_fuses_scores(tmp_path) -> None:
    bm25_module = _load_module("memory_search_bm25", "search/bm25.py")
    vector_module = _load_module("memory_search_vector_store", "search/vector_store.py")
    hybrid_module = _load_module("memory_search_hybrid", "search/hybrid.py")

    docs = [
        "python embeddings guide",
        "team project roadmap",
        "golang concurrency patterns",
    ]

    bm25 = bm25_module.BM25()
    bm25.fit(docs)

    store = vector_module.VectorStore(str(tmp_path / "hybrid_vectors.db"))
    try:
        store.add_vector("id_1", docs[0], [1.0, 0.0], category="knowledge")
        store.add_vector("id_2", docs[1], [0.2, 0.8], category="project")
        store.add_vector("id_3", docs[2], [0.0, 1.0], category="knowledge")

        hybrid = hybrid_module.HybridSearch(store, bm25, vector_weight=0.5, bm25_weight=0.5)
        results = hybrid.search("python embeddings", [1.0, 0.0], top_k=2)

        assert results
        assert results[0]["content"] == docs[0]
        assert "fused_score" in results[0]
    finally:
        store.close()
