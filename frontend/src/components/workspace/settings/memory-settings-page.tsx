"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BrainIcon, RefreshCcwIcon, SearchIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/core/i18n/hooks";
import { openVikingActions, useMemoryGovernanceStatus, useMemoryItems, useOpenVikingStatus } from "@/core/memory/hooks";
import type { OpenVikingMemoryItem } from "@/core/memory/types";
import { formatTimeAgo } from "@/core/utils/datetime";

import { SettingsSection } from "./settings-section";

function overviewNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function MemorySettingsPage({ onClose }: { onClose?: () => void }) {
  void onClose;
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const copy = t.settings.memory.hub;
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [busyAction, setBusyAction] = useState<"compact" | "governance" | "reindex" | "forget" | null>(null);

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

  const refreshAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ["openviking"] });
  };

  const runGovernance = async () => {
    setBusyAction("governance");
    try {
      await openVikingActions.runGovernance();
      await refreshAll();
    } finally {
      setBusyAction(null);
    }
  };

  const compactMemory = async () => {
    setBusyAction("compact");
    try {
      await openVikingActions.compact({ scope: "global", ratio: 0.8 });
      await refreshAll();
    } finally {
      setBusyAction(null);
    }
  };

  const reindexVectors = async () => {
    setBusyAction("reindex");
    try {
      await openVikingActions.reindexVectors(true);
      await refreshAll();
    } finally {
      setBusyAction(null);
    }
  };

  const forgetItem = async (item: OpenVikingMemoryItem) => {
    const confirmed = window.confirm(copy.confirmForget ?? "Delete this memory item permanently?");
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
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void refreshAll()}>
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
              <CardContent className="pt-0 text-lg font-semibold">{overviewNumber(items.length)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {copy.pendingCount ?? "Pending"}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-lg font-semibold">
                {overviewNumber(governance?.pending_count ?? 0)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {copy.contestedCount ?? "Contested"}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-lg font-semibold">
                {overviewNumber(governance?.contested_count ?? 0)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">{copy.vectorIndex ?? "Vector Index"}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-lg font-semibold">
                {overviewNumber(status?.retrieval.index_count ?? 0)}
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
                <Button size="sm" variant="ghost" onClick={() => void refreshAll()} disabled={busyAction !== null}>
                  {copy.refresh ?? "Refresh"}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{(copy.lastRun ?? "Last Run") + `: ${governance?.last_run_at ? formatTimeAgo(governance.last_run_at) : "-"}`}</span>
                <span>•</span>
                <span>{(copy.retrievalMode ?? "Retrieval") + `: ${status?.retrieval.retrieval_mode ?? "-"}`}</span>
                <span>•</span>
                <span>{(copy.embeddingHealth ?? "Embedding") + `: ${status?.retrieval.embedding_health_message ?? "-"}`}</span>
              </div>
            </CardHeader>
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
                        {entryStatus}
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
                      <Badge variant="outline">{item.status}</Badge>
                      <Badge variant="secondary" className="gap-1">
                        <ShieldCheckIcon className="size-3" />
                        {(item.score ?? 0).toFixed(2)}
                      </Badge>
                      <span className="text-muted-foreground text-xs">{formatTimeAgo(item.updated_at)}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="ml-auto size-7"
                        onClick={() => void forgetItem(item)}
                        disabled={busyAction !== null}
                        aria-label={copy.forget ?? "Forget"}
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    </div>
                    <p className="text-sm leading-6">{item.summary || "-"}</p>
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
