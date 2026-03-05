export interface RSSFeed {
  id: string;
  title: string;
  url: string;
  site_url: string | null;
  description: string | null;
  image: string | null;
  category: string;
  created_at: string;
  updated_at: string;
  last_refreshed_at: string | null;
  entry_count: number;
}

export interface RSSEntry {
  id: string;
  feed_id: string;
  title: string;
  url: string;
  content: string;
  description: string;
  author: string | null;
  published_at: string;
  read: boolean;
  starred: boolean;
  created_at: string;
  updated_at: string;
}

export interface RSSFeedListResponse {
  feeds: RSSFeed[];
}

export interface RSSFeedMutationResponse {
  feed: RSSFeed;
  imported_entries: number;
}

export interface RSSEntryListResponse {
  entries: RSSEntry[];
  next_cursor: string | null;
}

export interface AddRSSFeedRequest {
  url: string;
  category?: string;
}

export interface UpdateRSSEntryRequest {
  read?: boolean;
  starred?: boolean;
}

export type RSSEntryFilter = "all" | "unread" | "starred";

export interface ListRSSEntriesParams {
  feedId?: string | null;
  limit?: number;
  cursor?: string | null;
  filter?: RSSEntryFilter;
}
