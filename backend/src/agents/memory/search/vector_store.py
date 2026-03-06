"""SQLite backed vector store."""

from __future__ import annotations

import json
import sqlite3
import threading
from typing import Any

import numpy as np


class VectorStore:
    """Store and query memory embeddings with SQLite."""

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._lock = threading.Lock()
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS memory_vectors (
                    id TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    category TEXT,
                    embedding BLOB NOT NULL,
                    metadata TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    access_count INTEGER DEFAULT 0
                )
                """
            )
            self._conn.commit()

    def add_vector(
        self,
        id: str,
        content: str,
        embedding: list[float],
        category: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Insert or update a vector row while preserving access statistics."""
        if not embedding:
            raise ValueError("embedding must not be empty")

        embedding_blob = np.asarray(embedding, dtype=np.float32).tobytes()
        metadata_json = json.dumps(metadata) if metadata is not None else None

        with self._lock:
            self._conn.execute(
                """
                INSERT INTO memory_vectors
                (id, content, category, embedding, metadata)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    content = excluded.content,
                    category = excluded.category,
                    embedding = excluded.embedding,
                    metadata = excluded.metadata
                """,
                (id, content, category, embedding_blob, metadata_json),
            )
            self._conn.commit()

    def search_similar(self, query_embedding: list[float], k: int = 5) -> list[dict[str, Any]]:
        """Search top-k vectors by cosine similarity."""
        if not query_embedding or k <= 0:
            return []

        query_vec = np.asarray(query_embedding, dtype=np.float32)
        query_norm = np.linalg.norm(query_vec)
        if query_norm == 0:
            return []

        with self._lock:
            cursor = self._conn.execute(
                """
                SELECT id, content, category, embedding, access_count
                FROM memory_vectors
                """
            )
            rows = cursor.fetchall()

        results: list[dict[str, Any]] = []
        for row in rows:
            stored_vec = np.frombuffer(row[3], dtype=np.float32)
            if stored_vec.shape != query_vec.shape:
                continue

            stored_norm = np.linalg.norm(stored_vec)
            if stored_norm == 0:
                continue

            similarity = float(np.dot(stored_vec, query_vec) / (stored_norm * query_norm + 1e-8))
            results.append(
                {
                    "id": row[0],
                    "content": row[1],
                    "category": row[2],
                    "similarity": similarity,
                    "access_count": row[4],
                }
            )

        results.sort(key=lambda item: item["similarity"], reverse=True)
        return results[:k]

    def update_access(self, id: str) -> None:
        """Update access counters for one memory id."""
        with self._lock:
            self._conn.execute(
                """
                UPDATE memory_vectors
                SET access_count = access_count + 1,
                    last_accessed = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (id,),
            )
            self._conn.commit()

    def delete_vector(self, id: str) -> bool:
        """Delete one vector row by id."""
        with self._lock:
            cursor = self._conn.execute(
                """
                DELETE FROM memory_vectors
                WHERE id = ?
                """,
                (id,),
            )
            self._conn.commit()
            return cursor.rowcount > 0

    def close(self) -> None:
        """Close the SQLite connection."""
        with self._lock:
            self._conn.close()


__all__ = ["VectorStore"]
