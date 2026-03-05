"use client";

import {
  CompassIcon,
  ExternalLinkIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/core/i18n/hooks";
import {
  useAddRSSFeed,
  useRSSDiscoverSources,
  useRSSFeeds,
} from "@/core/rss";
import { cn } from "@/lib/utils";

function normalizeURL(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return normalized;
  }
  return normalized.replace(/\/+$/, "");
}

export function DiscoverPanel({
  keyword,
  category,
  onKeywordChange,
  onCategoryChange,
}: {
  keyword: string;
  category: string;
  onKeywordChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [keywordInput, setKeywordInput] = useState(keyword);
  const { categories, sources, isLoading, isRefetching, refetch, error } =
    useRSSDiscoverSources({
      q: keyword || undefined,
      category,
      limit: 100,
    });
  const { feeds } = useRSSFeeds();
  const addFeedMutation = useAddRSSFeed();

  const subscribedFeedMap = useMemo(
    () =>
      new Map(
        feeds.map((feed) => [normalizeURL(feed.url), { id: feed.id, title: feed.title }]),
      ),
    [feeds],
  );

  useEffect(() => {
    setKeywordInput(keyword);
  }, [keyword]);

  const handleSearchSubmit = () => {
    onKeywordChange(keywordInput.trim());
  };

  const handleSubscribe = async (source: {
    feed_url: string;
    category: string;
    title: string;
  }) => {
    const normalized = normalizeURL(source.feed_url);
    if (subscribedFeedMap.has(normalized)) {
      toast.info(t.rssReader.discoverAlreadySubscribed);
      return;
    }
    try {
      const response = await addFeedMutation.mutateAsync({
        url: source.feed_url,
        category: source.category,
      });
      toast.success(
        t.rssReader.feedAdded.replace(
          "{count}",
          String(response.imported_entries),
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.rssReader.feedAddFailed,
      );
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <CompassIcon className="text-primary size-4" />
          <h2 className="text-sm font-semibold">{t.rssReader.discoverTitle}</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-72 max-w-[60vw]">
            <SearchIcon className="text-muted-foreground absolute top-1/2 left-2 size-4 -translate-y-1/2" />
            <Input
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleSearchSubmit();
                }
              }}
              placeholder={t.rssReader.discoverSearchPlaceholder}
              className="pl-8"
            />
          </div>
          <Button size="sm" variant="outline" onClick={handleSearchSubmit}>
            <SearchIcon className="size-4" />
            {t.common.search}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void refetch()}
            disabled={isRefetching}
            title={t.rssReader.refresh}
          >
            <RefreshCwIcon
              className={cn("size-4", isRefetching && "animate-spin")}
            />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
        <div className="flex flex-wrap items-center gap-2">
          {categories.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={category === item.id ? "default" : "outline"}
              onClick={() => onCategoryChange(item.id)}
              className="rounded-full"
            >
              {item.label}
              <span className="text-xs tabular-nums">{item.count}</span>
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
            <Loader2Icon className="size-4 animate-spin" />
            {t.common.loading}
          </div>
        ) : error ? (
          <div className="text-destructive py-16 text-center text-sm">
            {error instanceof Error ? error.message : t.rssReader.discoverLoadFailed}
          </div>
        ) : sources.length === 0 ? (
          <div className="text-muted-foreground py-16 text-center text-sm">
            {t.rssReader.discoverEmpty}
          </div>
        ) : (
          <div className="grid min-h-0 grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
            {sources.map((source) => {
              const subscribedFeed = subscribedFeedMap.get(normalizeURL(source.feed_url));
              return (
                <Card key={source.id} className="gap-3 py-4">
                  <CardHeader className="space-y-2 px-4">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="line-clamp-2 text-base">
                        {source.title}
                      </CardTitle>
                      {source.featured && (
                        <Badge variant="secondary" className="gap-1">
                          <SparklesIcon className="size-3" />
                          {t.rssReader.discoverFeatured}
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground line-clamp-3 text-sm">
                      {source.description}
                    </p>
                  </CardHeader>

                  <CardContent className="space-y-3 px-4">
                    <div className="flex flex-wrap gap-1.5">
                      {source.tags.map((tag) => (
                        <Badge key={`${source.id}-${tag}`} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>

                    <div className="text-muted-foreground space-y-1 text-xs">
                      <div className="truncate">{source.site_url}</div>
                      <div className="truncate">{source.feed_url}</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        variant={subscribedFeed ? "secondary" : "default"}
                        onClick={() => void handleSubscribe(source)}
                        disabled={addFeedMutation.isPending || !!subscribedFeed}
                      >
                        {subscribedFeed
                          ? t.rssReader.discoverSubscribed
                          : t.rssReader.subscribe}
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <a
                          href={source.site_url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={t.rssReader.openOriginal}
                        >
                          <ExternalLinkIcon className="size-4" />
                        </a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
