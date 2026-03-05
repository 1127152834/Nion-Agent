import { getBackendBaseURL } from "@/core/config";

import type {
  AddRSSFeedRequest,
  RSSFeed,
  RSSFeedListResponse,
  RSSFeedMutationResponse,
  RSSEntry,
  RSSEntryListResponse,
  ListRSSEntriesParams,
  UpdateRSSEntryRequest,
} from "./types";

async function parseJSONOrNull(response: Response) {
  return response.json().catch(() => null) as Promise<
    | Record<string, unknown>
    | {
        detail?: string;
      }
    | null
  >;
}

function extractErrorDetail(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  if ("detail" in data && typeof data.detail === "string") {
    return data.detail;
  }
  return undefined;
}

export async function listRSSFeeds(): Promise<RSSFeed[]> {
  const response = await fetch(`${getBackendBaseURL()}/api/rss/feeds`);
  const payload = (await parseJSONOrNull(response)) as RSSFeedListResponse | null;
  if (!response.ok) {
    throw new Error(
      extractErrorDetail(payload) ??
        `Failed to load RSS feeds (${response.status})`,
    );
  }
  return payload?.feeds ?? [];
}

export async function addRSSFeed(
  request: AddRSSFeedRequest,
): Promise<RSSFeedMutationResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/rss/feeds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const payload = (await parseJSONOrNull(response)) as RSSFeedMutationResponse | null;
  if (!response.ok) {
    throw new Error(
      extractErrorDetail(payload) ?? `Failed to add RSS feed (${response.status})`,
    );
  }
  if (!payload) {
    throw new Error("Invalid response when adding RSS feed");
  }
  return payload;
}

export async function deleteRSSFeed(feedId: string): Promise<void> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/rss/feeds/${encodeURIComponent(feedId)}`,
    {
      method: "DELETE",
    },
  );
  if (!response.ok) {
    const payload = await parseJSONOrNull(response);
    throw new Error(
      extractErrorDetail(payload) ??
        `Failed to delete RSS feed (${response.status})`,
    );
  }
}

export async function refreshRSSFeed(
  feedId: string,
): Promise<RSSFeedMutationResponse> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/rss/feeds/${encodeURIComponent(feedId)}/refresh`,
    {
      method: "POST",
    },
  );
  const payload = (await parseJSONOrNull(response)) as RSSFeedMutationResponse | null;
  if (!response.ok) {
    throw new Error(
      extractErrorDetail(payload) ??
        `Failed to refresh RSS feed (${response.status})`,
    );
  }
  if (!payload) {
    throw new Error("Invalid response when refreshing RSS feed");
  }
  return payload;
}

export async function getRSSFeed(feedId: string): Promise<RSSFeed> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/rss/feeds/${encodeURIComponent(feedId)}`,
  );
  const payload = (await parseJSONOrNull(response)) as RSSFeed | null;
  if (!response.ok) {
    throw new Error(
      extractErrorDetail(payload) ??
        `Failed to load RSS feed (${response.status})`,
    );
  }
  if (!payload) {
    throw new Error("RSS feed not found");
  }
  return payload;
}

export async function listRSSEntries(
  params: ListRSSEntriesParams = {},
): Promise<RSSEntryListResponse> {
  const search = new URLSearchParams();
  if (params.feedId) {
    search.set("feed_id", params.feedId);
  }
  if (params.limit) {
    search.set("limit", String(params.limit));
  }
  if (params.cursor) {
    search.set("cursor", params.cursor);
  }
  if (params.filter === "unread") {
    search.set("unread", "true");
  }
  if (params.filter === "starred") {
    search.set("starred", "true");
  }

  const query = search.toString();
  const response = await fetch(
    `${getBackendBaseURL()}/api/rss/entries${query ? `?${query}` : ""}`,
  );
  const payload = (await parseJSONOrNull(response)) as RSSEntryListResponse | null;
  if (!response.ok) {
    throw new Error(
      extractErrorDetail(payload) ??
        `Failed to load RSS entries (${response.status})`,
    );
  }
  return {
    entries: payload?.entries ?? [],
    next_cursor: payload?.next_cursor ?? null,
  };
}

export async function getRSSEntry(entryId: string): Promise<RSSEntry> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/rss/entries/${encodeURIComponent(entryId)}`,
  );
  const payload = (await parseJSONOrNull(response)) as RSSEntry | null;
  if (!response.ok) {
    throw new Error(
      extractErrorDetail(payload) ??
        `Failed to load RSS entry (${response.status})`,
    );
  }
  if (!payload) {
    throw new Error("RSS entry not found");
  }
  return payload;
}

export async function updateRSSEntry(
  entryId: string,
  request: UpdateRSSEntryRequest,
): Promise<RSSEntry> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/rss/entries/${encodeURIComponent(entryId)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  const payload = (await parseJSONOrNull(response)) as RSSEntry | null;
  if (!response.ok) {
    throw new Error(
      extractErrorDetail(payload) ??
        `Failed to update RSS entry (${response.status})`,
    );
  }
  if (!payload) {
    throw new Error("Invalid response when updating RSS entry");
  }
  return payload;
}
