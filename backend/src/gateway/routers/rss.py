"""RSS API router."""

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from src.database.models.rss import Entry, Feed
from src.services import rss_ai, rss_discovery, rss_store
from src.services.rss_parser import RSSParseError

router = APIRouter(prefix="/api/rss", tags=["rss"])


class AddFeedRequest(BaseModel):
    """Request body for subscribing to a feed."""

    url: str = Field(..., min_length=1, description="RSS/Atom URL")
    category: str = Field(default="general", description="Feed category")


class FeedMutationResponse(BaseModel):
    """Response for feed add/refresh operations."""

    feed: Feed
    imported_entries: int


class FeedListResponse(BaseModel):
    """Response for listing feeds."""

    feeds: list[Feed]


class EntryListResponse(BaseModel):
    """Response for paginated entry list."""

    entries: list[Entry]
    next_cursor: str | None = None


class UpdateEntryRequest(BaseModel):
    """Request body for entry state update."""

    read: bool | None = Field(default=None, description="Whether the entry has been read")
    starred: bool | None = Field(default=None, description="Whether the entry is starred")


class SummarizeEntryResponse(BaseModel):
    """Response payload for AI summary generation."""

    entry_id: str
    summary: str
    cached: bool


class TranslateEntryRequest(BaseModel):
    """Request body for AI translation generation."""

    target_language: str = Field(default="zh-cn", min_length=2, description="Target language code")


class TranslateEntryResponse(BaseModel):
    """Response payload for AI translation generation."""

    entry_id: str
    language: str
    content: str
    cached: bool


class DiscoverCategoryResponse(BaseModel):
    """Discover category metadata."""

    id: str
    label: str
    count: int


class DiscoverSourceResponse(BaseModel):
    """Curated source card for discover page."""

    id: str
    title: str
    feed_url: str
    site_url: str
    description: str
    category: str
    language: str
    tags: list[str]
    featured: bool


class DiscoverSourcesResponse(BaseModel):
    """Response for discover source listing."""

    categories: list[DiscoverCategoryResponse]
    sources: list[DiscoverSourceResponse]


@router.post(
    "/feeds",
    response_model=FeedMutationResponse,
    status_code=201,
    summary="Add RSS Feed",
    description="Subscribe to a new RSS/Atom feed and ingest its current entries.",
)
async def add_feed(request: AddFeedRequest) -> FeedMutationResponse:
    try:
        feed, imported_entries = rss_store.add_feed(request.url, category=request.category)
        return FeedMutationResponse(feed=feed, imported_entries=imported_entries)
    except RSSParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get(
    "/feeds",
    response_model=FeedListResponse,
    summary="List RSS Feeds",
    description="List all subscribed RSS feeds.",
)
async def list_feeds() -> FeedListResponse:
    return FeedListResponse(feeds=rss_store.list_feeds())


@router.get(
    "/feeds/{feed_id}",
    response_model=Feed,
    summary="Get RSS Feed",
    description="Get details for a subscribed feed.",
)
async def get_feed(feed_id: str) -> Feed:
    feed = rss_store.get_feed(feed_id)
    if feed is None:
        raise HTTPException(status_code=404, detail=f"Feed not found: {feed_id}")
    return feed


@router.delete(
    "/feeds/{feed_id}",
    status_code=204,
    summary="Delete RSS Feed",
    description="Unsubscribe from a feed and remove associated entries.",
)
async def delete_feed(feed_id: str) -> Response:
    deleted = rss_store.delete_feed(feed_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Feed not found: {feed_id}")
    return Response(status_code=204)


@router.post(
    "/feeds/{feed_id}/refresh",
    response_model=FeedMutationResponse,
    summary="Refresh RSS Feed",
    description="Fetch latest entries for a subscribed feed.",
)
async def refresh_feed(feed_id: str) -> FeedMutationResponse:
    try:
        feed, imported_entries = rss_store.refresh_feed(feed_id)
        return FeedMutationResponse(feed=feed, imported_entries=imported_entries)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Feed not found: {feed_id}")
    except RSSParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get(
    "/entries",
    response_model=EntryListResponse,
    summary="List Entries",
    description="List RSS entries with cursor pagination and optional filters.",
)
async def list_entries(
    feed_id: str | None = Query(default=None, description="Filter by feed ID"),
    limit: int = Query(default=20, ge=1, le=100, description="Maximum entries per page"),
    cursor: str | None = Query(default=None, description="Pagination cursor (ISO datetime)"),
    unread: bool | None = Query(default=None, description="Filter unread entries"),
    starred: bool | None = Query(default=None, description="Filter starred entries"),
) -> EntryListResponse:
    try:
        entries, next_cursor = rss_store.list_entries(
            feed_id=feed_id,
            limit=limit,
            cursor=cursor,
            unread=unread,
            starred=starred,
        )
        return EntryListResponse(entries=entries, next_cursor=next_cursor)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get(
    "/entries/{entry_id}",
    response_model=Entry,
    summary="Get Entry",
    description="Get a single RSS entry.",
)
async def get_entry(entry_id: str) -> Entry:
    entry = rss_store.get_entry(entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Entry not found: {entry_id}")
    return entry


@router.put(
    "/entries/{entry_id}",
    response_model=Entry,
    summary="Update Entry",
    description="Update entry read/starred status.",
)
async def update_entry(entry_id: str, request: UpdateEntryRequest) -> Entry:
    if request.read is None and request.starred is None:
        raise HTTPException(status_code=422, detail="At least one field ('read' or 'starred') must be provided.")
    try:
        return rss_store.update_entry(entry_id, read=request.read, starred=request.starred)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Entry not found: {entry_id}")


@router.post(
    "/entries/{entry_id}/summarize",
    response_model=SummarizeEntryResponse,
    summary="Summarize Entry",
    description="Generate and cache AI summary for an entry.",
)
async def summarize_entry(entry_id: str) -> SummarizeEntryResponse:
    entry = rss_store.get_entry(entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Entry not found: {entry_id}")

    existing_summary = rss_store.get_summary(entry_id)
    if existing_summary is not None:
        return SummarizeEntryResponse(
            entry_id=entry_id,
            summary=existing_summary.summary,
            cached=True,
        )

    content = entry.content or entry.description or entry.title
    summary_text = rss_ai.summarize_entry_content(title=entry.title, content=content)
    summary = rss_store.upsert_summary(entry_id, summary_text)
    return SummarizeEntryResponse(entry_id=entry_id, summary=summary.summary, cached=False)


@router.post(
    "/entries/{entry_id}/translate",
    response_model=TranslateEntryResponse,
    summary="Translate Entry",
    description="Generate and cache AI translation for an entry.",
)
async def translate_entry(entry_id: str, request: TranslateEntryRequest) -> TranslateEntryResponse:
    entry = rss_store.get_entry(entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Entry not found: {entry_id}")

    target_language = request.target_language.strip().lower() or "zh-cn"
    existing_translation = rss_store.get_translation(entry_id, target_language)
    if existing_translation is not None:
        return TranslateEntryResponse(
            entry_id=entry_id,
            language=existing_translation.language,
            content=existing_translation.content,
            cached=True,
        )

    content = entry.content or entry.description or entry.title
    translated = rss_ai.translate_entry_content(content=content, target_language=target_language)
    translation = rss_store.upsert_translation(entry_id, target_language, translated)
    return TranslateEntryResponse(
        entry_id=entry_id,
        language=translation.language,
        content=translation.content,
        cached=False,
    )


@router.get(
    "/discover/sources",
    response_model=DiscoverSourcesResponse,
    summary="List Discover Sources",
    description="List curated RSS sources for the discover page with category and keyword filters.",
)
async def list_discover_sources(
    q: str | None = Query(default=None, description="Keyword for fuzzy search"),
    category: str = Query(default="all", description="Discover category"),
    limit: int = Query(default=60, ge=1, le=200, description="Maximum number of sources"),
) -> DiscoverSourcesResponse:
    sources = rss_discovery.list_sources(keyword=q, category=category, limit=limit)

    counts: dict[str, int] = {"all": len(sources)}
    for source in sources:
        counts[source.category] = counts.get(source.category, 0) + 1

    categories = [
        DiscoverCategoryResponse(
            id=category_item.id,
            label=category_item.label,
            count=counts.get(category_item.id, 0),
        )
        for category_item in rss_discovery.list_categories()
    ]

    return DiscoverSourcesResponse(
        categories=categories,
        sources=[
            DiscoverSourceResponse(
                id=source.id,
                title=source.title,
                feed_url=source.feed_url,
                site_url=source.site_url,
                description=source.description,
                category=source.category,
                language=source.language,
                tags=list(source.tags),
                featured=source.featured,
            )
            for source in sources
        ],
    )
