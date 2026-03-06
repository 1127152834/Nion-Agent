"use client";

import {
  BookmarkIcon,
  CheckIcon,
  Loader2Icon,
  NewspaperIcon,
  SparklesIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/core/i18n/hooks";
import {
  type RSSEntryFilter,
  useRSSEntries,
  useRSSFeeds,
  useUpdateRSSEntry,
} from "@/core/rss";
import { formatTimeAgo } from "@/core/utils/datetime";
import { cn } from "@/lib/utils";

function toPlainText(value: string, limit = 180): string {
  if (!value) {
    return "";
  }
  const plain = value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= limit) {
    return plain;
  }
  return `${plain.slice(0, limit)}...`;
}

function isFilter(value: string | null): value is RSSEntryFilter {
  return value === "all" || value === "unread" || value === "starred";
}

export function normalizeRSSEntryFilter(
  value: string | null | undefined,
): RSSEntryFilter {
  if (!value) {
    return "all";
  }
  return isFilter(value) ? value : "all";
}

export function EntryList({
  selectedFeedId,
  filter,
  onFilterChange,
  className,
}: {
  selectedFeedId: string | null;
  filter: RSSEntryFilter;
  onFilterChange: (filter: RSSEntryFilter) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { feeds } = useRSSFeeds();
  const feedTitleMap = useMemo(
    () => new Map(feeds.map((feed) => [feed.id, feed.title])),
    [feeds],
  );

  const {
    entries,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    error,
    refetch,
    isRefetching,
  } = useRSSEntries({
    feedId: selectedFeedId,
    filter,
    limit: 20,
  });
  const updateEntryMutation = useUpdateRSSEntry();
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasNextPage || isFetchingNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) {
          return;
        }
        void fetchNextPage();
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const handleToggleRead = async (entryId: string, nextRead: boolean) => {
    try {
      await updateEntryMutation.mutateAsync({
        entryId,
        request: { read: nextRead },
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.rssReader.entryUpdateFailed,
      );
    }
  };

  const handleToggleStarred = async (entryId: string, nextStarred: boolean) => {
    try {
      await updateEntryMutation.mutateAsync({
        entryId,
        request: { starred: nextStarred },
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.rssReader.entryUpdateFailed,
      );
    }
  };

  return (
    <section className={cn("flex h-full min-h-0 flex-col", className)}>
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <NewspaperIcon className="text-primary size-4" />
          <h2 className="text-sm font-semibold">{t.rssReader.entries}</h2>
        </div>
        <div className="flex items-center gap-1">
          <FilterButton
            active={filter === "all"}
            label={t.rssReader.filterAll}
            onClick={() => onFilterChange("all")}
          />
          <FilterButton
            active={filter === "unread"}
            label={t.rssReader.filterUnread}
            onClick={() => onFilterChange("unread")}
          />
          <FilterButton
            active={filter === "starred"}
            label={t.rssReader.filterStarred}
            onClick={() => onFilterChange("starred")}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void refetch()}
            disabled={isRefetching}
            title={t.rssReader.refresh}
          >
            <SparklesIcon
              className={cn("size-4", isRefetching && "animate-spin")}
            />
          </Button>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">
          {isLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              {t.rssReader.loadingEntries}
            </div>
          ) : error ? (
            <div className="text-destructive py-8 text-center text-sm">
              {error instanceof Error ? error.message : t.rssReader.entryLoadFailed}
            </div>
          ) : entries.length === 0 ? (
            <div className="text-muted-foreground py-10 text-center text-sm">
              {t.rssReader.emptyEntries}
            </div>
          ) : (
            entries.map((entry) => (
              <article
                key={entry.id}
                className={cn(
                  "hover:bg-accent/50 cursor-pointer rounded-xl border p-4 transition-colors",
                  !entry.read && "border-primary/30",
                )}
                onClick={() => {
                  const query = new URLSearchParams();
                  if (selectedFeedId) {
                    query.set("feed", selectedFeedId);
                  }
                  query.set("filter", filter);
                  router.push(
                    `/workspace/rss/subscriptions/${entry.id}?${query.toString()}`,
                  );
                }}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3
                      className={cn(
                        "line-clamp-2 text-base leading-snug font-semibold",
                        entry.read && "text-muted-foreground font-medium",
                      )}
                    >
                      {entry.title}
                    </h3>
                    <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                      <span>{feedTitleMap.get(entry.feed_id) ?? entry.feed_id}</span>
                      <span>·</span>
                      <span>{formatTimeAgo(entry.published_at)}</span>
                      {entry.author && (
                        <>
                          <span>·</span>
                          <span>{entry.author}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className={cn(entry.read && "text-primary")}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleToggleRead(entry.id, !entry.read);
                      }}
                      title={entry.read ? t.rssReader.markUnread : t.rssReader.markRead}
                    >
                      <CheckIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className={cn(entry.starred && "text-primary")}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleToggleStarred(entry.id, !entry.starred);
                      }}
                      title={entry.starred ? t.rssReader.unstar : t.rssReader.star}
                    >
                      <BookmarkIcon className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-muted-foreground line-clamp-2 text-sm">
                  {toPlainText(entry.description || entry.content)}
                </p>
              </article>
            ))
          )}

          {hasNextPage && (
            <div
              ref={loadMoreRef}
              className="text-muted-foreground flex items-center justify-center gap-2 py-4 text-sm"
            >
              {isFetchingNextPage ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  {t.rssReader.loadingMore}
                </>
              ) : (
                t.rssReader.loadMoreHint
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}

function FilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant={active ? "default" : "ghost"}
      size="sm"
      onClick={onClick}
      className="h-8 px-2.5 text-xs"
    >
      {label}
    </Button>
  );
}
