"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { DiscoverPanel, RSSNavTabs } from "@/components/rss";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";

import { buildRSSDiscoverPath } from "./routing";

export default function RSSDiscoverPage() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();

  const keyword = searchParams.get("q") ?? "";
  const language = (searchParams.get("language") ?? "all").trim().toLowerCase();
  const category = "all";
  const legacyCategory = (searchParams.get("category") ?? "all").trim().toLowerCase();

  useEffect(() => {
    document.title = `${t.rssReader.discoverTitle} - ${t.pages.appName}`;
  }, [t.pages.appName, t.rssReader.discoverTitle]);

  useEffect(() => {
    // Backward compatibility for old query-style category URLs.
    if (legacyCategory !== "all") {
      router.replace(buildRSSDiscoverPath(legacyCategory, keyword, language));
    }
  }, [keyword, language, legacyCategory, router]);

  return (
    <WorkspaceContainer>
      <WorkspaceBody className="min-h-0 overflow-y-auto">
        <div className="flex w-full min-h-full flex-col bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.08),transparent_45%)]">
          <RSSNavTabs className="bg-background/80 border-b backdrop-blur" />

          <div className="bg-background/70 border-b px-4 py-3 backdrop-blur">
            <h2 className="text-sm font-semibold">{t.rssReader.discoverTitle}</h2>
            <p className="text-muted-foreground text-xs">
              {t.rssReader.discoverNavDescription}
            </p>
          </div>

          <DiscoverPanel
            keyword={keyword}
            category={category}
            language={language}
            onKeywordChange={(q) =>
              router.replace(buildRSSDiscoverPath(category, q, language))
            }
            onLanguageChange={(nextLanguage) =>
              router.replace(buildRSSDiscoverPath(category, keyword, nextLanguage))
            }
            onCategoryChange={(nextCategory) =>
              router.replace(buildRSSDiscoverPath(nextCategory, keyword, language))
            }
          />
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
