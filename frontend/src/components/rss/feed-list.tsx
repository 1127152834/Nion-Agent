"use client";

import {
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  RssIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";
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

  const totalEntries = useMemo(
    () => feeds.reduce((sum, feed) => sum + feed.entry_count, 0),
    [feeds],
  );

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

  return (
    <section className={cn("flex h-full min-h-0 flex-col border-r", className)}>
      <header className="flex items-center justify-between gap-2 border-b px-3 py-3">
        <div className="flex items-center gap-2">
          <RssIcon className="text-primary size-4" />
          <div className="text-sm font-semibold">{t.rssReader.title}</div>
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
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2">
          <button
            type="button"
            onClick={() => onSelectFeed(null)}
            className={cn(
              "hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors",
              !selectedFeedId && "bg-accent text-accent-foreground",
            )}
          >
            <span className="truncate">{t.rssReader.allFeeds}</span>
            <span className="text-muted-foreground rounded-md border px-1.5 py-0.5 text-xs tabular-nums">
              {totalEntries}
            </span>
          </button>

          {isLoading ? (
            <div className="text-muted-foreground px-2 py-6 text-center text-sm">
              {t.common.loading}
            </div>
          ) : feeds.length === 0 ? (
            <div className="text-muted-foreground px-2 py-6 text-center text-sm">
              {t.rssReader.emptyFeeds}
            </div>
          ) : (
            feeds.map((feed) => (
              <div
                key={feed.id}
                className={cn(
                  "group hover:bg-accent/60 rounded-md border px-2 py-2 transition-colors",
                  selectedFeedId === feed.id &&
                    "bg-accent border-accent-foreground/20",
                )}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => onSelectFeed(feed.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {feed.title}
                    </span>
                    <span className="text-muted-foreground rounded-md border px-1.5 py-0.5 text-xs tabular-nums">
                      {feed.entry_count}
                    </span>
                  </div>
                  {feed.site_url && (
                    <div className="text-muted-foreground mt-1 truncate text-xs">
                      {feed.site_url}
                    </div>
                  )}
                </button>
                <div className="mt-2 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
            ))
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
