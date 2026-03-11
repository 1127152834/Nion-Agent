from src.agents.memory.registry import get_default_memory_provider, get_memory_registry, reset_memory_registry


def teardown_function():
    reset_memory_registry()


def test_default_provider_is_registered():
    reset_memory_registry()

    provider = get_default_memory_provider()

    assert provider.name == "structured-fs"
    assert get_memory_registry().get_default() is provider


def test_reset_memory_registry_rebuilds_default_provider():
    reset_memory_registry()
    provider_before = get_default_memory_provider()

    reset_memory_registry()
    provider_after = get_default_memory_provider()

    assert provider_before is not provider_after
    assert provider_after.name == "structured-fs"
