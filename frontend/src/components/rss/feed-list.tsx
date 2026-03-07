"use client";

import {
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  RssIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/core/i18n/hooks";
import {
  useAddRSSFeed,
  useDeleteRSSFeed,
  useRefreshRSSFeed,
  useRSSFeeds,
} from "@/core/rss";
import { cn } from "@/lib/utils";

function normalize(value: string) {
  return value.trim().toLowerCase();
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

export function FeedList({
  selectedFeedId,
  onSelectFeed,
  className,
}: {
  selectedFeedId: string | null;
  onSelectFeed: (feedId: string | null) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const { feeds, isLoading, refetch, isRefetching } = useRSSFeeds();
  const addFeedMutation = useAddRSSFeed();
  const refreshFeedMutation = useRefreshRSSFeed();
  const deleteFeedMutation = useDeleteRSSFeed();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [feedURL, setFeedURL] = useState("");
  const [category, setCategory] = useState("general");
  const [feedQuery, setFeedQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [isScopeActive, setIsScopeActive] = useState(false);

  const totalEntries = useMemo(
    () => feeds.reduce((sum, feed) => sum + feed.entry_count, 0),
    [feeds],
  );

  const feedTargets = useMemo(
    () => [null, ...feeds.map((feed) => feed.id)],
    [feeds],
  );

  const filteredFeeds = useMemo(() => {
    const query = normalize(feedQuery);
    if (!query) {
      return feeds;
    }

    return feeds.filter((feed) => {
      const haystack = `${feed.title} ${feed.site_url ?? ""} ${feed.url} ${feed.category}`;
      return normalize(haystack).includes(query);
    });
  }, [feedQuery, feeds]);

  const submitting = addFeedMutation.isPending;

  const handleAddFeed = async () => {
    const trimmedURL = feedURL.trim();
    if (!trimmedURL) {
      toast.error(t.rssReader.feedUrlRequired);
      return;
    }

    try {
      const parsed = new URL(trimmedURL);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        toast.error(t.rssReader.feedUrlInvalid);
        return;
      }
    } catch {
      toast.error(t.rssReader.feedUrlInvalid);
      return;
    }

    try {
      const response = await addFeedMutation.mutateAsync({
        url: trimmedURL,
        category: category.trim() || "general",
      });
      toast.success(
        t.rssReader.feedAdded.replace(
          "{count}",
          String(response.imported_entries),
        ),
      );
      setDialogOpen(false);
      setFeedURL("");
      setCategory("general");
      onSelectFeed(response.feed.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t.rssReader.feedAddFailed;
      toast.error(message);
    }
  };

  const handleRefreshFeed = async (feedId: string) => {
    try {
      const response = await refreshFeedMutation.mutateAsync(feedId);
      toast.success(
        t.rssReader.feedRefreshed.replace(
          "{count}",
          String(response.imported_entries),
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t.rssReader.feedRefreshFailed;
      toast.error(message);
    }
  };

  const handleDeleteFeed = async (feedId: string, feedTitle: string) => {
    const confirmed = window.confirm(
      t.rssReader.feedDeleteConfirm.replace("{title}", feedTitle),
    );
    if (!confirmed) {
      return;
    }

    try {
      await deleteFeedMutation.mutateAsync(feedId);
      toast.success(t.rssReader.feedDeleted);
      if (selectedFeedId === feedId) {
        onSelectFeed(null);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t.rssReader.feedDeleteFailed;
      toast.error(message);
    }
  };

  const moveFeedSelection = useCallback(
    (direction: 1 | -1) => {
      if (feedTargets.length === 0) {
        return;
      }
      const currentIndex = feedTargets.findIndex((id) => id === selectedFeedId);
      const safeIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex =
        direction > 0
          ? (safeIndex + 1) % feedTargets.length
          : safeIndex === 0
            ? feedTargets.length - 1
            : safeIndex - 1;
      const nextId = feedTargets[nextIndex] ?? null;
      onSelectFeed(nextId);
    },
    [feedTargets, onSelectFeed, selectedFeedId],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isScopeActive) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveFeedSelection(1);
        return;
      }

      if (key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveFeedSelection(-1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isScopeActive, moveFeedSelection]);

  return (
    <section
      ref={sectionRef}
      className={cn(
        "bg-muted/15 flex h-full min-h-0 flex-col border-r backdrop-blur-sm",
        className,
      )}
      onMouseEnter={() => setIsScopeActive(true)}
      onMouseLeave={() => setIsScopeActive(false)}
    >
      <header className="bg-background/75 space-y-3 border-b px-3 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="bg-primary/10 inline-flex size-8 items-center justify-center rounded-xl border">
              <RssIcon className="text-primary size-4" />
            </span>
            <div>
              <div className="text-sm font-semibold">{t.rssReader.title}</div>
              <div className="text-muted-foreground text-xs">{feeds.length}</div>
              <div className="text-muted-foreground mt-0.5 text-[11px]">
                {t.rssReader.feedKeyboardHint}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void refetch()}
              disabled={isRefetching}
              title={t.rssReader.refreshAll}
            >
              <RefreshCwIcon
                className={cn("size-4", isRefetching && "animate-spin")}
              />
            </Button>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <PlusIcon className="size-4" />
                  {t.rssReader.addFeed}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t.rssReader.addFeed}</DialogTitle>
                  <DialogDescription>
                    {t.rssReader.addFeedDescription}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  <Input
                    value={feedURL}
                    onChange={(event) => setFeedURL(event.target.value)}
                    placeholder={t.rssReader.feedUrlPlaceholder}
                    disabled={submitting}
                  />
                  <Input
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    placeholder={t.rssReader.feedCategoryPlaceholder}
                    disabled={submitting}
                  />
                </div>

                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setDialogOpen(false)}
                    disabled={submitting}
                  >
                    {t.common.cancel}
                  </Button>
                  <Button onClick={() => void handleAddFeed()} disabled={submitting}>
                    {submitting && <Loader2Icon className="size-4 animate-spin" />}
                    {t.rssReader.subscribe}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="relative">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            ref={searchInputRef}
            value={feedQuery}
            onChange={(event) => setFeedQuery(event.target.value)}
            placeholder={t.common.search}
            className="h-9 pl-8"
          />
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1.5 p-2">
          <button
            type="button"
            onClick={() => onSelectFeed(null)}
            className={cn(
              "group hover:bg-accent/70 flex w-full items-center justify-between rounded-xl border px-2.5 py-2 text-left text-sm transition-all duration-200 hover:-translate-y-px",
              !selectedFeedId
                ? "border-primary/40 bg-primary/8 text-foreground"
                : "border-border/70 bg-background/70",
            )}
          >
            <span className="truncate font-medium">{t.rssReader.allFeeds}</span>
            <span className="text-muted-foreground rounded-md border px-1.5 py-0.5 text-xs tabular-nums">
              {totalEntries}
            </span>
          </button>

          {isLoading ? (
            <div className="text-muted-foreground px-2 py-6 text-center text-sm">
              {t.common.loading}
            </div>
          ) : filteredFeeds.length === 0 ? (
            <div className="text-muted-foreground px-2 py-6 text-center text-sm">
              {t.rssReader.emptyFeeds}
            </div>
          ) : (
            filteredFeeds.map((feed) => {
              const active = selectedFeedId === feed.id;
              return (
                <div
                  key={feed.id}
                  className={cn(
                    "group rounded-xl border px-2.5 py-2.5 transition-all duration-200 hover:-translate-y-px",
                    active
                      ? "border-primary/35 bg-primary/6 shadow-xs"
                      : "hover:bg-accent/60 border-border/70 bg-background/75 hover:shadow-xs",
                  )}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => onSelectFeed(feed.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="bg-muted text-muted-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold uppercase">
                          {feed.title.charAt(0)}
                        </span>
                        <div className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {feed.title}
                          </span>
                          {feed.site_url && (
                            <span className="text-muted-foreground block truncate text-xs">
                              {feed.site_url}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-muted-foreground rounded-md border px-1.5 py-0.5 text-xs tabular-nums">
                        {feed.entry_count}
                      </span>
                    </div>
                  </button>

                  <div className="mt-2 flex translate-y-1 items-center justify-end gap-1 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void handleRefreshFeed(feed.id)}
                      disabled={refreshFeedMutation.isPending}
                      title={t.rssReader.refresh}
                    >
                      <RefreshCwIcon
                        className={cn(
                          "size-3.5",
                          refreshFeedMutation.isPending && "animate-spin",
                        )}
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void handleDeleteFeed(feed.id, feed.title)}
                      disabled={deleteFeedMutation.isPending}
                      title={t.common.delete}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
