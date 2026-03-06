"""OPML parsing helpers for RSS import workflows."""

from __future__ import annotations

from dataclasses import dataclass
from xml.etree import ElementTree


@dataclass(frozen=True)
class OPMLSource:
    title: str
    feed_url: str
    site_url: str | None
    category: str | None


class OPMLParseError(ValueError):
    """Raised when OPML content is invalid or cannot be parsed."""


def parse_opml(content: bytes) -> list[OPMLSource]:
    try:
        root = ElementTree.fromstring(content)
    except ElementTree.ParseError as exc:
        raise OPMLParseError("Invalid OPML file format") from exc

    body = root.find("body")
    if body is None:
        raise OPMLParseError("Invalid OPML file: missing <body>")

    collected: dict[str, OPMLSource] = {}

    def walk(node: ElementTree.Element, inherited_category: str | None) -> None:
        for child in node:
            if child.tag.lower() != "outline":
                continue

            label = (
                child.attrib.get("title")
                or child.attrib.get("text")
                or child.attrib.get("label")
                or ""
            ).strip()

            xml_url = (child.attrib.get("xmlUrl") or child.attrib.get("xmlurl") or "").strip()
            html_url = (child.attrib.get("htmlUrl") or child.attrib.get("htmlurl") or "").strip() or None

            if xml_url:
                normalized_key = xml_url.rstrip("/").lower()
                collected[normalized_key] = OPMLSource(
                    title=label or xml_url,
                    feed_url=xml_url,
                    site_url=html_url,
                    category=inherited_category,
                )
                walk(child, inherited_category)
            else:
                next_category = label or inherited_category
                walk(child, next_category)

    walk(body, None)

    return sorted(collected.values(), key=lambda item: item.title.lower())
