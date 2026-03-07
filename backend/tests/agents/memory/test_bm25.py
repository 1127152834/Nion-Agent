"""Test BM25 search algorithm."""

import pytest

from src.agents.memory.search.bm25 import BM25


def test_bm25_initialization():
    """Test BM25 initialization."""
    bm25 = BM25(k1=1.5, b=0.75)
    assert bm25.k1 == 1.5
    assert bm25.b == 0.75
    assert bm25.corpus_size == 0


def test_bm25_fit():
    """Test BM25 index building."""
    bm25 = BM25()
    documents = [
        "Python is a programming language",
        "JavaScript is also a programming language",
        "I love Python programming",
    ]

    bm25.fit(documents)

    assert bm25.corpus_size == 3
    assert len(bm25.documents) == 3
    assert len(bm25.doc_lengths) == 3
    assert bm25.avgdl > 0
    assert len(bm25.idf) > 0


def test_bm25_search():
    """Test BM25 search."""
    bm25 = BM25()
    documents = [
        "Python is a programming language",
        "JavaScript is also a programming language",
        "I love Python programming",
        "Machine learning with Python",
    ]

    bm25.fit(documents)
    results = bm25.search("Python programming", top_k=2)

    assert len(results) <= 2
    assert all("score" in r for r in results)
    assert all("document" in r for r in results)
    # First result should contain both "Python" and "programming"
    assert "Python" in results[0]["document"]


def test_bm25_search_no_results():
    """Test BM25 search with no matching documents."""
    bm25 = BM25()
    documents = [
        "Python is a programming language",
        "JavaScript is also a programming language",
    ]

    bm25.fit(documents)
    results = bm25.search("quantum physics", top_k=5)

    assert len(results) == 0


def test_bm25_search_relevance_order():
    """Test BM25 search returns results in relevance order."""
    bm25 = BM25()
    documents = [
        "Python",
        "Python programming",
        "Python programming language",
        "JavaScript",
    ]

    bm25.fit(documents)
    results = bm25.search("Python programming", top_k=3)

    # Results should be ordered by score (descending)
    scores = [r["score"] for r in results]
    assert scores == sorted(scores, reverse=True)
