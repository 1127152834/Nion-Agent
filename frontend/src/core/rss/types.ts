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

export interface RSSEntrySummaryResponse {
  entry_id: string;
  summary: string;
  cached: boolean;
}

export interface RSSEntryTranslationResponse {
  entry_id: string;
  language: string;
  content: string;
  cached: boolean;
}

export interface RSSDiscoverCategory {
  id: string;
  label: string;
  count: number;
}

export interface RSSDiscoverSource {
  id: string;
  title: string;
  feed_url: string;
  site_url: string;
  description: string;
  category: string;
  language: string;
  tags: string[];
  featured: boolean;
}

export interface RSSDiscoverSourcesResponse {
  categories: RSSDiscoverCategory[];
  sources: RSSDiscoverSource[];
}

export interface RSSHubRoute {
  id: string;
  title: string;
  route: string;
  category: string;
  description: string;
  example_url: string;
}

export interface RSSHubRoutesResponse {
  routes: RSSHubRoute[];
}

export interface OPMLSource {
  title: string;
  feed_url: string;
  site_url: string | null;
  category: string | null;
}

export interface ParseOPMLResponse {
  sources: OPMLSource[];
  total: number;
}

export interface AddRSSFeedRequest {
  url: string;
  category?: string;
}

export interface UpdateRSSEntryRequest {
  read?: boolean;
  starred?: boolean;
}

export interface TranslateRSSEntryRequest {
  target_language?: string;
}

export type RSSEntryFilter = "all" | "unread" | "starred";

export interface ListRSSEntriesParams {
  feedId?: string | null;
  limit?: number;
  cursor?: string | null;
  filter?: RSSEntryFilter;
}

export interface ListRSSDiscoverSourcesParams {
  q?: string;
  category?: string;
  language?: string;
  limit?: number;
}

export interface ListRSSHubRoutesParams {
  q?: string;
  category?: string;
  limit?: number;
}
