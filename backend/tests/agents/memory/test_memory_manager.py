"""Test memory manager integration."""

import tempfile
from pathlib import Path

import pytest

from src.agents.memory.memory import MemoryManager


@pytest.fixture
def temp_memory_dir():
    """Create temporary memory directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


def test_memory_manager_initialization(temp_memory_dir):
    """Test memory manager initialization."""
    manager = MemoryManager(base_dir=temp_memory_dir)

    assert manager.base_dir == temp_memory_dir
    assert manager.resource_layer is not None
    assert manager.item_layer is not None
    assert manager.category_layer is not None

    manager.close()


def test_store_conversation(temp_memory_dir):
    """Test storing conversation."""
    manager = MemoryManager(base_dir=temp_memory_dir)

    resource = {
        "id": "conv_test_001",
        "type": "conversation",
        "content": "User: Hello\nAI: Hi there!",
        "metadata": {"thread_id": "test_thread"},
    }

    stored = manager.store_conversation(resource)

    assert stored["id"] == "conv_test_001"
    assert stored["type"] == "conversation"

    manager.close()


def test_store_item(temp_memory_dir):
    """Test storing memory item."""
    manager = MemoryManager(base_dir=temp_memory_dir)

    item = {
        "content": "User prefers Python for backend development",
        "category": "preference",
        "confidence": 0.9,
    }

    stored = manager.store_item(item)

    assert "id" in stored
    assert stored["content"] == item["content"]
    assert stored["category"] == "preference"

    manager.close()


def test_search_memory(temp_memory_dir):
    """Test memory search."""
    manager = MemoryManager(base_dir=temp_memory_dir)

    # Store some items
    manager.store_item({
        "content": "User likes Python programming",
        "category": "preference",
        "confidence": 0.9,
    })
    manager.store_item({
        "content": "User uses VS Code editor",
        "category": "preference",
        "confidence": 0.8,
    })

    # Search
    results = manager.search("Python", top_k=5)

    assert "mode" in results
    assert "results" in results
    assert len(results["results"]) > 0

    manager.close()


def test_get_memory_data(temp_memory_dir):
    """Test getting memory data."""
    manager = MemoryManager(base_dir=temp_memory_dir, enable_legacy=False)

    # Store some data
    manager.store_item({
        "content": "Test memory item",
        "category": "knowledge",
        "confidence": 0.8,
    })

    # Get memory data
    data = manager.get_memory_data()

    assert "version" in data
    assert data["version"] == "2.0"
    assert "items" in data
    assert "categories" in data
    assert "resources" in data

    manager.close()


def test_memory_manager_close(temp_memory_dir):
    """Test memory manager cleanup."""
    manager = MemoryManager(base_dir=temp_memory_dir)

    # Should not raise exception
    manager.close()
