"use client";

import {
  BookmarkCheckIcon,
  BookmarkIcon,
  CheckIcon,
  Loader2Icon,
  NewspaperIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
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

  const selectedFeedTitle = selectedFeedId
    ? feedTitleMap.get(selectedFeedId) ?? t.rssReader.allFeeds
    : t.rssReader.allFeeds;

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
  const entryRefs = useRef(new Map<string, HTMLElement>());
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);

  const openEntry = useCallback(
    (entryId: string) => {
      const query = new URLSearchParams();
      if (selectedFeedId) {
        query.set("feed", selectedFeedId);
      }
      query.set("filter", filter);
      router.push(
        `/workspace/rss/subscriptions/${entryId}?${query.toString()}`,
      );
    },
    [filter, router, selectedFeedId],
  );

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

  useEffect(() => {
    if (entries.length === 0) {
      setActiveEntryId(null);
      return;
    }
    setActiveEntryId((current) => {
      if (current && entries.some((entry) => entry.id === current)) {
        return current;
      }
      return entries[0]!.id;
    });
  }, [entries]);

  useEffect(() => {
    if (!activeEntryId) {
      return;
    }
    const node = entryRefs.current.get(activeEntryId);
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeEntryId]);

  const handleToggleRead = useCallback(
    async (entryId: string, nextRead: boolean) => {
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
    },
    [t.rssReader.entryUpdateFailed, updateEntryMutation],
  );

  const handleToggleStarred = useCallback(
    async (entryId: string, nextStarred: boolean) => {
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
    },
    [t.rssReader.entryUpdateFailed, updateEntryMutation],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (entries.length === 0) {
        return;
      }

      const key = event.key.toLowerCase();
      const currentIndex = entries.findIndex((entry) => entry.id === activeEntryId);
      const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
      const currentEntry = entries[safeCurrentIndex];
      if (!currentEntry) {
        return;
      }

      if (key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = entries[(safeCurrentIndex + 1) % entries.length];
        if (next) {
          setActiveEntryId(next.id);
        }
        return;
      }

      if (key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const nextIndex =
          safeCurrentIndex === 0 ? entries.length - 1 : safeCurrentIndex - 1;
        const next = entries[nextIndex];
        if (next) {
          setActiveEntryId(next.id);
        }
        return;
      }

      if (key === "enter" || key === "l" || event.key === "ArrowRight") {
        event.preventDefault();
        openEntry(currentEntry.id);
        return;
      }

      if (key === "m") {
        event.preventDefault();
        void handleToggleRead(currentEntry.id, !currentEntry.read);
        return;
      }

      if (key === "s") {
        event.preventDefault();
        void handleToggleStarred(currentEntry.id, !currentEntry.starred);
        return;
      }

      if (key === "o") {
        event.preventDefault();
        window.open(currentEntry.url, "_blank", "noopener,noreferrer");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeEntryId, entries, handleToggleRead, handleToggleStarred, openEntry]);

  return (
    <section className={cn("flex h-full min-h-0 flex-col", className)}>
      <header className="bg-background/80 space-y-3 border-b px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="bg-primary/10 inline-flex size-8 items-center justify-center rounded-xl border">
              <NewspaperIcon className="text-primary size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">{t.rssReader.entries}</h2>
              <p className="text-muted-foreground text-xs">{selectedFeedTitle}</p>
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                {t.rssReader.entryKeyboardHint}
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-full px-3"
            onClick={() => void refetch()}
            disabled={isRefetching}
            title={t.rssReader.refresh}
          >
            <RefreshCwIcon className={cn("size-4", isRefetching && "animate-spin")} />
            {t.rssReader.refresh}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
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
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-5xl space-y-2 p-3">
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
            entries.map((entry) => {
              const sourceTitle = feedTitleMap.get(entry.feed_id) ?? entry.feed_id;
              return (
                <article
                  key={entry.id}
                  ref={(node) => {
                    if (!node) {
                      entryRefs.current.delete(entry.id);
                      return;
                    }
                    entryRefs.current.set(entry.id, node);
                  }}
                  className={cn(
                    "group cursor-pointer rounded-2xl border p-4 transition-all duration-200",
                    "hover:bg-accent/40 hover:-translate-y-px hover:shadow-sm",
                    !entry.read
                      ? "border-primary/30 bg-primary/5"
                      : "border-border/70 bg-background/85",
                    activeEntryId === entry.id &&
                      "ring-primary/50 ring-1 ring-offset-0",
                  )}
                  onClick={() => {
                    setActiveEntryId(entry.id);
                    openEntry(entry.id);
                  }}
                  onMouseEnter={() => setActiveEntryId(entry.id)}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            entry.read
                              ? "border-border bg-muted/80 text-muted-foreground"
                              : "border-primary bg-primary text-primary-foreground",
                          )}
                        >
                          {entry.read ? t.rssReader.statusRead : t.rssReader.filterUnread}
                        </span>
                        {entry.starred && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            {t.rssReader.filterStarred}
                          </span>
                        )}
                        <span className="text-muted-foreground rounded-md border px-1.5 py-0.5 text-[11px]">
                          {sourceTitle}
                        </span>
                      </div>
                      <h3
                        className={cn(
                          "line-clamp-2 text-base leading-snug font-semibold",
                          entry.read && "text-foreground/80 font-medium",
                        )}
                      >
                        {entry.title}
                      </h3>
                      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                        <span>{formatTimeAgo(entry.published_at)}</span>
                        {entry.author && (
                          <>
                            <span>·</span>
                            <span>{entry.author}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className={cn(
                          "h-8 w-8 rounded-full border transition-colors",
                          entry.read
                            ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                            : "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                        aria-pressed={entry.read}
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
                        className={cn(
                          "h-8 w-8 rounded-full border transition-colors",
                          entry.starred
                            ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                            : "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                        aria-pressed={entry.starred}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleToggleStarred(entry.id, !entry.starred);
                        }}
                        title={entry.starred ? t.rssReader.unstar : t.rssReader.star}
                      >
                        {entry.starred ? (
                          <BookmarkCheckIcon className="size-3.5" />
                        ) : (
                          <BookmarkIcon className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <p className="text-muted-foreground line-clamp-2 text-sm">
                    {toPlainText(entry.description || entry.content)}
                  </p>
                </article>
              );
            })
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
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      className="h-7 rounded-full px-3 text-xs"
    >
      {label}
    </Button>
  );
}
