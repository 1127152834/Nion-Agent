"use client";

import { ArrowLeftIcon } from "lucide-react";
import {
  useParams,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useCallback, useEffect } from "react";

import {
  EntryReader,
  normalizeRSSEntryFilter,
  RSSNavTabs,
} from "@/components/rss";
import { Button } from "@/components/ui/button";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import { type RSSEntryFilter, useRSSEntries, useRSSEntry } from "@/core/rss";

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

export default function RSSEntryDetailPage() {
  const { t } = useI18n();
  const { entry_id } = useParams<{ entry_id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const { entry } = useRSSEntry(entry_id);
  const selectedFilter = normalizeRSSEntryFilter(searchParams.get("filter"));
  const selectedFeedId = searchParams.get("feed") ?? entry?.feed_id ?? null;
  const {
    entries,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useRSSEntries({
    feedId: selectedFeedId,
    filter: selectedFilter,
    limit: 80,
  });

  useEffect(() => {
    document.title = `${t.pages.rss} - ${t.pages.appName}`;
  }, [t.pages.rss, t.pages.appName]);

  const buildListPath = ({
    feedId,
    filter,
  }: {
    feedId?: string | null;
    filter?: RSSEntryFilter;
  }) => {
    const next = new URLSearchParams();
    if (feedId) {
      next.set("feed", feedId);
    }
    if (filter && filter !== "all") {
      next.set("filter", filter);
    }
    const query = next.toString();
    return query
      ? `/workspace/rss/subscriptions?${query}`
      : "/workspace/rss/subscriptions";
  };

  const openListPath = useCallback(() => {
    const nextPath = buildListPath({
      feedId: selectedFeedId,
      filter: selectedFilter,
    });
    router.push(nextPath);
  }, [router, selectedFeedId, selectedFilter]);

  const openEntryPath = useCallback(
    (targetEntryId: string) => {
      const next = new URLSearchParams();
      if (selectedFeedId) {
        next.set("feed", selectedFeedId);
      }
      if (selectedFilter !== "all") {
        next.set("filter", selectedFilter);
      }
      const query = next.toString();
      router.push(
        query
          ? `/workspace/rss/subscriptions/${targetEntryId}?${query}`
          : `/workspace/rss/subscriptions/${targetEntryId}`,
      );
    },
    [router, selectedFeedId, selectedFilter],
  );

  const navigateRelative = useCallback(
    async (direction: 1 | -1) => {
      if (entries.length === 0) {
        return;
      }
      const currentIndex = entries.findIndex((item) => item.id === entry_id);
      if (currentIndex < 0) {
        return;
      }

      const targetIndex = currentIndex + direction;
      if (targetIndex >= 0 && targetIndex < entries.length) {
        const nextEntry = entries[targetIndex];
        if (nextEntry) {
          openEntryPath(nextEntry.id);
        }
        return;
      }

      if (direction > 0 && hasNextPage && !isFetchingNextPage) {
        const result = await fetchNextPage();
        const expandedEntries = result.data?.pages.flatMap((page) => page.entries) ?? entries;
        const expandedCurrentIndex = expandedEntries.findIndex(
          (item) => item.id === entry_id,
        );
        const expandedNextEntry = expandedEntries[expandedCurrentIndex + 1];
        if (expandedNextEntry) {
          openEntryPath(expandedNextEntry.id);
        }
      }
    },
    [
      entries,
      entry_id,
      fetchNextPage,
      hasNextPage,
      isFetchingNextPage,
      openEntryPath,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        void navigateRelative(1);
        return;
      }
      if (key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        void navigateRelative(-1);
        return;
      }
      if (key === "b" || key === "h" || event.key === "ArrowLeft") {
        event.preventDefault();
        openListPath();
        return;
      }
      if (key === "o" && entry?.url) {
        event.preventDefault();
        window.open(entry.url, "_blank", "noopener,noreferrer");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [entry?.url, navigateRelative, openListPath]);

  return (
    <WorkspaceContainer>
      <WorkspaceBody className="min-h-0">
        <div className="flex size-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.08),transparent_45%)]">
          <RSSNavTabs className="bg-background/80 border-b backdrop-blur" />

          <div className="flex min-h-0 flex-1">
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="bg-background/70 flex items-center gap-2 border-b px-4 py-2 backdrop-blur">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={openListPath}
                >
                  <ArrowLeftIcon className="size-4" />
                  {t.rssReader.backToList}
                </Button>
                <div className="text-muted-foreground text-xs">
                  {entry_id}
                </div>
                <div className="text-muted-foreground hidden text-[11px] md:block">
                  {t.rssReader.entryDetailKeyboardHint}
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <EntryReader entryId={entry_id} />
              </div>
            </div>
          </div>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
