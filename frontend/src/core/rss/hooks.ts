import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  addRSSFeed,
  deleteRSSFeed,
  getRSSEntry,
  getRSSFeed,
  listRSSHubRoutes,
  previewRSSDiscoverSource,
  listRSSDiscoverSources,
  listRSSEntries,
  listRSSFeeds,
  parseRSSOPML,
  fetchRSSEntryReadability,
  refreshRSSFeed,
  summarizeRSSEntry,
  translateRSSEntry,
  updateRSSEntry,
} from "./api";
import type {
  AddRSSFeedRequest,
  ListRSSDiscoverSourcesParams,
  ListRSSHubRoutesParams,
  PreviewRSSDiscoverSourceParams,
  ListRSSEntriesParams,
  RSSEntryFilter,
  TranslateRSSEntryRequest,
  UpdateRSSEntryRequest,
} from "./types";

const RSS_FEEDS_QUERY_KEY = ["rss", "feeds"] as const;
const RSS_ENTRIES_QUERY_KEY = ["rss", "entries"] as const;
const RSS_DISCOVER_QUERY_KEY = ["rss", "discover"] as const;
const RSSHUB_ROUTES_QUERY_KEY = ["rss", "rsshub", "routes"] as const;

export function useRSSFeeds() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: RSS_FEEDS_QUERY_KEY,
    queryFn: () => listRSSFeeds(),
  });

  return {
    feeds: data ?? [],
    isLoading,
    error,
    refetch,
    isRefetching,
  };
}

export function useRSSFeed(feedId: string | null | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: [...RSS_FEEDS_QUERY_KEY, feedId],
    queryFn: () => getRSSFeed(feedId!),
    enabled: !!feedId,
  });

  return {
    feed: data ?? null,
    isLoading,
    error,
  };
}

export function useAddRSSFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: AddRSSFeedRequest) => addRSSFeed(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RSS_FEEDS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: RSS_ENTRIES_QUERY_KEY });
    },
  });
}

export function useDeleteRSSFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (feedId: string) => deleteRSSFeed(feedId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RSS_FEEDS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: RSS_ENTRIES_QUERY_KEY });
    },
  });
}

export function useRefreshRSSFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (feedId: string) => refreshRSSFeed(feedId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RSS_FEEDS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: RSS_ENTRIES_QUERY_KEY });
    },
  });
}

function buildEntriesParams(
  params: Pick<ListRSSEntriesParams, "feedId" | "filter" | "limit"> & {
    cursor?: string | null;
  },
) {
  return {
    feedId: params.feedId ?? null,
    filter: params.filter ?? "all",
    limit: params.limit ?? 20,
    cursor: params.cursor ?? null,
  } satisfies ListRSSEntriesParams;
}

export function useRSSEntries({
  feedId,
  filter = "all",
  limit = 20,
}: {
  feedId?: string | null;
  filter?: RSSEntryFilter;
  limit?: number;
}) {
  const query = useInfiniteQuery({
    queryKey: [...RSS_ENTRIES_QUERY_KEY, feedId ?? "__all__", filter, limit],
    queryFn: ({ pageParam }) =>
      listRSSEntries(buildEntriesParams({ feedId, filter, limit, cursor: pageParam })),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];

  return {
    ...query,
    entries,
    nextCursor: query.data?.pages.at(-1)?.next_cursor ?? null,
  };
}

export function useRSSEntry(entryId: string | null | undefined) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...RSS_ENTRIES_QUERY_KEY, "detail", entryId],
    queryFn: () => getRSSEntry(entryId!),
    enabled: !!entryId,
  });

  return {
    entry: data ?? null,
    isLoading,
    error,
    refetch,
  };
}

export function useUpdateRSSEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      entryId,
      request,
    }: {
      entryId: string;
      request: UpdateRSSEntryRequest;
    }) => updateRSSEntry(entryId, request),
    onSuccess: (_entry, { entryId }) => {
      void queryClient.invalidateQueries({ queryKey: RSS_ENTRIES_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: [...RSS_ENTRIES_QUERY_KEY, "detail", entryId],
      });
      void queryClient.invalidateQueries({ queryKey: RSS_FEEDS_QUERY_KEY });
    },
  });
}

export function useSummarizeRSSEntry() {
  return useMutation({
    mutationFn: (entryId: string) => summarizeRSSEntry(entryId),
  });
}

export function useRSSEntryReadability() {
  return useMutation({
    mutationFn: (entryId: string) => fetchRSSEntryReadability(entryId),
  });
}

export function useTranslateRSSEntry() {
  return useMutation({
    mutationFn: ({
      entryId,
      request,
    }: {
      entryId: string;
      request?: TranslateRSSEntryRequest;
    }) => translateRSSEntry(entryId, request),
  });
}

export function useRSSDiscoverSources(params: ListRSSDiscoverSourcesParams) {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: [
      ...RSS_DISCOVER_QUERY_KEY,
      params.q ?? "",
      params.category ?? "all",
      params.language ?? "all",
      params.limit ?? 60,
    ],
    queryFn: () => listRSSDiscoverSources(params),
  });

  return {
    categories: data?.categories ?? [],
    sources: data?.sources ?? [],
    isLoading,
    error,
    refetch,
    isRefetching,
  };
}

export function useRSSHubRoutes(params: ListRSSHubRoutesParams) {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: [
      ...RSSHUB_ROUTES_QUERY_KEY,
      params.q ?? "",
      params.category ?? "all",
      params.limit ?? 80,
    ],
    queryFn: () => listRSSHubRoutes(params),
  });

  return {
    routes: data?.routes ?? [],
    isLoading,
    error,
    refetch,
    isRefetching,
  };
}

export function useParseRSSOPML() {
  return useMutation({
    mutationFn: (file: File) => parseRSSOPML(file),
  });
}

export function usePreviewRSSDiscoverSource() {
  return useMutation({
    mutationFn: (params: PreviewRSSDiscoverSourceParams) =>
      previewRSSDiscoverSource(params),
  });
}
