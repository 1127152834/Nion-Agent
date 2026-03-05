"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { DiscoverPanel, RSSNavTabs } from "@/components/rss";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";

export default function RSSDiscoverPage() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const keyword = searchParams.get("q") ?? "";
  const category = searchParams.get("category") ?? "all";

  useEffect(() => {
    document.title = `${t.rssReader.discoverTitle} - ${t.pages.appName}`;
  }, [t.pages.appName, t.rssReader.discoverTitle]);

  const updateQuery = (nextParams: { q?: string; category?: string }) => {
    const next = new URLSearchParams(searchParams.toString());
    if (typeof nextParams.q !== "undefined") {
      if (nextParams.q.trim()) {
        next.set("q", nextParams.q.trim());
      } else {
        next.delete("q");
      }
    }
    if (typeof nextParams.category !== "undefined") {
      if (nextParams.category && nextParams.category !== "all") {
        next.set("category", nextParams.category);
      } else {
        next.delete("category");
      }
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
          <div className="min-h-0 flex-1">
            <DiscoverPanel
              keyword={keyword}
              category={category}
              onKeywordChange={(q) => updateQuery({ q })}
              onCategoryChange={(nextCategory) =>
                updateQuery({ category: nextCategory })
              }
            />
          </div>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
