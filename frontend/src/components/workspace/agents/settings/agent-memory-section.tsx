"use client";

import { ArrowRightIcon, BrainIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/core/i18n/hooks";
import { useMemoryItems, useMemoryView } from "@/core/memory/hooks";
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
  const isDefaultAgent = agentName === "_default";
  const scope = "agent";
  const scopedAgentName = isDefaultAgent ? null : agentName;

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const {
    memory,
    isLoading: isMemoryLoading,
    error: memoryError,
  } = useMemoryView(scope, scopedAgentName);
  const {
    items,
    isLoading: isItemsLoading,
    error: itemsError,
  } = useMemoryItems(scope, scopedAgentName);

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

  if (isDefaultAgent) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{copy.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl border bg-muted/30 p-4">
            <div className="mb-2 flex items-center gap-2">
              <BrainIcon className="text-primary size-4" />
              <p className="text-sm font-medium">{copy.defaultUsesGlobalTitle}</p>
            </div>
            <p className="text-muted-foreground text-sm leading-6">{copy.defaultUsesGlobalDescription}</p>
          </div>
          <Button
            className="gap-1"
            onClick={() => router.push("/workspace/chats/new?settings=memory")}
          >
            {copy.goToGlobalMemory}
            <ArrowRightIcon className="size-3.5" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isMemoryLoading) {
    return <div className="text-muted-foreground text-sm">{t.common.loading}</div>;
  }

  if (memoryError || itemsError) {
    return (
      <div className="text-sm text-red-500">
        Error: {memoryError?.message ?? itemsError?.message}
      </div>
    );
  }

  if (!memory) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{copy.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">{copy.emptyHint}</p>
          <Button onClick={() => router.push(`/workspace/agents/${agentName}/chats/new`)}>
            {copy.startChatToBuild}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{copy.title}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">{t.common.lastUpdated}</p>
            <p className="mt-1 text-base font-semibold">{formatTimeAgo(memory.lastUpdated)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">{copy.itemCount}</p>
            <p className="mt-1 text-base font-semibold">{formatCount(items.length)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">{copy.factCount}</p>
            <p className="mt-1 text-base font-semibold">{formatCount(memory.facts.length)}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{copy.profileTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6">
            <div>
              <p className="text-muted-foreground text-xs font-medium">{t.settings.memory.markdown.work}</p>
              <p>{memory.user.workContext.summary || t.settings.memory.markdown.empty}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs font-medium">{t.settings.memory.markdown.personal}</p>
              <p>{memory.user.personalContext.summary || t.settings.memory.markdown.empty}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs font-medium">{t.settings.memory.markdown.topOfMind}</p>
              <p>{memory.user.topOfMind.summary || t.settings.memory.markdown.empty}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{copy.historyTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6">
            <div>
              <p className="text-muted-foreground text-xs font-medium">{t.settings.memory.markdown.recentMonths}</p>
              <p>{memory.history.recentMonths.summary || t.settings.memory.markdown.empty}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs font-medium">{t.settings.memory.markdown.earlierContext}</p>
              <p>{memory.history.earlierContext.summary || t.settings.memory.markdown.empty}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs font-medium">{t.settings.memory.markdown.longTermBackground}</p>
              <p>{memory.history.longTermBackground.summary || t.settings.memory.markdown.empty}</p>
            </div>
          </CardContent>
        </Card>
      </div>

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
                {statusOptions.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{copy.filterAll}</SelectItem>
                {typeOptions.map((entryType) => (
                  <SelectItem key={entryType} value={entryType}>
                    {entryType}
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
            <div className="text-muted-foreground text-sm">{copy.emptyHint}</div>
          ) : (
            filteredItems.slice(0, 40).map((item) => (
              <div key={item.memory_id} className="rounded-xl border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{item.entry_type}</Badge>
                  <Badge variant={item.status === "contested" ? "destructive" : "secondary"}>
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
  );
}
