"use client";

import {
  ArrowRightIcon,
  CompassIcon,
  ExternalLinkIcon,
  FileUpIcon,
  Link2Icon,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/core/i18n/hooks";
import {
  useAddRSSFeed,
  useParseRSSOPML,
  useRSSDiscoverSources,
  useRSSFeeds,
  useRSSHubRoutes,
} from "@/core/rss";
import type { OPMLSource } from "@/core/rss";
import { cn } from "@/lib/utils";

const CATEGORY_VISUALS: Record<
  string,
  { emoji: string; gradientFrom: string; gradientTo: string }
> = {
  programming: {
    emoji: "💻",
    gradientFrom: "#0ea5e9",
    gradientTo: "#0284c7",
  },
  ai: {
    emoji: "🤖",
    gradientFrom: "#22c55e",
    gradientTo: "#16a34a",
  },
  design: {
    emoji: "🎨",
    gradientFrom: "#f97316",
    gradientTo: "#ea580c",
  },
  product: {
    emoji: "🧭",
    gradientFrom: "#8b5cf6",
    gradientTo: "#7c3aed",
  },
  news: {
    emoji: "🗞️",
    gradientFrom: "#ef4444",
    gradientTo: "#dc2626",
  },
  finance: {
    emoji: "📈",
    gradientFrom: "#14b8a6",
    gradientTo: "#0d9488",
  },
  science: {
    emoji: "🧪",
    gradientFrom: "#6366f1",
    gradientTo: "#4f46e5",
  },
  chinese: {
    emoji: "🀄",
    gradientFrom: "#f59e0b",
    gradientTo: "#d97706",
  },
};

function normalizeURL(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return normalized;
  }
  return normalized.replace(/\/+$/, "");
}

function buildRSSHubFeedURL(instance: string, route: string) {
  const trimmedRoute = route.trim();
  if (!trimmedRoute) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmedRoute)) {
    return trimmedRoute;
  }

  let normalizedInstance = instance.trim() || "https://rsshub.app";
  normalizedInstance = normalizedInstance.replace(/^rsshub:\/\//i, "https://");
  if (!/^https?:\/\//i.test(normalizedInstance)) {
    normalizedInstance = `https://${normalizedInstance}`;
  }
  normalizedInstance = normalizedInstance.replace(/\/+$/, "");

  let normalizedRoute = trimmedRoute.replace(/^rsshub:\/\//i, "/");
  if (!normalizedRoute.startsWith("/")) {
    normalizedRoute = `/${normalizedRoute}`;
  }

  return `${normalizedInstance}${normalizedRoute}`;
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
  const [rsshubOpen, setRsshubOpen] = useState(false);
  const [rsshubKeyword, setRsshubKeyword] = useState("");
  const [rsshubCategory, setRsshubCategory] = useState("all");
  const [rsshubInstance, setRsshubInstance] = useState("https://rsshub.app");
  const [rsshubRoute, setRsshubRoute] = useState("");

  const [opmlOpen, setOpmlOpen] = useState(false);
  const [opmlFilter, setOpmlFilter] = useState("");
  const [opmlSources, setOpmlSources] = useState<OPMLSource[]>([]);
  const [selectedOPMLFeeds, setSelectedOPMLFeeds] = useState<Set<string>>(
    new Set(),
  );
  const [importingOPML, setImportingOPML] = useState(false);

  const { categories, sources, isLoading, isRefetching, refetch, error } =
    useRSSDiscoverSources({
      q: keyword || undefined,
      category,
      limit: 100,
    });

  const {
    routes: rsshubRoutes,
    isLoading: rsshubRoutesLoading,
    isRefetching: rsshubRoutesRefetching,
  } = useRSSHubRoutes({
    q: rsshubKeyword || undefined,
    category: rsshubCategory,
    limit: 120,
  });

  const { feeds } = useRSSFeeds();
  const addFeedMutation = useAddRSSFeed();
  const parseOPMLMutation = useParseRSSOPML();

  const subscribedFeedMap = useMemo(
    () =>
      new Map(
        feeds.map((feed) => [
          normalizeURL(feed.url),
          { id: feed.id, title: feed.title },
        ]),
      ),
    [feeds],
  );

  const rsshubPreviewURL = useMemo(
    () => buildRSSHubFeedURL(rsshubInstance, rsshubRoute),
    [rsshubInstance, rsshubRoute],
  );

  const filteredOPMLSources = useMemo(() => {
    const normalizedFilter = opmlFilter.trim().toLowerCase();
    if (!normalizedFilter) {
      return opmlSources;
    }
    return opmlSources.filter((item) => {
      const haystack = [
        item.title,
        item.feed_url,
        item.site_url ?? "",
        item.category ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedFilter);
    });
  }, [opmlFilter, opmlSources]);

  const categoryCards = useMemo(
    () => categories.filter((item) => item.id !== "all"),
    [categories],
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

  const handleSubscribeFromRSSHub = async () => {
    if (!rsshubPreviewURL) {
      toast.error(t.rssReader.rsshubRouteRequired);
      return;
    }
    await handleSubscribe({
      feed_url: rsshubPreviewURL,
      category: "rsshub",
    });
  };

  const handleParseOPML = async (file: File | null) => {
    if (!file) {
      return;
    }
    try {
      const payload = await parseOPMLMutation.mutateAsync(file);
      setOpmlSources(payload.sources);
      setSelectedOPMLFeeds(
        new Set(payload.sources.map((item) => normalizeURL(item.feed_url))),
      );
      setOpmlFilter("");
      toast.success(
        t.rssReader.opmlParsed.replace("{count}", String(payload.total)),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.rssReader.opmlParseFailed,
      );
    }
  };

  const toggleOPMLSource = (feedURL: string) => {
    const key = normalizeURL(feedURL);
    setSelectedOPMLFeeds((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllFilteredOPML = () => {
    setSelectedOPMLFeeds((previous) => {
      const next = new Set(previous);
      for (const item of filteredOPMLSources) {
        next.add(normalizeURL(item.feed_url));
      }
      return next;
    });
  };

  const clearOPMLSelection = () => {
    setSelectedOPMLFeeds(new Set());
  };

  const handleImportSelectedOPML = async () => {
    if (selectedOPMLFeeds.size === 0) {
      toast.info(t.rssReader.opmlSelectAtLeastOne);
      return;
    }
    setImportingOPML(true);
    let success = 0;
    let skipped = 0;
    let failed = 0;
    try {
      for (const item of opmlSources) {
        const key = normalizeURL(item.feed_url);
        if (!selectedOPMLFeeds.has(key)) {
          continue;
        }
        if (subscribedFeedMap.has(key)) {
          skipped += 1;
          continue;
        }
        try {
          await addFeedMutation.mutateAsync({
            url: item.feed_url,
            category: item.category ?? "imported",
          });
          success += 1;
        } catch {
          failed += 1;
        }
      }
      toast.success(
        t.rssReader.opmlImportSummary
          .replace("{success}", String(success))
          .replace("{skipped}", String(skipped))
          .replace("{failed}", String(failed)),
      );
    } finally {
      setImportingOPML(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <CompassIcon className="text-primary size-4" />
          <h2 className="text-sm font-semibold">{t.rssReader.discoverTitle}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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

          <Dialog open={rsshubOpen} onOpenChange={setRsshubOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Link2Icon className="size-4" />
                {t.rssReader.rsshubTool}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
              <DialogHeader>
                <DialogTitle>{t.rssReader.rsshubDialogTitle}</DialogTitle>
                <DialogDescription>
                  {t.rssReader.rsshubDialogDescription}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-3">
                <Input
                  value={rsshubInstance}
                  onChange={(event) => setRsshubInstance(event.target.value)}
                  placeholder={t.rssReader.rsshubInstancePlaceholder}
                />
                <Input
                  value={rsshubRoute}
                  onChange={(event) => setRsshubRoute(event.target.value)}
                  placeholder={t.rssReader.rsshubRoutePlaceholder}
                />
                <div className="text-muted-foreground rounded-md border px-3 py-2 text-xs">
                  {t.rssReader.rsshubPreviewLabel}:{" "}
                  <span className="text-foreground break-all">
                    {rsshubPreviewURL || "-"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={rsshubKeyword}
                    onChange={(event) => setRsshubKeyword(event.target.value)}
                    placeholder={t.rssReader.rsshubSearchPlaceholder}
                    className="h-8 w-56"
                  />
                  <div className="flex flex-wrap items-center gap-1">
                    {categories.map((item) => (
                      <Button
                        key={`rsshub-${item.id}`}
                        size="sm"
                        variant={rsshubCategory === item.id ? "default" : "outline"}
                        className="h-7 rounded-full px-2 text-xs"
                        onClick={() => setRsshubCategory(item.id)}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="h-56 space-y-2 overflow-y-auto rounded-md border p-2">
                  {rsshubRoutesLoading || rsshubRoutesRefetching ? (
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Loader2Icon className="size-4 animate-spin" />
                      {t.common.loading}
                    </div>
                  ) : rsshubRoutes.length === 0 ? (
                    <div className="text-muted-foreground text-sm">
                      {t.rssReader.rsshubNoRoutes}
                    </div>
                  ) : (
                    rsshubRoutes.map((route) => (
                      <button
                        key={route.id}
                        type="button"
                        onClick={() => setRsshubRoute(route.route)}
                        className="hover:bg-accent flex w-full flex-col items-start gap-1 rounded-md border px-3 py-2 text-left"
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="text-sm font-medium">{route.title}</span>
                          <Badge variant="outline">{route.category}</Badge>
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {route.description}
                        </div>
                        <code className="text-xs">{route.route}</code>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setRsshubOpen(false)}>
                  {t.common.cancel}
                </Button>
                <Button
                  onClick={() => void handleSubscribeFromRSSHub()}
                  disabled={addFeedMutation.isPending || !rsshubPreviewURL}
                >
                  {t.rssReader.subscribe}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={opmlOpen} onOpenChange={setOpmlOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <FileUpIcon className="size-4" />
                {t.rssReader.opmlTool}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden">
              <DialogHeader>
                <DialogTitle>{t.rssReader.opmlDialogTitle}</DialogTitle>
                <DialogDescription>
                  {t.rssReader.opmlDialogDescription}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-3">
                <Input
                  type="file"
                  accept=".opml,.xml,text/xml,application/xml"
                  onChange={(event) =>
                    void handleParseOPML(event.target.files?.[0] ?? null)
                  }
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={opmlFilter}
                    onChange={(event) => setOpmlFilter(event.target.value)}
                    placeholder={t.rssReader.opmlFilterPlaceholder}
                    className="h-8 w-72"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAllFilteredOPML}
                    disabled={filteredOPMLSources.length === 0}
                  >
                    {t.rssReader.opmlSelectFiltered}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearOPMLSelection}
                    disabled={selectedOPMLFeeds.size === 0}
                  >
                    {t.rssReader.opmlClearSelection}
                  </Button>
                  <span className="text-muted-foreground text-xs">
                    {t.rssReader.opmlSelectedCount.replace(
                      "{count}",
                      String(selectedOPMLFeeds.size),
                    )}
                  </span>
                </div>

                <div className="h-72 space-y-1 overflow-y-auto rounded-md border p-2">
                  {parseOPMLMutation.isPending ? (
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Loader2Icon className="size-4 animate-spin" />
                      {t.common.loading}
                    </div>
                  ) : filteredOPMLSources.length === 0 ? (
                    <div className="text-muted-foreground text-sm">
                      {t.rssReader.opmlNoSource}
                    </div>
                  ) : (
                    filteredOPMLSources.map((item) => {
                      const key = normalizeURL(item.feed_url);
                      const checked = selectedOPMLFeeds.has(key);
                      const alreadySubscribed = subscribedFeedMap.has(key);
                      return (
                        <label
                          key={key}
                          className={cn(
                            "hover:bg-accent flex cursor-pointer items-start gap-2 rounded-md border px-2 py-2",
                            alreadySubscribed && "opacity-60",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleOPMLSource(item.feed_url)}
                            className="mt-1"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <div className="truncate text-sm font-medium">
                                {item.title}
                              </div>
                              {alreadySubscribed && (
                                <Badge variant="secondary">
                                  {t.rssReader.discoverSubscribed}
                                </Badge>
                              )}
                            </div>
                            <div className="text-muted-foreground truncate text-xs">
                              {item.feed_url}
                            </div>
                            {item.site_url && (
                              <div className="text-muted-foreground truncate text-xs">
                                {item.site_url}
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpmlOpen(false)}>
                  {t.common.cancel}
                </Button>
                <Button
                  onClick={() => void handleImportSelectedOPML()}
                  disabled={importingOPML || selectedOPMLFeeds.size === 0}
                >
                  {importingOPML && <Loader2Icon className="size-4 animate-spin" />}
                  {t.rssReader.opmlImportSelected}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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
        {category === "all" && !keyword.trim() && categoryCards.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">
                  {t.rssReader.discoverCategoryBoardTitle}
                </h3>
                <p className="text-muted-foreground text-xs">
                  {t.rssReader.discoverCategoryBoardDescription}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {categoryCards.map((item) => {
                const visual = CATEGORY_VISUALS[item.id] ?? {
                  emoji: "📰",
                  gradientFrom: "#64748b",
                  gradientTo: "#475569",
                };
                return (
                  <button
                    key={`card-${item.id}`}
                    type="button"
                    onClick={() => onCategoryChange(item.id)}
                    className="group relative overflow-hidden rounded-xl p-0 text-left"
                    style={{
                      backgroundImage: `linear-gradient(135deg, ${visual.gradientFrom}, ${visual.gradientTo})`,
                    }}
                  >
                    <div className="absolute -top-2 -right-1 text-5xl opacity-20 transition-transform duration-300 group-hover:scale-110">
                      {visual.emoji}
                    </div>
                    <div className="flex min-h-24 flex-col justify-between p-3">
                      <div className="text-3xl leading-none">{visual.emoji}</div>
                      <div className="space-y-0.5">
                        <div className="text-sm font-semibold text-white">
                          {item.label}
                        </div>
                        <div className="flex items-center justify-between text-xs text-white/90">
                          <span>{item.count}</span>
                          <span className="inline-flex items-center gap-1">
                            {t.rssReader.discoverExploreCategory}
                            <ArrowRightIcon className="size-3.5" />
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

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
              const subscribedFeed = subscribedFeedMap.get(
                normalizeURL(source.feed_url),
              );
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
