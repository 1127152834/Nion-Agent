"use client";

import { ArrowLeftIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { DiscoverPanel } from "@/components/rss";
import { Button } from "@/components/ui/button";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
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
      <WorkspaceHeader />
      <WorkspaceBody className="min-h-0">
        <div className="flex size-full min-h-0 flex-col">
          <div className="border-b px-4 py-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/workspace/rss/subscriptions")}
            >
              <ArrowLeftIcon className="size-4" />
              {t.rssReader.backToSubscriptions}
            </Button>
          </div>
          <div className="min-h-0 flex-1">
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
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
