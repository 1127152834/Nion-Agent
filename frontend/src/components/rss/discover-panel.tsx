"use client";

import {
  EyeIcon,
  ExternalLinkIcon,
  FileUpIcon,
  Link2Icon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
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
  usePreviewRSSDiscoverSource,
  useRSSDiscoverSources,
  useRSSFeeds,
  useRSSHubRoutes,
} from "@/core/rss";
import type {
  OPMLSource,
  RSSDiscoverPreviewResponse,
  RSSDiscoverSource,
  RSSHubRoute,
} from "@/core/rss";
import { cn } from "@/lib/utils";

type DiscoverSortMode = "featured" | "title" | "site";

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

function resolveRSSHubRouteTemplate(
  routeTemplate: string,
  values: Record<string, string>,
) {
  return routeTemplate.replace(/:([a-zA-Z0-9_]+)/g, (_, key: string) => {
    const value = (values[key] ?? "").trim();
    if (!value) {
      return `:${key}`;
    }
    return encodeURIComponent(value);
  });
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function DiscoverPanel({
  keyword,
  category,
  language,
  onKeywordChange,
  onLanguageChange,
  onCategoryChange,
}: {
  keyword: string;
  category: string;
  language: string;
  onKeywordChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
}) {
  const { t } = useI18n();

  const [keywordInput, setKeywordInput] = useState(keyword);
  const [rsshubOpen, setRsshubOpen] = useState(false);
  const [rsshubKeyword, setRsshubKeyword] = useState("");
  const [rsshubCategory, setRsshubCategory] = useState("all");
  const [rsshubInstance, setRsshubInstance] = useState("https://rsshub.app");
  const [rsshubRoute, setRsshubRoute] = useState("");
  const [selectedRSSHubRoute, setSelectedRSSHubRoute] =
    useState<RSSHubRoute | null>(null);
  const [rsshubRouteParams, setRsshubRouteParams] = useState<
    Record<string, string>
  >({});

  const [opmlOpen, setOpmlOpen] = useState(false);
  const [opmlFilter, setOpmlFilter] = useState("");
  const [opmlSources, setOpmlSources] = useState<OPMLSource[]>([]);
  const [selectedOPMLFeeds, setSelectedOPMLFeeds] = useState<Set<string>>(
    new Set(),
  );
  const [importingOPML, setImportingOPML] = useState(false);
  const [sortMode, setSortMode] = useState<DiscoverSortMode>("featured");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSource, setPreviewSource] = useState<RSSDiscoverSource | null>(
    null,
  );
  const [previewData, setPreviewData] = useState<RSSDiscoverPreviewResponse | null>(
    null,
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const { categories, sources, isLoading, isRefetching, refetch, error } =
    useRSSDiscoverSources({
      q: keyword || undefined,
      category,
      language,
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
  const previewDiscoverMutation = usePreviewRSSDiscoverSource();

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

  const sortedSources = useMemo(() => {
    const items = [...sources];
    const compareTitle = (a: RSSDiscoverSource, b: RSSDiscoverSource) =>
      a.title.localeCompare(b.title, "zh-Hans-CN", {
        sensitivity: "base",
      });
    const compareSite = (a: RSSDiscoverSource, b: RSSDiscoverSource) =>
      a.site_url.localeCompare(b.site_url, "zh-Hans-CN", {
        sensitivity: "base",
      });

    switch (sortMode) {
      case "title":
        items.sort(compareTitle);
        break;
      case "site":
        items.sort(compareSite);
        break;
      default:
        items.sort((a, b) => {
          if (a.featured !== b.featured) {
            return a.featured ? -1 : 1;
          }
          return compareTitle(a, b);
        });
        break;
    }

    return items;
  }, [sortMode, sources]);

  const featuredSources = useMemo(
    () => sortedSources.filter((item) => item.featured).slice(0, 4),
    [sortedSources],
  );

  const displaySources = useMemo(() => {
    if (
      category !== "all" &&
      !keyword.trim() &&
      featuredSources.length > 0
    ) {
      const featuredIds = new Set(featuredSources.map((item) => item.id));
      return sortedSources.filter((item) => !featuredIds.has(item.id));
    }
    return sortedSources;
  }, [category, featuredSources, keyword, sortedSources]);

  useEffect(() => {
    setKeywordInput(keyword);
  }, [keyword]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key !== "/") {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
    if (!rsshubPreviewURL || /:([a-zA-Z0-9_]+)/.test(rsshubRoute)) {
      toast.error(t.rssReader.rsshubRouteRequired);
      return;
    }
    await handleSubscribe({
      feed_url: rsshubPreviewURL,
      category: "rsshub",
    });
  };

  const handlePreviewSource = async (source: RSSDiscoverSource) => {
    setPreviewSource(source);
    setPreviewOpen(true);
    setPreviewData(null);
    try {
      const payload = await previewDiscoverMutation.mutateAsync({
        url: source.feed_url,
        limit: 6,
      });
      setPreviewData(payload);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.rssReader.discoverPreviewFailed,
      );
    }
  };

  const handleSelectRSSHubRoute = (route: RSSHubRoute) => {
    const defaults = Object.fromEntries(
      route.params.map((param) => [
        param.key,
        param.default_value ?? "",
      ]),
    );
    setSelectedRSSHubRoute(route);
    setRsshubRouteParams(defaults);
    setRsshubRoute(resolveRSSHubRouteTemplate(route.route_template, defaults));
  };

  const handleRSSHubParamChange = (key: string, value: string) => {
    setRsshubRouteParams((previous) => {
      const next = { ...previous, [key]: value };
      if (selectedRSSHubRoute) {
        setRsshubRoute(
          resolveRSSHubRouteTemplate(selectedRSSHubRoute.route_template, next),
        );
      }
      return next;
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

  const renderSourceCard = (
    source: RSSDiscoverSource,
    keyPrefix = "",
    featuredCard = false,
  ) => {
    const subscribedFeed = subscribedFeedMap.get(normalizeURL(source.feed_url));
    return (
      <Card
        key={`${keyPrefix}${source.id}`}
        className={cn(
          "group relative flex flex-col justify-between gap-3 overflow-hidden rounded-xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md",
          featuredCard
            ? "border-primary/30 bg-primary/5"
            : "border-border/60 bg-card/80",
        )}
      >
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="line-clamp-1 text-base font-medium">
              {source.title}
            </CardTitle>
            {source.featured && (
              <Badge variant="secondary" className="gap-1 shrink-0">
                <SparklesIcon className="size-3" />
                {t.rssReader.discoverFeatured}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground line-clamp-2 text-sm">
            {source.description}
          </p>
        </div>

        <div className="flex items-center gap-2 pt-2">
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
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void handlePreviewSource(source)}
            disabled={previewDiscoverMutation.isPending}
          >
            <EyeIcon className="size-4" />
          </Button>
          <Button asChild size="sm" variant="ghost">
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
      </Card>
    );
  };

  // View mode: sources (feeds) vs categories
  const [viewMode, setViewMode] = useState<"sources" | "categories">(
    keyword.trim() ? "sources" : "categories",
  );

  return (
    <section className="relative flex flex-col bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.08),transparent_55%)]">
      {/* Hero Section - Centered */}
      <div className="px-6 py-8">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="mb-2 text-3xl font-bold">{t.rssReader.discoverTitle}</h1>
          <p className="text-sm text-muted-foreground">
            {t.rssReader.discoverNavDescription}
          </p>
        </div>
      </div>

      {/* Search Section - Centered */}
      <div className="mx-auto mb-6 w-full max-w-2xl px-6">
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-3">
            <div className="relative">
              <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-5 -translate-y-1/2" />
              <Input
                ref={searchInputRef}
                value={keywordInput}
                onChange={(event) => setKeywordInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleSearchSubmit();
                  }
                }}
                placeholder={t.rssReader.discoverSearchPlaceholder}
                className="h-12 pl-10 text-base"
              />
            </div>

            {/* Tools Row */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={handleSearchSubmit}
                className="rounded-full"
              >
                <SearchIcon className="size-4" />
                {t.common.search}
              </Button>

              <Dialog open={rsshubOpen} onOpenChange={setRsshubOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="rounded-full">
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
                      onChange={(event) => {
                        setRsshubRoute(event.target.value);
                        if (selectedRSSHubRoute?.params.length) {
                          setSelectedRSSHubRoute(null);
                          setRsshubRouteParams({});
                        }
                      }}
                      placeholder={t.rssReader.rsshubRoutePlaceholder}
                      readOnly={Boolean(selectedRSSHubRoute?.params.length)}
                    />
                    {selectedRSSHubRoute && (
                      <div className="space-y-2 rounded-md border p-3">
                        <div className="text-xs font-medium">
                          {t.rssReader.rsshubTemplateLabel}:{" "}
                          <code>{selectedRSSHubRoute.route_template}</code>
                        </div>
                        {selectedRSSHubRoute.params.length === 0 ? (
                          <div className="text-muted-foreground text-xs">
                            {t.rssReader.rsshubNoParamsNeeded}
                          </div>
                        ) : (
                          <div className="grid gap-2 md:grid-cols-2">
                            {selectedRSSHubRoute.params.map((param) => (
                              <label
                                key={`${selectedRSSHubRoute.id}-${param.key}`}
                                className="grid gap-1"
                              >
                                <span className="text-xs font-medium">
                                  {param.label}
                                  {param.required && (
                                    <span className="text-destructive ml-1">*</span>
                                  )}
                                </span>
                                <Input
                                  value={rsshubRouteParams[param.key] ?? ""}
                                  onChange={(event) =>
                                    handleRSSHubParamChange(param.key, event.target.value)
                                  }
                                  placeholder={param.placeholder}
                                  className="h-8"
                                />
                                {param.description && (
                                  <span className="text-muted-foreground text-[11px]">
                                    {param.description}
                                  </span>
                                )}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
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
                            onClick={() => handleSelectRSSHubRoute(route)}
                            className="hover:bg-accent flex w-full flex-col items-start gap-1 rounded-md border px-3 py-2 text-left"
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <span className="text-sm font-medium">{route.title}</span>
                              <Badge variant="outline">{route.category}</Badge>
                            </div>
                            <div className="text-muted-foreground text-xs">
                              {route.description}
                            </div>
                            <code className="text-xs">{route.route_template}</code>
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
                      disabled={
                        addFeedMutation.isPending ||
                        !rsshubPreviewURL ||
                        /:([a-zA-Z0-9_]+)/.test(rsshubRoute)
                      }
                    >
                      {t.rssReader.subscribe}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={opmlOpen} onOpenChange={setOpmlOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="rounded-full">
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
                size="sm"
                onClick={() => void refetch()}
                disabled={isRefetching}
                title={t.rssReader.refresh}
              >
                <RefreshCwIcon
                  className={cn("size-4", isRefetching && "animate-spin")}
                />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* View Toggle - Centered */}
      {keyword.trim() && (
        <div className="mb-4 flex justify-center">
          <div className="inline-flex items-center gap-1 rounded-full border bg-background/80 p-1 backdrop-blur">
            <Button
              size="sm"
              variant={viewMode === "sources" ? "default" : "ghost"}
              onClick={() => setViewMode("sources")}
              className="rounded-full"
            >
              {t.rssReader.discoverSources}
            </Button>
            <Button
              size="sm"
              variant={viewMode === "categories" ? "default" : "ghost"}
              onClick={() => setViewMode("categories")}
              className="rounded-full"
            >
              {t.rssReader.discoverCategories}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {t.rssReader.discoverPreviewTitle}
              {previewData?.title ? ` · ${previewData.title}` : ""}
            </DialogTitle>
            <DialogDescription>
              {previewSource?.feed_url ?? previewData?.feed_url}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 overflow-y-auto pr-1">
            {previewDiscoverMutation.isPending && !previewData ? (
              <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
                <Loader2Icon className="size-4 animate-spin" />
                {t.rssReader.discoverPreviewLoading}
              </div>
            ) : previewData?.entries.length ? (
              <>
                <div className="text-muted-foreground text-xs">
                  {t.rssReader.discoverPreviewRecentEntries}
                </div>
                <div className="space-y-2">
                  {previewData.entries.map((entry) => (
                    <a
                      key={`${entry.url}-${entry.published_at}`}
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:bg-accent block rounded-md border p-3"
                    >
                      <div className="line-clamp-2 text-sm font-medium">
                        {entry.title}
                      </div>
                      <div className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                        {entry.description || entry.url}
                      </div>
                    </a>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-muted-foreground py-8 text-sm">
                {t.rssReader.discoverPreviewEmpty}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreviewOpen(false)}>
              {t.common.cancel}
            </Button>
            {previewSource && (
              <Button onClick={() => void handleSubscribe(previewSource)}>
                {t.rssReader.subscribe}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-4 p-4">
        <div className="bg-background/65 flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 backdrop-blur">
          <span className="text-muted-foreground text-xs">
            {t.rssReader.discoverLanguageLabel}
          </span>
          <Button
            size="sm"
            variant={language === "all" ? "default" : "outline"}
            className="h-7 rounded-full px-2 text-xs"
            onClick={() => onLanguageChange("all")}
          >
            {t.rssReader.discoverLanguageAll}
          </Button>
          <Button
            size="sm"
            variant={language === "zh" ? "default" : "outline"}
            className="h-7 rounded-full px-2 text-xs"
            onClick={() => onLanguageChange("zh")}
          >
            {t.rssReader.discoverLanguageChinese}
          </Button>
          <Button
            size="sm"
            variant={language === "en" ? "default" : "outline"}
            className="h-7 rounded-full px-2 text-xs"
            onClick={() => onLanguageChange("en")}
          >
            {t.rssReader.discoverLanguageEnglish}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {categories.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={category === item.id ? "default" : "outline"}
                onClick={() => onCategoryChange(item.id)}
                className="h-8 rounded-full px-3"
              >
                {item.label}
                <span className="text-xs tabular-nums">{item.count}</span>
              </Button>
            ))}
          </div>

          <div className="bg-background/65 flex items-center gap-1 rounded-full border px-1 py-1 backdrop-blur">
            <span className="text-muted-foreground mr-1 text-xs">
              {t.rssReader.discoverSortLabel}
            </span>
            <Button
              size="sm"
              variant={sortMode === "featured" ? "default" : "outline"}
              className="h-7 rounded-full px-2 text-xs"
              onClick={() => setSortMode("featured")}
            >
              {t.rssReader.discoverSortFeatured}
            </Button>
            <Button
              size="sm"
              variant={sortMode === "title" ? "default" : "outline"}
              className="h-7 rounded-full px-2 text-xs"
              onClick={() => setSortMode("title")}
            >
              {t.rssReader.discoverSortTitle}
            </Button>
            <Button
              size="sm"
              variant={sortMode === "site" ? "default" : "outline"}
              className="h-7 rounded-full px-2 text-xs"
              onClick={() => setSortMode("site")}
            >
              {t.rssReader.discoverSortSite}
            </Button>
          </div>
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
          <div className="flex flex-col gap-4">
            {category !== "all" &&
              !keyword.trim() &&
              featuredSources.length > 0 && (
                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">
                      {t.rssReader.discoverFeaturedSectionTitle}
                    </h3>
                    <p className="text-muted-foreground text-xs">
                      {t.rssReader.discoverFeaturedSectionDescription}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {featuredSources.map((source) =>
                      renderSourceCard(source, "featured-", true),
                    )}
                  </div>
                </section>
              )}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {displaySources.map((source) => renderSourceCard(source))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
