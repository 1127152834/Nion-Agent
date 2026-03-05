"use client";

import { ArrowLeftIcon } from "lucide-react";
import {
  useParams,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useEffect } from "react";

import { EntryReader, FeedList, normalizeRSSEntryFilter } from "@/components/rss";
import { Button } from "@/components/ui/button";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import { type RSSEntryFilter, useRSSEntry } from "@/core/rss";

export default function RSSEntryDetailPage() {
  const { t } = useI18n();
  const { entry_id } = useParams<{ entry_id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const { entry } = useRSSEntry(entry_id);
  const selectedFilter = normalizeRSSEntryFilter(searchParams.get("filter"));
  const selectedFeedId = searchParams.get("feed") ?? entry?.feed_id ?? null;

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
    return query ? `/workspace/rss/entries?${query}` : "/workspace/rss/entries";
  };

  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody className="min-h-0">
        <div className="grid size-full min-h-0 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
          <FeedList
            selectedFeedId={selectedFeedId}
            onSelectFeed={(feedId) => {
              router.push(
                buildListPath({
                  feedId,
                  filter: selectedFilter,
                }),
              );
            }}
          />

          <div className="flex min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b px-4 py-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const nextPath = buildListPath({
                    feedId: selectedFeedId,
                    filter: selectedFilter,
                  });
                  router.push(nextPath);
                }}
              >
                <ArrowLeftIcon className="size-4" />
                {t.rssReader.backToList}
              </Button>
              <div className="text-muted-foreground text-xs">
                {entry_id}
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <EntryReader entryId={entry_id} />
            </div>
          </div>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
