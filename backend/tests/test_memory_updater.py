import warnings
from datetime import datetime

from src.agents.memory import updater as updater_module
from src.agents.memory.queue import ConversationContext


def test_create_empty_memory_emits_no_deprecation_warning():
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        memory = updater_module._create_empty_memory()

    assert not any(issubclass(item.category, DeprecationWarning) for item in caught)
    parsed = datetime.fromisoformat(memory["lastUpdated"].replace("Z", "+00:00"))
    assert parsed.tzinfo is not None


def test_conversation_context_timestamp_emits_no_deprecation_warning():
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        context = ConversationContext(thread_id="thread-1", messages=[])

    assert not any(issubclass(item.category, DeprecationWarning) for item in caught)
    assert context.timestamp.tzinfo is not None


def test_parse_memory_update_response_accepts_fenced_json():
    payload = '''```json
    {"newFacts": [{"content": "User likes Python", "category": "preference", "confidence": 0.9}]}
    ```'''

    result = updater_module.parse_memory_update_response(payload)

    assert result["newFacts"][0]["content"] == "User likes Python"
    assert result["user"] == {}
    assert result["history"] == {}
    assert result["factsToRemove"] == []



def test_parse_memory_update_response_accepts_prefixed_object_text():
    payload = 'Here is the update JSON you requested: {"factsToRemove": ["fact_1"], "newFacts": []}'

    result = updater_module.parse_memory_update_response(payload)

    assert result["factsToRemove"] == ["fact_1"]
    assert result["newFacts"] == []



def test_parse_memory_update_response_accepts_yaml_like_object():
    payload = '''user:
  personalContext:
    summary: User prefers Python over Java
    shouldUpdate: true
newFacts:
  - content: User prefers Python over Java
    category: preference
    confidence: 0.95
'''

    result = updater_module.parse_memory_update_response(payload)

    assert result["user"]["personalContext"]["summary"] == "User prefers Python over Java"
    assert result["newFacts"][0]["confidence"] == 0.95



def test_update_memory_failure_does_not_overwrite_existing_file(tmp_path, capsys, monkeypatch):
    import json
    from langchain_core.messages import AIMessage, HumanMessage

    memory_file = tmp_path / "memory.json"
    existing = updater_module._create_empty_memory()
    existing["facts"] = [
        {
            "id": "fact_existing",
            "content": "Existing fact",
            "category": "context",
            "confidence": 0.9,
            "createdAt": existing["lastUpdated"],
            "source": "thread-old",
        }
    ]
    memory_file.write_text(json.dumps(existing, ensure_ascii=False), encoding="utf-8")

    monkeypatch.setattr(updater_module, "_get_memory_file_path", lambda agent_name=None: memory_file)
    monkeypatch.setattr(
        updater_module,
        "get_memory_config",
        lambda: type(
            "Cfg",
            (),
            {
                "enabled": True,
                "model_name": None,
                "fact_confidence_threshold": 0.7,
                "max_facts": 100,
            },
        )(),
    )

    class DummyModel:
        def invoke(self, prompt: str):
            return type("Resp", (), {"content": "not json at all"})()

    monkeypatch.setattr(updater_module.MemoryUpdater, "_get_model", lambda self: DummyModel())

    updater = updater_module.MemoryUpdater()
    ok = updater.update_memory(
        [HumanMessage(content="remember this"), AIMessage(content="ok")],
        thread_id="thread-new",
    )

    assert ok is False
    current = json.loads(memory_file.read_text(encoding="utf-8"))
    assert current == existing
    out = capsys.readouterr().out
    assert "thread-new" in out
    assert "not json at all" in out


def test_update_memory_accepts_model_content_blocks(tmp_path, monkeypatch):
    import json
    from langchain_core.messages import AIMessage, HumanMessage

    memory_file = tmp_path / "memory.json"
    monkeypatch.setattr(updater_module, "_get_memory_file_path", lambda agent_name=None: memory_file)
    monkeypatch.setattr(
        updater_module,
        "get_memory_config",
        lambda: type(
            "Cfg",
            (),
            {
                "enabled": True,
                "model_name": None,
                "fact_confidence_threshold": 0.7,
                "max_facts": 100,
            },
        )(),
    )

    class DummyModel:
        def invoke(self, prompt: str):
            return type(
                "Resp",
                (),
                {
                    "content": [
                        {"signature": "sig-1", "thinking": "analyzing"},
                        {
                            "type": "text",
                            "text": '{"newFacts": [{"content": "User likes Java", "category": "preference", "confidence": 0.92}]}'
                        },
                    ]
                },
            )()

    monkeypatch.setattr(updater_module.MemoryUpdater, "_get_model", lambda self: DummyModel())

    updater = updater_module.MemoryUpdater()
    ok = updater.update_memory(
        [HumanMessage(content="我喜欢java"), AIMessage(content="好的，我记住了")],
        thread_id="thread-blocks",
    )

    assert ok is True
    current = json.loads(memory_file.read_text(encoding="utf-8"))
    assert any(f["content"] == "User likes Java" for f in current["facts"])
