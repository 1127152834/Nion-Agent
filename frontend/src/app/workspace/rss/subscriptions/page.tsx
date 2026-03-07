"use client";

import { CompassIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { EntryList, normalizeRSSEntryFilter, RSSNavTabs } from "@/components/rss";
import { Button } from "@/components/ui/button";
import {
  WorkspaceBody,
  WorkspaceContainer,
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
      <WorkspaceBody className="min-h-0">
        <div className="flex size-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.08),transparent_45%)]">
          <RSSNavTabs className="bg-background/80 border-b backdrop-blur" />

          <div className="bg-background/70 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur">
            <div>
              <h2 className="text-sm font-semibold">
                {t.rssReader.subscriptionsNavTitle}
              </h2>
              <p className="text-muted-foreground text-xs">
                {t.rssReader.subscriptionsNavDescription}
              </p>
            </div>
            <Button asChild className="h-9 rounded-full px-4">
              <Link
                href="/workspace/rss/discover"
                className="inline-flex items-center gap-2"
              >
                <CompassIcon className="size-4" />
                <span>{t.rssReader.goToDiscover}</span>
              </Link>
            </Button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[332px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
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
