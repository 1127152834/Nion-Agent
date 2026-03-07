"""Relation extraction using LLM."""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


class RelationExtractor:
    """Extract relations between entities using LLM."""

    def __init__(self, llm: Any = None):
        """Initialize relation extractor.

        Args:
            llm: LLM instance for relation extraction
        """
        self.llm = llm

    async def extract_relations(
        self,
        text: str,
        entities: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Extract relations between entities.

        Args:
            text: Input text
            entities: List of entities extracted from text

        Returns:
            List of relations with source, target, type, and confidence
        """
        if not text or not entities or len(entities) < 2:
            return []

        if self.llm is None:
            logger.warning("No LLM provided, skipping relation extraction")
            return []

        try:
            entity_names = [e["name"] for e in entities]
            prompt = self._build_prompt(text, entity_names)

            response = await self._call_llm(prompt)
            relations = self._parse_response(response)

            logger.debug(f"Extracted {len(relations)} relations")
            return relations

        except Exception as e:
            logger.error(f"Relation extraction failed: {e}")
            return []

    def _build_prompt(self, text: str, entity_names: list[str]) -> str:
        """Build prompt for LLM."""
        return f"""Extract relationships between entities in the following text.

Text: {text}

Entities: {', '.join(entity_names)}

Return a JSON array of relationships in this format:
[
  {{"source": "entity1", "target": "entity2", "type": "relationship_type", "confidence": 0.9}}
]

Common relationship types: works_on, prefers, knows, manages, uses, creates, belongs_to, related_to

Only return the JSON array, no other text."""

    async def _call_llm(self, prompt: str) -> str:
        """Call LLM with prompt."""
        try:
            # Try async invoke
            if hasattr(self.llm, "ainvoke"):
                response = await self.llm.ainvoke(prompt)
            # Fallback to sync invoke
            elif hasattr(self.llm, "invoke"):
                response = self.llm.invoke(prompt)
            else:
                raise ValueError("LLM does not have invoke or ainvoke method")

            # Extract content from response
            if hasattr(response, "content"):
                return response.content
            return str(response)

        except Exception as e:
            logger.error(f"LLM call failed: {e}")
            raise

    def _parse_response(self, response: str) -> list[dict[str, Any]]:
        """Parse LLM response to extract relations."""
        try:
            # Try to find JSON array in response
            start = response.find("[")
            end = response.rfind("]") + 1

            if start == -1 or end == 0:
                logger.warning("No JSON array found in response")
                return []

            json_str = response[start:end]
            relations = json.loads(json_str)

            # Validate and normalize relations
            validated = []
            for rel in relations:
                if all(k in rel for k in ["source", "target", "type"]):
                    validated.append({
                        "source": rel["source"],
                        "target": rel["target"],
                        "type": rel["type"],
                        "confidence": rel.get("confidence", 0.8),
                    })

            return validated

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON response: {e}")
            return []
        except Exception as e:
            logger.error(f"Failed to parse response: {e}")
            return []


__all__ = ["RelationExtractor"]
