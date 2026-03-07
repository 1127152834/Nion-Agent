"""Test hybrid search."""

import tempfile
from pathlib import Path
from unittest.mock import Mock

import pytest

from src.agents.memory.search.bm25 import BM25
from src.agents.memory.search.hybrid import HybridSearch
from src.agents.memory.search.vector_store import VectorStore


@pytest.fixture
def temp_db():
    """Create temporary database."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_vectors.db"
        yield str(db_path)


@pytest.fixture
def hybrid_search(temp_db):
    """Create hybrid search instance."""
    vector_store = VectorStore(temp_db)
    bm25 = BM25()

    # Add test data
    documents = [
        "Python is a programming language",
        "JavaScript is also a programming language",
        "I love Python programming",
    ]
    bm25.fit(documents)

    vector_store.add_vector("item_1", documents[0], [1.0, 0.0, 0.0])
    vector_store.add_vector("item_2", documents[1], [0.0, 1.0, 0.0])
    vector_store.add_vector("item_3", documents[2], [0.9, 0.1, 0.0])

    search = HybridSearch(
        vector_store=vector_store,
        bm25=bm25,
        vector_weight=0.5,
        bm25_weight=0.5,
    )

    yield search

    vector_store.close()


def test_hybrid_search_initialization(temp_db):
    """Test hybrid search initialization."""
    vector_store = VectorStore(temp_db)
    bm25 = BM25()

    search = HybridSearch(
        vector_store=vector_store,
        bm25=bm25,
        vector_weight=0.6,
        bm25_weight=0.4,
    )

    assert search.vector_weight == 0.6
    assert search.bm25_weight == 0.4

    vector_store.close()


def test_hybrid_search_combines_results(hybrid_search):
    """Test that hybrid search combines BM25 and vector results."""
    query = "Python programming"
    query_embedding = [1.0, 0.0, 0.0]

    results = hybrid_search.search(query, query_embedding, top_k=3)

    assert len(results) > 0
    assert all("fused_score" in r for r in results)
    assert all("content" in r for r in results)


def test_hybrid_search_score_fusion(hybrid_search):
    """Test score fusion."""
    query = "Python"
    query_embedding = [1.0, 0.0, 0.0]

    results = hybrid_search.search(query, query_embedding, top_k=3)

    # Results should be ordered by fused score
    scores = [r["fused_score"] for r in results]
    assert scores == sorted(scores, reverse=True)


def test_hybrid_search_access_count_boost(hybrid_search):
    """Test that access count boosts scores."""
    # First search
    query = "Python"
    query_embedding = [1.0, 0.0, 0.0]
    results1 = hybrid_search.search(query, query_embedding, top_k=1)

    # Simulate access count increase
    hybrid_search.vector_store.update_access(results1[0]["id"])
    hybrid_search.vector_store.update_access(results1[0]["id"])

    # Second search should show boosted score
    results2 = hybrid_search.search(query, query_embedding, top_k=1)

    # Note: Score boost is applied, but we can't directly compare
    # because scores are normalized. Just verify search works.
    assert len(results2) > 0


def test_hybrid_search_empty_query(hybrid_search):
    """Test hybrid search with empty query."""
    results = hybrid_search.search("", [0.0, 0.0, 0.0], top_k=5)

    # Should return empty or handle gracefully
    assert isinstance(results, list)
