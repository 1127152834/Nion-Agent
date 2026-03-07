"""Entity recognition using NER models."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class EntityRecognizer:
    """Extract entities from text using NER model."""

    def __init__(self, model_name: str = "dslim/bert-base-NER"):
        """Initialize entity recognizer.

        Args:
            model_name: HuggingFace model name for NER
        """
        self.model_name = model_name
        self._ner = None

    def _load_model(self):
        """Lazy load NER model."""
        if self._ner is not None:
            return

        try:
            from transformers import pipeline

            self._ner = pipeline(
                "ner",
                model=self.model_name,
                aggregation_strategy="simple",
            )
            logger.info(f"Loaded NER model: {self.model_name}")
        except ImportError:
            logger.error("transformers not installed. Run: pip install transformers torch")
            raise
        except Exception as e:
            logger.error(f"Failed to load NER model: {e}")
            raise

    def extract_entities(self, text: str) -> list[dict[str, Any]]:
        """Extract entities from text.

        Args:
            text: Input text

        Returns:
            List of entities with name, type, and score
        """
        if not text or not text.strip():
            return []

        self._load_model()

        try:
            results = self._ner(text)
            entities = []

            for entity in results:
                entities.append({
                    "name": entity["word"],
                    "type": entity["entity_group"].lower(),
                    "score": entity["score"],
                })

            logger.debug(f"Extracted {len(entities)} entities from text")
            return entities

        except Exception as e:
            logger.error(f"Entity extraction failed: {e}")
            return []


__all__ = ["EntityRecognizer"]
