"""Test embedding providers."""

import os

import pytest


def test_sentence_transformer_embed():
    """Test SentenceTransformer embedding."""
    pytest.importorskip("sentence_transformers")

    from src.agents.memory.search.embeddings import SentenceTransformerEmbedding

    provider = SentenceTransformerEmbedding(model_name="all-MiniLM-L6-v2")

    text = "This is a test sentence."
    embedding = provider.embed(text)

    assert isinstance(embedding, list)
    assert len(embedding) == 384  # MiniLM-L6-v2 dimension
    assert all(isinstance(x, float) for x in embedding)


def test_sentence_transformer_embed_batch():
    """Test batch embedding."""
    pytest.importorskip("sentence_transformers")

    from src.agents.memory.search.embeddings import SentenceTransformerEmbedding

    provider = SentenceTransformerEmbedding(model_name="all-MiniLM-L6-v2")

    texts = ["First sentence.", "Second sentence.", "Third sentence."]
    embeddings = provider.embed_batch(texts)

    assert isinstance(embeddings, list)
    assert len(embeddings) == 3
    assert all(len(emb) == 384 for emb in embeddings)


@pytest.mark.skipif(
    not os.getenv("OPENAI_API_KEY"),
    reason="OpenAI API key not available",
)
def test_openai_embed():
    """Test OpenAI embedding."""
    pytest.importorskip("openai")

    from src.agents.memory.search.embeddings import OpenAIEmbedding

    provider = OpenAIEmbedding(
        model="text-embedding-3-small",
        api_key=os.getenv("OPENAI_API_KEY"),
    )

    text = "This is a test sentence."
    embedding = provider.embed(text)

    assert isinstance(embedding, list)
    assert len(embedding) == 1536  # text-embedding-3-small dimension
    assert all(isinstance(x, float) for x in embedding)


@pytest.mark.skipif(
    not os.getenv("OPENAI_API_KEY"),
    reason="OpenAI API key not available",
)
def test_openai_embed_batch():
    """Test OpenAI batch embedding."""
    pytest.importorskip("openai")

    from src.agents.memory.search.embeddings import OpenAIEmbedding

    provider = OpenAIEmbedding(
        model="text-embedding-3-small",
        api_key=os.getenv("OPENAI_API_KEY"),
    )

    texts = ["First sentence.", "Second sentence."]
    embeddings = provider.embed_batch(texts)

    assert isinstance(embeddings, list)
    assert len(embeddings) == 2
    assert all(len(emb) == 1536 for emb in embeddings)
