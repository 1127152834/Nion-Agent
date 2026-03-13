"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BrainIcon, DownloadIcon, RefreshCcwIcon, RouteIcon, SearchIcon, ShieldCheckIcon, Trash2Icon, WrenchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/core/i18n/hooks";
import { openVikingActions, useMemoryGovernanceStatus, useMemoryItems, useOpenVikingStatus } from "@/core/memory/hooks";
import type { MemoryQueryExplain, OpenVikingMemoryItem, OpenVikingRetrievalStatus } from "@/core/memory/types";
import { formatTimeAgo } from "@/core/utils/datetime";

import { SettingsSection } from "./settings-section";

function overviewNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

function localizeMemoryStatus(status: string, copy: Record<string, string>): string {
  switch (status.trim().toLowerCase()) {
    case "active":
      return copy.statusActive ?? "Active";
    case "pending":
      return copy.statusPending ?? "Pending";
    case "contested":
      return copy.statusContested ?? "Contested";
    case "applied":
      return copy.statusApplied ?? "Applied";
    default:
      return status;
  }
}

function localizeRetrievalMode(mode: string | undefined, copy: Record<string, string>): string {
  switch ((mode ?? "").trim().toLowerCase()) {
    case "find":
      return copy.retrievalModeFind ?? "Find";
    case "vector_auto":
      return copy.retrievalModeVectorAuto ?? "Vector auto";
    case "vector_forced":
      return copy.retrievalModeVectorForced ?? "Vector forced";
    case "":
      return "-";
    default:
      return mode ?? "-";
  }
}

function localizeMemoryTier(tier: string | undefined, copy: Record<string, string>): string {
  switch ((tier ?? "").trim().toLowerCase()) {
    case "profile":
      return copy.tierProfile ?? "Profile";
    case "preference":
      return copy.tierPreference ?? "Preference";
    case "episode":
      return copy.tierEpisode ?? "Episode";
    case "trace":
      return copy.tierTrace ?? "Trace";
    default:
      return (tier?.trim() ?? "") ? (tier?.trim() ?? "") : "-";
  }
}

function localizeMemorySource(source: string | undefined, copy: Record<string, string>): string {
  switch ((source ?? "").trim().toLowerCase()) {
    case "auto":
      return copy.sourceAuto ?? "Auto";
    case "tool":
      return copy.sourceTool ?? "Tool";
    default:
      return (source?.trim() ?? "") ? (source?.trim() ?? "") : "-";
  }
}

function localizeEmbeddingHealth(
  retrieval: OpenVikingRetrievalStatus | undefined,
  copy: Record<string, string>,
): string {
  if (!retrieval) {
    return "-";
  }
  if (retrieval.embedding_health_ok) {
    return copy.embeddingHealthOk ?? "Healthy";
  }
  if (!retrieval.local_embedding_configured) {
    return copy.embeddingHealthNotConfigured ?? "Not configured";
  }

  const message = String(retrieval.embedding_health_message ?? "").trim();
  if (!message) {
    return copy.embeddingHealthUnknown ?? "-";
  }
  if (message === "empty_vector") {
    return copy.embeddingHealthEmptyVector ?? "Embedding returned empty vector";
  }
  if (message.includes("sentence-transformers unavailable")) {
    return copy.embeddingHealthUnavailable ?? "Local embedding dependency unavailable";
  }
  return message;
}

export function MemorySettingsPage({ onClose }: { onClose?: () => void }) {
  void onClose;
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const copy = t.settings.memory.hub;
  const [searchTerm, setSearchTerm] = useState("");
  const [explainQuery, setExplainQuery] = useState("");
  const [explainData, setExplainData] = useState<MemoryQueryExplain | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [busyAction, setBusyAction] = useState<"compact" | "governance" | "reindex" | "explain" | "export" | "forget" | null>(null);

  const { items, isLoading: isItemsLoading, error: itemsError } = useMemoryItems("global");
  const { governance, isLoading: isGovernanceLoading, error: governanceError } = useMemoryGovernanceStatus();
  const { status, isLoading: isStatusLoading, error: statusError } = useOpenVikingStatus();

  const statusOptions = useMemo(
    () =>
      Array.from(
        new Set(items.map((item) => item.status).filter((value): value is string => Boolean(value))),
      ).sort((a, b) => a.localeCompare(b)),
    [items],
  );

  const filteredItems = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      const haystack = [item.summary, item.uri, item.memory_id, item.source_thread_id]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [items, searchTerm, statusFilter]);

  const hasError = (itemsError ?? governanceError ?? statusError) != null;
  const errorMessage =
    itemsError?.message ?? governanceError?.message ?? statusError?.message ?? copy.loadFailed ?? "Load failed";

  const retrievalModeLabel = localizeRetrievalMode(status?.retrieval.retrieval_mode, copy);
  const embeddingHealthLabel = localizeEmbeddingHealth(status?.retrieval, copy);

  const refreshAll = async (silent = true) => {
    await queryClient.invalidateQueries({ queryKey: ["openviking"] });
    if (!silent) {
      toast.success(copy.refreshSuccess ?? copy.refresh ?? "Refresh completed");
    }
  };

  const runGovernance = async () => {
    setBusyAction("governance");
    try {
      await openVikingActions.runGovernance();
      await refreshAll();
      toast.success(copy.runGovernanceSuccess ?? copy.runGovernance ?? "Governance completed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  const compactMemory = async () => {
    setBusyAction("compact");
    try {
      await openVikingActions.compact({ scope: "global", ratio: 0.8 });
      await refreshAll();
      toast.success(copy.compactSuccess ?? copy.compact ?? "Compaction completed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  const reindexVectors = async () => {
    setBusyAction("reindex");
    try {
      await openVikingActions.reindexVectors(true);
      await refreshAll();
      toast.success(copy.reindexSuccess ?? copy.reindex ?? "Reindex completed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  const forgetItem = async (item: OpenVikingMemoryItem) => {
    const confirmed = window.confirm(copy.deleteConfirm ?? "Delete this memory item permanently?");
    if (!confirmed) {
      return;
    }
    setBusyAction("forget");
    try {
      await openVikingActions.forget({
        memoryId: item.memory_id,
        scope: "global",
      });
      await refreshAll();
      toast.success(copy.deleteSuccess ?? t.common.delete);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  const runExplain = async () => {
    const query = explainQuery.trim();
    if (!query) {
      setExplainData(null);
      setExplainError(copy.queryExplainEmptyQuery ?? copy.searchPlaceholder ?? "Please enter a query");
      return;
    }
    setBusyAction("explain");
    try {
      const payload = await openVikingActions.queryMemoryExplain({
        query,
        scope: "global",
      });
      setExplainData(payload);
      setExplainError(null);
    } catch (error) {
      setExplainError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  const exportDiagnostics = async (kind: "trace" | "chat", id: string) => {
    if (!id.trim()) {
      return;
    }
    setBusyAction("export");
    try {
      const payload =
        kind === "trace"
          ? await openVikingActions.exportTraceProcesslog(id)
          : await openVikingActions.exportChatProcesslog(id);
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `memory-${kind}-${id}.json`;
      anchor.click();
      URL.revokeObjectURL(href);
      toast.success(copy.exportSuccess ?? t.common.download);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <SettingsSection title={t.settings.memory.title} description={t.settings.memory.description}>
      <div className="mb-4 rounded-xl border bg-muted/35 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg border bg-background p-2">
            <BrainIcon className="text-primary size-4.5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold leading-5">{copy.globalOnlyTitle ?? "OpenViking Memory Console"}</p>
            <p className="text-muted-foreground text-xs leading-5">
              {copy.globalOnlyHint ?? "OpenViking single-stack memory dashboard with hard-delete operations."}
            </p>
          </div>
        </div>
      </div>

      {hasError ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{copy.loadFailed ?? "Load failed"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-destructive text-sm">{errorMessage}</p>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void refreshAll(false)}>
              <RefreshCcwIcon className="size-3.5" />
              {copy.retry ?? "Retry"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {copy.totalItems ?? "Total Items"}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-lg font-semibold">{overviewNumber(items.length, locale)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {copy.pendingCount ?? "Pending"}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-lg font-semibold">
                {overviewNumber(governance?.pending_count ?? 0, locale)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {copy.contestedCount ?? "Contested"}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-lg font-semibold">
                {overviewNumber(governance?.contested_count ?? 0, locale)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">{copy.vectorIndex ?? "Vector Index"}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-lg font-semibold">
                {overviewNumber(status?.retrieval.index_count ?? 0, locale)}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="space-y-3 pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => void runGovernance()} disabled={busyAction !== null}>
                  {busyAction === "governance" ? t.common.loading : copy.runGovernance ?? "Run Governance"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void compactMemory()} disabled={busyAction !== null}>
                  {busyAction === "compact" ? t.common.loading : copy.compact ?? "Compact"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void reindexVectors()} disabled={busyAction !== null}>
                  {busyAction === "reindex" ? t.common.loading : copy.reindex ?? "Reindex"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void refreshAll(false)} disabled={busyAction !== null}>
                  {copy.refresh ?? "Refresh"}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{(copy.lastRun ?? "Last Run") + `: ${governance?.last_run_at ? formatTimeAgo(governance.last_run_at, locale) : "-"}`}</span>
                <span>•</span>
                <span>{(copy.retrievalMode ?? "Retrieval") + `: ${retrievalModeLabel}`}</span>
                <span>•</span>
                <span>{(copy.embeddingHealth ?? "Embedding") + `: ${embeddingHealthLabel}`}</span>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="space-y-3 pb-2">
              <div className="flex items-center gap-2">
                <RouteIcon className="size-4 text-muted-foreground" />
                <CardTitle className="text-sm">{copy.queryExplainTitle ?? "Query Explain"}</CardTitle>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="sm:col-span-3">
                  <Input
                    value={explainQuery}
                    onChange={(event) => setExplainQuery(event.target.value)}
                    placeholder={copy.queryExplainPlaceholder ?? copy.searchPlaceholder ?? "Ask memory route and hit reason"}
                  />
                </div>
                <Button onClick={() => void runExplain()} disabled={busyAction !== null || !explainQuery.trim()}>
                  {busyAction === "explain" ? t.common.loading : copy.queryExplainAction ?? "Explain"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {explainError ? (
                <p className="text-sm text-destructive">{explainError}</p>
              ) : null}
              {explainData ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline">
                      {(copy.queryExplainRouteLabel ?? "route") + `: ${explainData.route_taken || "-"}`}
                    </Badge>
                    <Badge variant="outline">
                      {(copy.queryExplainDenseLabel ?? "dense")} {explainData.dense_hits?.length ?? 0} / {(copy.queryExplainSparseLabel ?? "sparse")} {explainData.sparse_hits?.length ?? 0} / {(copy.queryExplainFusionLabel ?? "fusion")}{" "}
                      {explainData.fusion_hits?.length ?? 0}
                    </Badge>
                    <span className="text-muted-foreground">
                      {(copy.queryExplainFallbackLabel ?? "fallback") + `: ${explainData.fallback_reason || "-"}`}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {(explainData.fusion_hits ?? []).slice(0, 8).map((hit) => (
                      <div key={`${hit.memory_id}-${hit.score}`} className="rounded-lg border p-2">
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant="secondary">{hit.score.toFixed(4)}</Badge>
                          <span className="text-muted-foreground">{hit.sources.join("+") || (copy.queryExplainFusionLabel ?? "fusion")}</span>
                        </div>
                        <p className="text-sm leading-6">{hit.content || hit.memory_id}</p>
                      </div>
                    ))}
                    {(explainData.fusion_hits ?? []).length === 0 ? (
                      <p className="text-muted-foreground text-sm">{copy.queryExplainNoFusionHits ?? "No fusion hits."}</p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <WrenchIcon className="size-3.5" />
                      {copy.queryExplainActionEvidence ?? "Action Evidence"}
                    </div>
                    {(explainData.recent_actions ?? []).slice(0, 6).map((action) => (
                      <div key={action.action_id} className="rounded-lg border p-2">
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant="outline">{action.action}</Badge>
                          <span className="text-muted-foreground">{action.reason || "-"}</span>
                          <span className="text-muted-foreground">{formatTimeAgo(action.created_at, locale)}</span>
                        </div>
                        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                          <span>{action.memory_id}</span>
                          {action.trace_id ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2"
                              onClick={() => void exportDiagnostics("trace", action.trace_id)}
                              disabled={busyAction !== null}
                            >
                              <DownloadIcon className="mr-1 size-3.5" />
                              {copy.queryExplainTraceLabel ?? "trace"}
                            </Button>
                          ) : null}
                          {action.chat_id ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2"
                              onClick={() => void exportDiagnostics("chat", action.chat_id)}
                              disabled={busyAction !== null}
                            >
                              <DownloadIcon className="mr-1 size-3.5" />
                              {copy.queryExplainChatLabel ?? "chat"}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    {(explainData.recent_actions ?? []).length === 0 ? (
                      <p className="text-muted-foreground text-sm">{copy.queryExplainNoActionEvidence ?? "No recent action evidence."}</p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {copy.queryExplainHint ?? "Run explain to view dense/sparse/fusion timeline and decision evidence."}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-3 pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">{copy.entries ?? "Memory Entries"}</CardTitle>
                <Badge variant="outline">{filteredItems.length}/{items.length}</Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <div className="relative">
                    <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 size-4" />
                    <Input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      className="pl-9"
                      placeholder={copy.searchPlaceholder ?? t.common.search}
                    />
                  </div>
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{copy.filterAll ?? "All"}</SelectItem>
                    {statusOptions.map((entryStatus) => (
                      <SelectItem key={entryStatus} value={entryStatus}>
                        {localizeMemoryStatus(entryStatus, copy)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {isItemsLoading || isGovernanceLoading || isStatusLoading ? (
                <div className="text-muted-foreground text-sm">{t.common.loading}</div>
              ) : filteredItems.length === 0 ? (
                <div className="text-muted-foreground text-sm">{copy.noResults ?? t.settings.memory.empty}</div>
              ) : (
                filteredItems.slice(0, 60).map((item: OpenVikingMemoryItem) => (
                  <div key={item.memory_id} className="border-border/70 rounded-xl border bg-background p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{localizeMemoryStatus(item.status, copy)}</Badge>
                      <Badge variant="secondary">{localizeMemoryTier(item.tier, copy)}</Badge>
                      <Badge variant="secondary">{localizeMemorySource(item.source, copy)}</Badge>
                      <Badge variant="secondary" className="gap-1">
                        <ShieldCheckIcon className="size-3" />
                        {(item.quality_score ?? item.score ?? 0).toFixed(2)}
                      </Badge>
                      <span className="text-muted-foreground text-xs">{formatTimeAgo(item.updated_at, locale)}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="ml-auto size-7"
                        onClick={() => void forgetItem(item)}
                        disabled={busyAction !== null}
                        aria-label={copy.remove ?? "Delete"}
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    </div>
                    <p className="text-sm leading-6">{item.summary || "-"}</p>
                    {item.decision_reason ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {(copy.decisionReason ?? "Reason") + `: ${item.decision_reason}`}
                      </p>
                    ) : null}
                    {typeof item.ttl === "number" ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {(copy.ttlLabel ?? "TTL") + `: ${Math.max(0, item.ttl)}s`}
                      </p>
                    ) : null}
                    <p className="text-muted-foreground mt-1 truncate text-xs">{item.uri}</p>
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
