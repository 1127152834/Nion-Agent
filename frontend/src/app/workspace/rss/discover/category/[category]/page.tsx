"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { DiscoverPanel, RSSNavTabs } from "@/components/rss";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";

import { buildRSSDiscoverPath } from "../../routing";

export default function RSSDiscoverCategoryPage() {
  const { t } = useI18n();
  const params = useParams<{ category: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const keyword = searchParams.get("q") ?? "";
  const category = (params.category ?? "all").trim().toLowerCase();

  useEffect(() => {
    document.title = `${t.rssReader.discoverTitle} - ${t.pages.appName}`;
  }, [t.pages.appName, t.rssReader.discoverTitle]);

  useEffect(() => {
    if (category === "all") {
      router.replace(buildRSSDiscoverPath("all", keyword));
    }
  }, [category, keyword, router]);

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
              onKeywordChange={(q) =>
                router.replace(buildRSSDiscoverPath(category, q))
              }
              onCategoryChange={(nextCategory) =>
                router.replace(buildRSSDiscoverPath(nextCategory, keyword))
              }
            />
          </div>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
