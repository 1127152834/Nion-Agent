"use client";

import { ArrowRightIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/core/i18n/hooks";
import { openVikingActions, useMemoryItems } from "@/core/memory/hooks";
import type { OpenVikingMemoryItem } from "@/core/memory/types";
import { useAppRouter as useRouter } from "@/core/navigation";
import { formatTimeAgo } from "@/core/utils/datetime";

interface AgentMemorySectionProps {
  agentName: string;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function AgentMemorySection({ agentName }: AgentMemorySectionProps) {
  const { t } = useI18n();
  const router = useRouter();
  const copy = t.agents.settings.memory;

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isForgetting, setIsForgetting] = useState(false);

  const {
    items,
    isLoading: isItemsLoading,
    error: itemsError,
  } = useMemoryItems("agent", agentName);

  const statusOptions = useMemo(
    () =>
      Array.from(
        new Set(items.map((item) => item.status).filter((status): status is string => Boolean(status))),
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

  const handleForget = async (item: OpenVikingMemoryItem) => {
    if (isForgetting) {
      return;
    }
    const confirmed = window.confirm("Delete this memory item permanently?");
    if (!confirmed) {
      return;
    }
    setIsForgetting(true);
    try {
      await openVikingActions.forget({
        memoryId: item.memory_id,
        scope: "agent",
        agentName,
      });
      window.location.reload();
    } finally {
      setIsForgetting(false);
    }
  };

  if (itemsError) {
    return <div className="text-sm text-red-500">Error: {itemsError.message}</div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{copy.title}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">{copy.itemCount}</p>
            <p className="mt-1 text-base font-semibold">{formatCount(items.length)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">{copy.factCount}</p>
            <p className="mt-1 text-base font-semibold">{formatCount(items.length)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">{t.common.lastUpdated}</p>
            <p className="mt-1 text-base font-semibold">{items[0]?.updated_at ? formatTimeAgo(items[0].updated_at) : "-"}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3 pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">{copy.entriesTitle}</CardTitle>
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
                  placeholder={copy.searchPlaceholder}
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{copy.filterAll}</SelectItem>
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
          {isItemsLoading ? (
            <div className="text-muted-foreground text-sm">{t.common.loading}</div>
          ) : filteredItems.length === 0 ? (
            <div className="space-y-3 rounded-xl border border-dashed p-4">
              <p className="text-muted-foreground text-sm">{copy.emptyHint}</p>
              <Button
                variant="outline"
                className="gap-1"
                onClick={() => {
                  if (agentName === "_default") {
                    router.push("/workspace/chats/new");
                    return;
                  }
                  router.push(`/workspace/agents/${encodeURIComponent(agentName)}/chats/new`);
                }}
              >
                {copy.startChatToBuild}
                <ArrowRightIcon className="size-3.5" />
              </Button>
            </div>
          ) : (
            filteredItems.slice(0, 40).map((item) => (
              <div key={item.memory_id} className="rounded-xl border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{item.status}</Badge>
                  {item.tier ? <Badge variant="secondary">{item.tier}</Badge> : null}
                  {item.source ? <Badge variant="secondary">{item.source}</Badge> : null}
                  <span className="text-muted-foreground text-xs">{formatTimeAgo(item.updated_at)}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto size-7"
                    onClick={() => void handleForget(item)}
                    disabled={isForgetting}
                    aria-label="Forget"
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
                <p className="text-sm leading-6">{item.summary || "-"}</p>
                {item.decision_reason ? (
                  <p className="text-muted-foreground mt-1 text-xs">{`reason: ${item.decision_reason}`}</p>
                ) : null}
                <p className="text-muted-foreground mt-1 truncate text-xs">{item.uri}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
