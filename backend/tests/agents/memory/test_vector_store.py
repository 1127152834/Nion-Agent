"""Test vector store."""

import tempfile
from pathlib import Path

import pytest

from src.agents.memory.search.vector_store import VectorStore


@pytest.fixture
def temp_db():
    """Create temporary database."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_vectors.db"
        yield str(db_path)


def test_vector_store_initialization(temp_db):
    """Test vector store initialization."""
    store = VectorStore(temp_db)
    assert Path(temp_db).exists()
    store.close()


def test_add_vector(temp_db):
    """Test adding vectors."""
    store = VectorStore(temp_db)

    embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
    store.add_vector(
        id="test_1",
        content="Test content",
        embedding=embedding,
        category="test",
        metadata={"source": "test"},
    )

    store.close()


def test_search_similar(temp_db):
    """Test similarity search."""
    store = VectorStore(temp_db)

    # Add test vectors
    store.add_vector("item_1", "Python programming", [1.0, 0.0, 0.0], category="knowledge")
    store.add_vector("item_2", "JavaScript coding", [0.0, 1.0, 0.0], category="knowledge")
    store.add_vector("item_3", "Python development", [0.9, 0.1, 0.0], category="knowledge")

    # Search for similar vectors
    query_embedding = [1.0, 0.0, 0.0]
    results = store.search_similar(query_embedding, k=2)

    assert len(results) <= 2
    assert all("id" in r for r in results)
    assert all("content" in r for r in results)
    assert all("similarity" in r for r in results)

    # First result should be most similar
    assert results[0]["id"] == "item_1"

    store.close()


def test_update_access(temp_db):
    """Test access count update."""
    store = VectorStore(temp_db)

    store.add_vector("item_1", "Test content", [1.0, 0.0, 0.0])

    # Update access
    store.update_access("item_1")
    store.update_access("item_1")

    # Search to verify access count
    results = store.search_similar([1.0, 0.0, 0.0], k=1)
    assert results[0]["access_count"] == 2

    store.close()


def test_vector_store_persistence(temp_db):
    """Test that vectors persist across store instances."""
    # Add vector in first instance
    store1 = VectorStore(temp_db)
    store1.add_vector("item_1", "Persistent content", [1.0, 0.5, 0.0])
    store1.close()

    # Retrieve in second instance
    store2 = VectorStore(temp_db)
    results = store2.search_similar([1.0, 0.5, 0.0], k=1)

    assert len(results) == 1
    assert results[0]["id"] == "item_1"
    assert results[0]["content"] == "Persistent content"

    store2.close()
