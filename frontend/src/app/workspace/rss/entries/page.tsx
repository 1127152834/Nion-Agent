"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { EntryList, FeedList, normalizeRSSEntryFilter } from "@/components/rss";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import type { RSSEntryFilter } from "@/core/rss";

export default function RSSEntriesPage() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selectedFeedId = searchParams.get("feed");
  const selectedFilter = normalizeRSSEntryFilter(searchParams.get("filter"));

  useEffect(() => {
    document.title = `${t.pages.rss} - ${t.pages.appName}`;
  }, [t.pages.rss, t.pages.appName]);

  const updateQuery = ({
    feedId,
    filter,
  }: {
    feedId?: string | null;
    filter?: RSSEntryFilter;
  }) => {
    const next = new URLSearchParams(searchParams.toString());
    if (feedId) {
      next.set("feed", feedId);
    } else {
      next.delete("feed");
    }
    if (filter && filter !== "all") {
      next.set("filter", filter);
    } else {
      next.delete("filter");
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody className="min-h-0">
        <div className="grid size-full min-h-0 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
          <FeedList
            selectedFeedId={selectedFeedId}
            onSelectFeed={(feedId) =>
              updateQuery({
                feedId,
                filter: selectedFilter,
              })
            }
          />
          <EntryList
            selectedFeedId={selectedFeedId}
            filter={selectedFilter}
            onFilterChange={(filter) =>
              updateQuery({
                feedId: selectedFeedId,
                filter,
              })
            }
          />
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
