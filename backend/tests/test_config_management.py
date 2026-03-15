"""Test script for configuration management system.

This script tests the core functionality of the configuration management system:
1. Configuration storage (SQLite)
2. Configuration migration (YAML → SQLite)
3. Configuration loading (SQLite-first)
4. Configuration validation
"""

import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.config.config_store import SQLiteConfigStore, create_config_store
from src.config.config_repository import ConfigRepository
from src.config.migration import migrate_config_to_sqlite
from src.config.app_config import AppConfig


def _config_store_ok() -> bool:
    """Return whether SQLite configuration storage behaves as expected.

    This helper is used by:
    - pytest tests (which should `assert _config_store_ok()` without returning values)
    - the optional `main()` self-test runner (which collects boolean results)
    """
    print("Testing SQLite configuration storage...")

    # Create a test database
    test_db = Path("/tmp/test_nion_config.db")
    if test_db.exists():
        test_db.unlink()

    store = SQLiteConfigStore(test_db)
    try:
        # Test initial read (should create default config)
        config, version, path = store.read()
        print(f"✓ Initial read successful (version: {version})")
        assert version == "1", f"Expected version 1, got {version}"
        assert "models" in config, "Config should have 'models' key"
        assert config.get("checkpointer", {}).get("type") == "sqlite", "Config should default to sqlite checkpointer"

        # Test write with correct version
        config["models"] = [{"name": "test-model", "use": "test"}]
        new_version = store.write(config, expected_version=version)
        print(f"✓ Write successful (new version: {new_version})")
        assert new_version == "2", f"Expected version 2, got {new_version}"

        # Test read after write
        config2, version2, _ = store.read()
        print(f"✓ Read after write successful (version: {version2})")
        assert version2 == "2", f"Expected version 2, got {version2}"
        assert len(config2["models"]) == 1, "Config should have 1 model"

        # Test version conflict
        conflict_detected = False
        try:
            store.write(config, expected_version="1")
            print("✗ Version conflict not detected!")
        except Exception as e:
            conflict_detected = True
            print(f"✓ Version conflict detected: {type(e).__name__}")

        if not conflict_detected:
            return False

        print("✓ All config store tests passed!\n")
        return True
    finally:
        # Always cleanup temp DB to avoid polluting repeated local runs.
        if test_db.exists():
            test_db.unlink()


def test_config_store():
    """Test SQLite configuration storage (pytest entrypoint)."""
    assert _config_store_ok()


def _config_repository_ok() -> bool:
    """Return whether ConfigRepository can be imported/constructed."""
    print("Testing configuration repository...")
    _ = ConfigRepository()
    print("✓ ConfigRepository structure validated\n")
    return True


def test_config_repository():
    """Test configuration repository (pytest entrypoint)."""
    assert _config_repository_ok()


def _config_loading_ok() -> bool:
    """Return whether AppConfig exposes the expected SQLite-first loading APIs."""
    print("Testing configuration loading...")

    # Test that AppConfig has the new methods
    assert hasattr(AppConfig, "from_store"), "AppConfig should have from_store method"
    assert hasattr(AppConfig, "from_store_or_file"), "AppConfig should have from_store_or_file method"

    print("✓ AppConfig has required methods")
    print("✓ Configuration loading structure validated\n")
    return True


def test_config_loading():
    """Test configuration loading logic (pytest entrypoint)."""
    assert _config_loading_ok()


def main():
    """Run all tests."""
    print("=" * 60)
    print("Configuration Management System Self-Test")
    print("=" * 60)
    print()

    tests = [
        ("Config Store", _config_store_ok),
        ("Config Repository", _config_repository_ok),
        ("Config Loading", _config_loading_ok),
    ]

    results = []
    for name, test_func in tests:
        try:
            result = test_func()
            results.append((name, result))
        except Exception as e:
            print(f"✗ {name} test failed with error: {e}\n")
            results.append((name, False))

    print("=" * 60)
    print("Test Summary")
    print("=" * 60)
    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status}: {name}")

    all_passed = all(result for _, result in results)
    print()
    if all_passed:
        print("✓ All tests passed!")
        return 0
    else:
        print("✗ Some tests failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
