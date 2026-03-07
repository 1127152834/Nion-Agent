"""Integration tests for memory system."""

import tempfile
from pathlib import Path

import pytest

from src.agents.memory.memory import MemoryManager


@pytest.fixture
def temp_memory_dir():
    """Create temporary memory directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


def test_end_to_end_memory_flow(temp_memory_dir):
    """Test complete memory flow: store → search → retrieve."""
    manager = MemoryManager(base_dir=temp_memory_dir)

    # 1. Store conversation
    conversation = {
        "id": "conv_test_001",
        "type": "conversation",
        "content": "User: I like Python programming and use VS Code.\nAI: That's great!",
        "metadata": {"thread_id": "test_thread"},
    }
    manager.store_conversation(conversation)

    # 2. Store memory items
    item1 = {
        "content": "User prefers Python for backend development",
        "category": "preference",
        "confidence": 0.9,
    }
    item2 = {
        "content": "User uses VS Code as primary editor",
        "category": "preference",
        "confidence": 0.8,
    }
    manager.store_item(item1)
    manager.store_item(item2)

    # 3. Search memory
    results = manager.search("What programming language does user like?", top_k=5)

    # 4. Verify results
    assert results["mode"] in ["fast", "deep"]
    assert len(results["results"]) > 0
    assert any("Python" in r.get("content", "") for r in results["results"])

    # 5. Get memory data
    data = manager.get_memory_data()
    assert len(data["items"]) >= 2

    # 6. Cleanup
    manager.close()


def test_memory_persistence(temp_memory_dir):
    """Test that memory persists across manager instances."""
    # First instance: store data
    manager1 = MemoryManager(base_dir=temp_memory_dir)
    manager1.store_item({
        "content": "Persistent memory item",
        "category": "knowledge",
        "confidence": 0.9,
    })
    manager1.close()

    # Second instance: retrieve data
    manager2 = MemoryManager(base_dir=temp_memory_dir)
    data = manager2.get_memory_data()

    assert len(data["items"]) >= 1
    assert any("Persistent" in item.get("content", "") for item in data["items"])

    manager2.close()


def test_search_with_multiple_items(temp_memory_dir):
    """Test search with multiple related items."""
    manager = MemoryManager(base_dir=temp_memory_dir)

    # Store multiple items
    items = [
        {"content": "User likes Python", "category": "preference", "confidence": 0.9},
        {"content": "User uses Django framework", "category": "knowledge", "confidence": 0.8},
        {"content": "User prefers FastAPI over Flask", "category": "preference", "confidence": 0.85},
        {"content": "User works on web development", "category": "context", "confidence": 0.9},
    ]

    for item in items:
        manager.store_item(item)

    # Search for Python-related items
    results = manager.search("Python web development", top_k=3)

    assert len(results["results"]) > 0
    assert len(results["results"]) <= 3

    manager.close()


def test_category_organization(temp_memory_dir):
    """Test that items are organized by category."""
    manager = MemoryManager(base_dir=temp_memory_dir)

    # Store items in different categories
    manager.store_item({
        "content": "User prefers dark mode",
        "category": "preference",
        "confidence": 0.9,
    })
    manager.store_item({
        "content": "Python is a programming language",
        "category": "knowledge",
        "confidence": 0.95,
    })

    # Get memory data
    data = manager.get_memory_data()

    # Verify categories exist
    assert "categories" in data
    categories = data["categories"]

    # Should have at least preference and knowledge categories
    assert len(categories) > 0

    manager.close()


@pytest.mark.slow
def test_large_scale_memory(temp_memory_dir):
    """Test memory system with many items."""
    manager = MemoryManager(base_dir=temp_memory_dir)

    # Store 100 items
    for i in range(100):
        manager.store_item({
            "content": f"Memory item {i}: This is test content about topic {i % 10}",
            "category": "knowledge",
            "confidence": 0.8,
        })

    # Search should still work efficiently
    results = manager.search("topic 5", top_k=10)

    assert len(results["results"]) > 0
    assert len(results["results"]) <= 10

    manager.close()
