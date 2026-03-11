"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BrainIcon, RotateCcwIcon, SearchIcon, ShieldCheckIcon, SlidersHorizontalIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/core/i18n/hooks";
import {
  useMemoryGovernanceStatus,
  useMemoryItems,
  useMemoryView,
} from "@/core/memory/hooks";
import type { MemoryItem } from "@/core/memory/types";
import { formatTimeAgo } from "@/core/utils/datetime";
import { cn } from "@/lib/utils";

import { SettingsSection } from "./settings-section";

function overviewNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function MemorySummaryField({
  label,
  summary,
  emptyLabel,
  expandLabel,
  collapseLabel,
}: {
  label: string;
  summary: string;
  emptyLabel: string;
  expandLabel: string;
  collapseLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const normalized = summary.trim();
  const hasValue = normalized.length > 0;
  const canExpand = normalized.length > 150;
  const displayText = !hasValue
    ? emptyLabel
    : canExpand && !expanded
      ? `${normalized.slice(0, 150).trimEnd()}…`
      : normalized;

  return (
    <div className="border-border/70 py-3 first:pt-0 last:border-b-0 last:pb-0 border-b">
      <p className="text-muted-foreground text-xs font-medium tracking-wide">{label}</p>
      <p
        className={cn(
          "mt-1 text-sm leading-6",
          hasValue ? "text-foreground" : "text-muted-foreground italic",
        )}
      >
        {displayText}
      </p>
      {canExpand ? (
        <button
          type="button"
          className="text-primary mt-1 text-xs font-medium transition-opacity hover:opacity-80"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? collapseLabel : expandLabel}
        </button>
      ) : null}
    </div>
  );
}

export function MemorySettingsPage({ onClose }: { onClose?: () => void }) {
  void onClose;
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const copy = t.settings.memory.hub;
  const loadingLabel = t.common.loading;
  const emptyLabel = t.settings.memory.empty;
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const {
    memory,
    isLoading: isMemoryLoading,
    error: memoryError,
  } = useMemoryView("global");
  const {
    items,
    isLoading: isItemsLoading,
    error: itemsError,
  } = useMemoryItems("global");
  const {
    governance,
    isLoading: isGovernanceLoading,
    error: governanceError,
  } = useMemoryGovernanceStatus();

  const statusOptions = useMemo(
    () =>
      Array.from(
        new Set(items.map((item) => item.status).filter((status): status is string => Boolean(status))),
      ).sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const typeOptions = useMemo(
    () =>
      Array.from(
        new Set(items.map((item) => item.entry_type).filter((type): type is string => Boolean(type))),
      ).sort((a, b) => a.localeCompare(b)),
    [items],
  );

  const filteredItems = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }
      if (typeFilter !== "all" && item.entry_type !== typeFilter) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      const haystack = [
        item.summary,
        item.entry_type,
        item.status,
        item.entity_refs.join(" "),
        item.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [items, searchTerm, statusFilter, typeFilter]);

  const contestedCount = governance?.contested_count ?? 0;
  const pendingCount = governance?.pending_count ?? 0;
  const itemCount = items.length;
  const factCount = memory?.facts.length ?? 0;
  const activeFilterCount = (statusFilter === "all" ? 0 : 1) + (typeFilter === "all" ? 0 : 1);
  const isInitialLoading = isMemoryLoading && !memory;
  const hasError = (memoryError ?? itemsError ?? governanceError) != null;
  const errorMessage = memoryError?.message ?? itemsError?.message ?? governanceError?.message ?? (copy.loadFailed ?? "加载失败");

  const handleRetry = () => {
    void queryClient.invalidateQueries({ queryKey: ["memory"] });
  };

  const handleClearFilters = () => {
    setStatusFilter("all");
    setTypeFilter("all");
  };

  return (
    <SettingsSection
      title={t.settings.memory.title}
      description={t.settings.memory.description}
    >
      <div className="mb-4 rounded-xl border bg-muted/35 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg border bg-background p-2">
            <BrainIcon className="text-primary size-4.5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold leading-5">
              {copy.globalOnlyTitle ?? "全局治理记忆视图"}
            </p>
            <p className="text-muted-foreground text-xs leading-5">
              {copy.globalOnlyHint ?? "此页仅展示全局共享与治理层记忆。智能体局部记忆已迁移到智能体管理页。"}
            </p>
          </div>
        </div>
      </div>

      {isInitialLoading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Card key={`memory-kpi-skeleton-${index}`}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-3 w-20" />
                </CardHeader>
                <CardContent className="pt-0">
                  <Skeleton className="h-6 w-24" />
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-28" />
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={`profile-skeleton-${index}`} className="h-12 w-full" />
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-28" />
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={`history-skeleton-${index}`} className="h-12 w-full" />
                ))}
              </CardContent>
            </Card>
          </div>
          <div className="text-muted-foreground text-sm">{loadingLabel}</div>
        </div>
      ) : hasError ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{copy.loadFailed ?? "加载失败"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-destructive text-sm">{errorMessage}</p>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleRetry}>
              <RotateCcwIcon className="size-3.5" />
              {copy.retry ?? "重试"}
            </Button>
          </CardContent>
        </Card>
      ) : !memory ? (
        <Card>
          <CardContent className="text-muted-foreground py-8 text-sm">{emptyLabel}</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {t.common.lastUpdated}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-lg font-semibold">
                {formatTimeAgo(memory.lastUpdated)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {copy.totalFacts}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-lg font-semibold">
                {overviewNumber(factCount)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {copy.totalItems}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-lg font-semibold">
                {overviewNumber(itemCount)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {copy.contestedCount}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-lg font-semibold">
                {overviewNumber(contestedCount)}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="space-y-1 pb-2">
                <CardTitle className="text-sm">{copy.profile ?? t.settings.memory.markdown.userContext}</CardTitle>
                <p className="text-muted-foreground text-xs">
                  {copy.profileHint ?? "记录与你相关的长期偏好与背景，帮助系统持续提供一致体验。"}
                </p>
              </CardHeader>
              <CardContent className="space-y-0">
                <MemorySummaryField
                  label={t.settings.memory.markdown.work}
                  summary={memory.user.workContext.summary}
                  emptyLabel={copy.emptySummary ?? "暂无"}
                  expandLabel={copy.showMore ?? "展开"}
                  collapseLabel={copy.showLess ?? "收起"}
                />
                <MemorySummaryField
                  label={t.settings.memory.markdown.personal}
                  summary={memory.user.personalContext.summary}
                  emptyLabel={copy.emptySummary ?? "暂无"}
                  expandLabel={copy.showMore ?? "展开"}
                  collapseLabel={copy.showLess ?? "收起"}
                />
                <MemorySummaryField
                  label={t.settings.memory.markdown.topOfMind}
                  summary={memory.user.topOfMind.summary}
                  emptyLabel={copy.emptySummary ?? "暂无"}
                  expandLabel={copy.showMore ?? "展开"}
                  collapseLabel={copy.showLess ?? "收起"}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="space-y-1 pb-2">
                <CardTitle className="text-sm">{t.settings.memory.markdown.historyBackground}</CardTitle>
                <p className="text-muted-foreground text-xs">
                  {copy.historyHint ?? "沉淀跨会话的历史语境，减少重复说明并增强连续性。"}
                </p>
              </CardHeader>
              <CardContent className="space-y-0">
                <MemorySummaryField
                  label={t.settings.memory.markdown.recentMonths}
                  summary={memory.history.recentMonths.summary}
                  emptyLabel={copy.emptySummary ?? "暂无"}
                  expandLabel={copy.showMore ?? "展开"}
                  collapseLabel={copy.showLess ?? "收起"}
                />
                <MemorySummaryField
                  label={t.settings.memory.markdown.earlierContext}
                  summary={memory.history.earlierContext.summary}
                  emptyLabel={copy.emptySummary ?? "暂无"}
                  expandLabel={copy.showMore ?? "展开"}
                  collapseLabel={copy.showLess ?? "收起"}
                />
                <MemorySummaryField
                  label={t.settings.memory.markdown.longTermBackground}
                  summary={memory.history.longTermBackground.summary}
                  emptyLabel={copy.emptySummary ?? "暂无"}
                  expandLabel={copy.showMore ?? "展开"}
                  collapseLabel={copy.showLess ?? "收起"}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="space-y-1 pb-2">
              <CardTitle className="text-sm">{copy.governance ?? "治理队列"}</CardTitle>
              <p className="text-muted-foreground text-xs">
                {copy.governanceHint ?? "系统会在后台自动整理候选记忆并处理冲突，此处仅展示只读状态。"}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary">
                  {(copy.pendingCount ?? "待处理") + `: ${pendingCount || (isGovernanceLoading ? "..." : 0)}`}
                </Badge>
                <Badge variant={contestedCount > 0 ? "destructive" : "secondary"}>
                  {(copy.contestedCount ?? "冲突") + `: ${contestedCount || (isGovernanceLoading ? "..." : 0)}`}
                </Badge>
                <span className="text-muted-foreground">
                  {(copy.lastRun ?? "最近运行") + `: ${governance?.last_run_at ? formatTimeAgo(governance.last_run_at) : "-"}`}
                </span>
              </div>

              {isGovernanceLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={`governance-item-skeleton-${index}`} className="h-12 w-full" />
                  ))}
                </div>
              ) : (governance?.queue?.length ?? 0) === 0 ? (
                <div className="text-muted-foreground text-sm">{copy.emptyQueue ?? "治理队列为空"}</div>
              ) : (
                <div className="space-y-2">
                  {(governance?.queue ?? []).slice(0, 8).map((item) => (
                    <div key={item.decision_id} className="rounded-lg border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{item.status}</Badge>
                        <span className="text-muted-foreground text-xs">{item.source_scope || "global"}</span>
                      </div>
                      <p className="text-muted-foreground mt-1 text-xs leading-5">{item.reason || "-"}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-3 pb-2">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-sm">{copy.entries ?? copy.library ?? "Memory Entries"}</CardTitle>
                <Badge variant="outline">{filteredItems.length}/{itemCount}</Badge>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
                  <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 size-4" />
                  <Input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="pl-9"
                    placeholder={copy.searchPlaceholder ?? t.common.search}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1.5">
                        <SlidersHorizontalIcon className="size-3.5" />
                        {copy.filterButton ?? "筛选"}
                        {activeFilterCount > 0 ? (
                          <Badge variant="secondary" className="ml-1 text-[11px]">
                            {activeFilterCount}
                          </Badge>
                        ) : null}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 p-3">
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <p className="text-muted-foreground text-xs font-medium">
                            {copy.filterStatus ?? "状态"}
                          </p>
                          <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">{copy.filterAll ?? "全部"}</SelectItem>
                              {statusOptions.map((status) => (
                                <SelectItem key={status} value={status}>
                                  {status}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-muted-foreground text-xs font-medium">
                            {copy.filterType ?? "类型"}
                          </p>
                          <Select value={typeFilter} onValueChange={setTypeFilter}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">{copy.filterAll ?? "全部"}</SelectItem>
                              {typeOptions.map((entryType) => (
                                <SelectItem key={entryType} value={entryType}>
                                  {entryType}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleClearFilters}
                            disabled={activeFilterCount === 0}
                          >
                            {copy.clearFilters ?? "清空筛选"}
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>

                  {activeFilterCount > 0 ? (
                    <span className="text-muted-foreground text-xs">
                      {(copy.filterApplied ?? "已筛选") + ` ${activeFilterCount}`}
                    </span>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {isItemsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={`entry-skeleton-${index}`} className="h-24 w-full" />
                  ))}
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="text-muted-foreground text-sm">{copy.noResults ?? emptyLabel}</div>
              ) : (
                filteredItems.slice(0, 50).map((item: MemoryItem) => (
                  <div key={item.memory_id} className="border-border/70 rounded-xl border bg-background p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{item.entry_type}</Badge>
                      <Badge
                        variant={item.status === "contested" ? "destructive" : "secondary"}
                      >
                        {item.status}
                      </Badge>
                      {item.relations.length > 0 ? (
                        <Badge variant="secondary" className="gap-1">
                          <ShieldCheckIcon className="size-3" />
                          {item.relations.length}
                        </Badge>
                      ) : null}
                      <span className="text-muted-foreground text-xs">{formatTimeAgo(item.updated_at)}</span>
                    </div>
                    <p className="text-sm leading-6">{item.summary || "-"}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.entity_refs.slice(0, 4).map((entity) => (
                        <Badge key={entity} variant="outline" className="text-[11px]">
                          {entity}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </SettingsSection>
  );
}
