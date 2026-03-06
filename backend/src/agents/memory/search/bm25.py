"""BM25 retrieval implementation."""

from __future__ import annotations

import math
import re
from collections import Counter


class BM25:
    """A simple BM25 index."""

    def __init__(self, k1: float = 1.5, b: float = 0.75) -> None:
        self.k1 = k1
        self.b = b
        self.documents: list[str] = []
        self._tokenized_docs: list[list[str]] = []
        self.doc_lengths: list[int] = []
        self.avgdl: float = 0.0
        self.idf: dict[str, float] = {}
        self.corpus_size: int = 0

    def _tokenize(self, text: str) -> list[str]:
        return re.findall(r"\w+", text.lower())

    def fit(self, documents: list[str]) -> None:
        """Build index from documents."""
        self.documents = documents
        self._tokenized_docs = [self._tokenize(doc) for doc in documents]
        self.corpus_size = len(documents)
        self.doc_lengths = [len(tokens) for tokens in self._tokenized_docs]
        self.avgdl = sum(self.doc_lengths) / self.corpus_size if self.corpus_size else 0.0
        self.idf = {}

        doc_freqs: Counter[str] = Counter()
        for tokens in self._tokenized_docs:
            for token in set(tokens):
                doc_freqs[token] += 1

        for token, df in doc_freqs.items():
            self.idf[token] = math.log((self.corpus_size - df + 0.5) / (df + 0.5) + 1.0)

    def search(self, query: str, top_k: int = 5) -> list[dict[str, float | int | str]]:
        """Search the indexed documents with BM25."""
        if not query.strip() or not self.documents:
            return []

        query_tokens = self._tokenize(query)
        if not query_tokens:
            return []

        results: list[dict[str, float | int | str]] = []

        for idx, doc in enumerate(self.documents):
            doc_tokens = self._tokenized_docs[idx]
            doc_len = self.doc_lengths[idx]
            doc_tf = Counter(doc_tokens)
            score = 0.0

            for token in query_tokens:
                idf = self.idf.get(token)
                if idf is None:
                    continue

                tf = doc_tf.get(token, 0)
                if tf == 0:
                    continue

                length_norm = 1.0 - self.b
                if self.avgdl > 0:
                    length_norm += self.b * (doc_len / self.avgdl)
                denominator = tf + self.k1 * length_norm
                score += idf * (tf * (self.k1 + 1.0)) / denominator

            if score > 0:
                results.append(
                    {
                        "idx": idx,
                        "score": score,
                        "document": doc,
                    }
                )

        results.sort(key=lambda item: float(item["score"]), reverse=True)
        return results[:top_k]


__all__ = ["BM25"]
