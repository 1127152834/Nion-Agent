"""RSS API router."""

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from src.database.models.rss import Entry, Feed
from src.services import rss_store
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
