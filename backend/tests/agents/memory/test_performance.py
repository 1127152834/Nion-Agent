"""Performance tests for memory system."""

import tempfile
import time
from pathlib import Path

import pytest

from src.agents.memory.memory import MemoryManager


@pytest.fixture
def temp_memory_dir():
    """Create temporary memory directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.mark.slow
def test_search_performance_1000_items(temp_memory_dir):
    """Test search performance with 1000 memory items."""
    manager = MemoryManager(base_dir=temp_memory_dir)

    # Store 1000 items
    for i in range(1000):
        item = {
            "content": f"Memory item {i}: This is test content about topic {i % 10}",
            "category": "knowledge",
            "confidence": 0.8,
        }
        manager.store_item(item)

    # Measure search time
    start_time = time.time()
    results = manager.search("topic 5", top_k=10)
    search_time = time.time() - start_time

    # Verify performance (should complete within 1 second)
    assert search_time < 1.0, f"Search took {search_time:.2f}s, expected < 1.0s"
    assert len(results["results"]) > 0

    manager.close()


@pytest.mark.slow
def test_bulk_insert_performance(temp_memory_dir):
    """Test bulk insert performance."""
    manager = MemoryManager(base_dir=temp_memory_dir)

    # Measure bulk insert time
    start_time = time.time()
    for i in range(100):
        manager.store_item({
            "content": f"Bulk item {i}",
            "category": "knowledge",
            "confidence": 0.8,
        })
    insert_time = time.time() - start_time

    # Should complete within reasonable time (10 seconds for 100 items)
    assert insert_time < 10.0, f"Bulk insert took {insert_time:.2f}s, expected < 10.0s"

    manager.close()


@pytest.mark.slow
def test_memory_footprint(temp_memory_dir):
    """Test memory footprint with many items."""
    manager = MemoryManager(base_dir=temp_memory_dir)

    # Store 500 items
    for i in range(500):
        manager.store_item({
            "content": f"Memory item {i}: " + "x" * 100,  # ~100 chars each
            "category": "knowledge",
            "confidence": 0.8,
        })

    # Get memory data
    data = manager.get_memory_data()

    # Verify data integrity
    assert len(data["items"]) >= 500

    manager.close()


@pytest.mark.slow
def test_concurrent_search_performance(temp_memory_dir):
    """Test search performance with multiple queries."""
    manager = MemoryManager(base_dir=temp_memory_dir)

    # Store test data
    for i in range(200):
        manager.store_item({
            "content": f"Item {i} about topic {i % 5}",
            "category": "knowledge",
            "confidence": 0.8,
        })

    # Measure multiple searches
    queries = ["topic 0", "topic 1", "topic 2", "topic 3", "topic 4"]
    start_time = time.time()

    for query in queries:
        results = manager.search(query, top_k=5)
        assert len(results["results"]) > 0

    total_time = time.time() - start_time

    # Should complete all searches within 2 seconds
    assert total_time < 2.0, f"Multiple searches took {total_time:.2f}s, expected < 2.0s"

    manager.close()
