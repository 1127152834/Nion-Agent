"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { EntryList, RSSNavTabs, normalizeRSSEntryFilter } from "@/components/rss";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import type { RSSEntryFilter } from "@/core/rss";

// Disable SSR for FeedList to prevent Radix UI Dialog hydration mismatch
const FeedList = dynamic(
  () => import("@/components/rss").then((mod) => ({ default: mod.FeedList })),
  { ssr: false },
);

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
        <div className="flex size-full min-h-0 flex-col">
          <RSSNavTabs />
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
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
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
