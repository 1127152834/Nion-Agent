"""RSS domain models."""

from datetime import datetime

from pydantic import BaseModel, Field


class Feed(BaseModel):
    """Subscribed RSS feed."""

    id: str = Field(..., description="Feed identifier")
    title: str = Field(..., description="Feed title")
    url: str = Field(..., description="RSS/Atom feed URL")
    site_url: str | None = Field(default=None, description="Website URL")
    description: str | None = Field(default=None, description="Feed description")
    image: str | None = Field(default=None, description="Feed image URL")
    category: str = Field(default="general", description="Feed category")
    created_at: datetime = Field(..., description="Creation time")
    updated_at: datetime = Field(..., description="Last update time")
    last_refreshed_at: datetime | None = Field(default=None, description="Last refresh timestamp")
    entry_count: int = Field(default=0, description="Total entry count")


class Entry(BaseModel):
    """Single article/item from a feed."""

    id: str = Field(..., description="Entry identifier")
    feed_id: str = Field(..., description="Owning feed ID")
    title: str = Field(..., description="Entry title")
    url: str = Field(..., description="Entry URL")
    content: str = Field(default="", description="Entry content HTML/plain text")
    description: str = Field(default="", description="Entry summary")
    author: str | None = Field(default=None, description="Entry author")
    published_at: datetime = Field(..., description="Published timestamp")
    read: bool = Field(default=False, description="Read status")
    starred: bool = Field(default=False, description="Starred status")
    created_at: datetime = Field(..., description="Creation time")
    updated_at: datetime = Field(..., description="Last update time")


class Summary(BaseModel):
    """AI summary for an entry."""

    id: str = Field(..., description="Summary identifier")
    entry_id: str = Field(..., description="Entry ID")
    summary: str = Field(..., description="Summary content")
    created_at: datetime = Field(..., description="Creation time")
    updated_at: datetime = Field(..., description="Last update time")


class Translation(BaseModel):
    """AI translation for an entry."""

    id: str = Field(..., description="Translation identifier")
    entry_id: str = Field(..., description="Entry ID")
    language: str = Field(..., description="Target language")
    content: str = Field(..., description="Translated content")
    created_at: datetime = Field(..., description="Creation time")
    updated_at: datetime = Field(..., description="Last update time")


class ParsedEntry(BaseModel):
    """Entry payload parsed from RSS feed before persistence."""

    title: str
    url: str
    content: str = ""
    description: str = ""
    author: str | None = None
    published_at: datetime


class ParsedFeedResult(BaseModel):
    """Parsed feed metadata and entries payload."""

    title: str
    url: str
    site_url: str | None = None
    description: str | None = None
    image: str | None = None
    entries: list[ParsedEntry] = Field(default_factory=list)

