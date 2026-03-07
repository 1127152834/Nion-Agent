"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import {
  useDeleteMemoryFact,
  useMemory,
  usePinMemoryFact,
  useUpdateMemoryFact,
} from "@/core/memory/hooks";
import type { MemoryFact, UserMemory } from "@/core/memory/types";
import { pathOfThread } from "@/core/threads/utils";
import { formatTimeAgo } from "@/core/utils/datetime";

import { SettingsSection } from "./settings-section";

type LibraryEntry = {
  id: string;
  kind: "fact" | "item";
  content: string;
  category: string;
  confidence: number | null;
  createdAt: string;
  source: string;
  pinned: boolean;
  inaccurate: boolean;
};

type SortMode = "pinned" | "recent" | "confidence";

function buildLibraryEntries(memory: UserMemory): LibraryEntry[] {
  const factEntries: LibraryEntry[] = memory.facts.map((fact) => ({
    id: fact.id,
    kind: "fact",
    content: fact.content,
    category: fact.category,
    confidence:
      typeof fact.confidence === "number" && Number.isFinite(fact.confidence)
        ? fact.confidence
        : null,
    createdAt: fact.createdAt,
    source: fact.source,
    pinned: Boolean(fact.pinned),
    inaccurate: Boolean(fact.inaccurate),
  }));

  const itemEntries: LibraryEntry[] = memory.items
    .filter((item) => !factEntries.some((fact) => fact.id === item.id))
    .map((item) => ({
      id: item.id,
      kind: "item",
      content: item.content,
      category: item.category ?? "context",
      confidence:
        typeof item.confidence === "number" && Number.isFinite(item.confidence)
          ? item.confidence
          : null,
      createdAt: item.created_at ?? "",
      source:
        item.source ??
        (typeof item.metadata?.thread_id === "string"
          ? item.metadata.thread_id
          : ""),
      pinned: false,
      inaccurate: false,
    }));

  return [...factEntries, ...itemEntries];
}

function formatConfidence(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return `${Math.round(value * 100)}%`;
}

function formatTimeLabel(value: string): string {
  return value ? formatTimeAgo(value) : "-";
}

function compareByDateDesc(a: LibraryEntry, b: LibraryEntry): number {
  const timeA = a.createdAt ? Date.parse(a.createdAt) : 0;
  const timeB = b.createdAt ? Date.parse(b.createdAt) : 0;
  return timeB - timeA;
}

export function MemorySettingsPage() {
  const { t, locale } = useI18n();
  const { memory, isLoading, error } = useMemory();
  const updateFactMutation = useUpdateMemoryFact();
  const pinFactMutation = usePinMemoryFact();
  const deleteFactMutation = useDeleteMemoryFact();
  const fallbackHub = locale === "zh-CN"
    ? {
      overview: "概览",
      lastUpdated: "最后更新",
      totalFacts: "事实数",
      totalItems: "条目数",
      totalCategories: "分类数",
      profile: "用户画像",
      workContext: "工作上下文",
      personalContext: "个人上下文",
      topOfMind: "近期关注",
      emptySummary: "暂无摘要",
      library: "记忆库",
      searchPlaceholder: "搜索内容或分类",
      filterAll: "全部",
      sortPinned: "置顶优先",
      sortRecent: "最近更新",
      sortConfidence: "置信度",
      noResults: "没有匹配的记忆条目",
      save: "保存",
      cancel: "取消",
      confidence: "置信度",
      pinned: "置顶",
      inaccurate: "标记不准确",
      sourceFact: "来源：事实",
      sourceItem: "来源：条目",
      createdAt: "创建时间",
      source: "来源",
      correct: "编辑",
      unpin: "取消置顶",
      pin: "置顶",
      unmarkInaccurate: "取消不准确标记",
      markInaccurate: "标记不准确",
      remove: "删除",
      readOnly: "只读",
      updateFailed: "更新失败",
      updateSuccess: "更新成功",
      pinFailed: "置顶操作失败",
      deleteConfirm: "确认删除这条记忆吗？",
      deleteSuccess: "删除成功",
      deleteFailed: "删除失败",
    }
    : {
      overview: "Overview",
      lastUpdated: "Last updated",
      totalFacts: "Facts",
      totalItems: "Items",
      totalCategories: "Categories",
      profile: "Profile",
      workContext: "Work context",
      personalContext: "Personal context",
      topOfMind: "Top of mind",
      emptySummary: "No summary",
      library: "Memory library",
      searchPlaceholder: "Search content or category",
      filterAll: "All",
      sortPinned: "Pinned first",
      sortRecent: "Most recent",
      sortConfidence: "Confidence",
      noResults: "No matching memory items",
      save: "Save",
      cancel: "Cancel",
      confidence: "Confidence",
      pinned: "Pinned",
      inaccurate: "Inaccurate",
      sourceFact: "Source: fact",
      sourceItem: "Source: item",
      createdAt: "Created at",
      source: "Source",
      correct: "Edit",
      unpin: "Unpin",
      pin: "Pin",
      unmarkInaccurate: "Unmark inaccurate",
      markInaccurate: "Mark inaccurate",
      remove: "Remove",
      readOnly: "Read-only",
      updateFailed: "Update failed",
      updateSuccess: "Update succeeded",
      pinFailed: "Pin action failed",
      deleteConfirm: "Delete this memory?",
      deleteSuccess: "Deleted",
      deleteFailed: "Delete failed",
    };
  const hub = {
    ...fallbackHub,
    ...(t.settings.memory?.hub ?? {}),
  };

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("pinned");
  const [editingFactId, setEditingFactId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [editingCategory, setEditingCategory] = useState("context");

  const entries = useMemo(() => {
    if (!memory) {
      return [];
    }
    return buildLibraryEntries(memory);
  }, [memory]);

  const categories = useMemo(() => {
    const values = new Set(entries.map((entry) => entry.category));
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      if (categoryFilter !== "all" && entry.category !== categoryFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return (
        entry.content.toLowerCase().includes(normalizedQuery) ||
        entry.category.toLowerCase().includes(normalizedQuery)
      );
    });

    if (sortMode === "recent") {
      return [...filtered].sort(compareByDateDesc);
    }

    if (sortMode === "confidence") {
      return [...filtered].sort((a, b) => {
        const scoreA = a.confidence ?? -1;
        const scoreB = b.confidence ?? -1;
        return scoreB - scoreA;
      });
    }

    return [...filtered].sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      return compareByDateDesc(a, b);
    });
  }, [categoryFilter, entries, query, sortMode]);

  const handleStartEdit = (entry: LibraryEntry) => {
    if (entry.kind !== "fact") {
      return;
    }
    setEditingFactId(entry.id);
    setEditingContent(entry.content);
    setEditingCategory(entry.category);
  };

  const handleCancelEdit = () => {
    setEditingFactId(null);
    setEditingContent("");
    setEditingCategory("context");
  };

  const handleSaveEdit = async () => {
    if (!editingFactId) {
      return;
    }
    const content = editingContent.trim();
    if (!content) {
      toast.error(hub.updateFailed);
      return;
    }
    try {
      await updateFactMutation.mutateAsync({
        factId: editingFactId,
        updates: {
          content,
          category: editingCategory,
        },
      });
      toast.success(hub.updateSuccess);
      handleCancelEdit();
    } catch (mutationError) {
      const message =
        mutationError instanceof Error
          ? mutationError.message
          : hub.updateFailed;
      toast.error(message);
    }
  };

  const handleTogglePin = async (fact: MemoryFact) => {
    try {
      await pinFactMutation.mutateAsync({
        factId: fact.id,
        pinned: !Boolean(fact.pinned),
      });
    } catch (mutationError) {
      const message =
        mutationError instanceof Error
          ? mutationError.message
          : hub.pinFailed;
      toast.error(message);
    }
  };

  const handleToggleInaccurate = async (fact: MemoryFact) => {
    try {
      await updateFactMutation.mutateAsync({
        factId: fact.id,
        updates: {
          inaccurate: !Boolean(fact.inaccurate),
        },
      });
    } catch (mutationError) {
      const message =
        mutationError instanceof Error
          ? mutationError.message
          : hub.updateFailed;
      toast.error(message);
    }
  };

  const handleDelete = async (fact: MemoryFact) => {
    if (!window.confirm(hub.deleteConfirm)) {
      return;
    }
    try {
      await deleteFactMutation.mutateAsync({ factId: fact.id });
      toast.success(hub.deleteSuccess);
    } catch (mutationError) {
      const message =
        mutationError instanceof Error
          ? mutationError.message
          : hub.deleteFailed;
      toast.error(message);
    }
  };

  return (
    <SettingsSection
      title={t.settings.memory.title}
      description={t.settings.memory.description}
    >
      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : error ? (
        <div className="text-destructive text-sm">{error.message}</div>
      ) : !memory ? (
        <div className="text-muted-foreground text-sm">{t.settings.memory.empty}</div>
      ) : (
        <div className="space-y-4">
          <section className="rounded-lg border p-4">
            <div className="mb-3 text-sm font-medium">
              {hub.overview}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border px-3 py-2">
                <div className="text-muted-foreground text-xs">
                  {hub.lastUpdated}
                </div>
                <div className="mt-1 text-sm font-medium">
                  {formatTimeLabel(memory.lastUpdated)}
                </div>
              </div>
              <div className="rounded-md border px-3 py-2">
                <div className="text-muted-foreground text-xs">
                  {hub.totalFacts}
                </div>
                <div className="mt-1 text-sm font-medium">{memory.facts.length}</div>
              </div>
              <div className="rounded-md border px-3 py-2">
                <div className="text-muted-foreground text-xs">
                  {hub.totalItems}
                </div>
                <div className="mt-1 text-sm font-medium">{memory.items.length}</div>
              </div>
              <div className="rounded-md border px-3 py-2">
                <div className="text-muted-foreground text-xs">
                  {hub.totalCategories}
                </div>
                <div className="mt-1 text-sm font-medium">
                  {Object.keys(memory.categories).length}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-lg border p-4">
            <div className="mb-3 text-sm font-medium">
              {hub.profile}
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <div className="rounded-md border p-3">
                <div className="mb-1 text-xs font-semibold">
                  {hub.workContext}
                </div>
                <p className="text-muted-foreground text-sm leading-6">
                  {memory.user.workContext.summary || hub.emptySummary}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <div className="mb-1 text-xs font-semibold">
                  {hub.personalContext}
                </div>
                <p className="text-muted-foreground text-sm leading-6">
                  {memory.user.personalContext.summary ||
                    hub.emptySummary}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <div className="mb-1 text-xs font-semibold">
                  {hub.topOfMind}
                </div>
                <p className="text-muted-foreground text-sm leading-6">
                  {memory.user.topOfMind.summary || hub.emptySummary}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-lg border p-4">
            <div className="mb-3 text-sm font-medium">
              {hub.library}
            </div>
            <div className="mb-3 grid gap-2 md:grid-cols-[1fr_180px_180px]">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={hub.searchPlaceholder}
              />
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{hub.filterAll}</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={sortMode}
                onValueChange={(value) => setSortMode(value as SortMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pinned">
                    {hub.sortPinned}
                  </SelectItem>
                  <SelectItem value="recent">
                    {hub.sortRecent}
                  </SelectItem>
                  <SelectItem value="confidence">
                    {hub.sortConfidence}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {filteredEntries.length === 0 ? (
              <div className="text-muted-foreground text-sm">
                {hub.noResults}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredEntries.map((entry) => {
                  const isEditing = editingFactId === entry.id;
                  const isFact = entry.kind === "fact";
                  return (
                    <article key={`${entry.kind}:${entry.id}`} className="rounded-md border p-3">
                      {isEditing ? (
                        <div className="space-y-2">
                          <Textarea
                            value={editingContent}
                            onChange={(event) =>
                              setEditingContent(event.target.value)
                            }
                            rows={3}
                          />
                          <Input
                            value={editingCategory}
                            onChange={(event) =>
                              setEditingCategory(event.target.value)
                            }
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              onClick={() => {
                                void handleSaveEdit();
                              }}
                              disabled={updateFactMutation.isPending}
                            >
                              {hub.save}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleCancelEdit}
                            >
                              {hub.cancel}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm leading-6">{entry.content}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <Badge variant="outline">{entry.category}</Badge>
                            <Badge variant="outline">
                              {hub.confidence}:{" "}
                              {formatConfidence(entry.confidence)}
                            </Badge>
                            {entry.pinned && (
                              <Badge variant="outline">
                                {hub.pinned}
                              </Badge>
                            )}
                            {entry.inaccurate && (
                              <Badge variant="destructive">
                                {hub.inaccurate}
                              </Badge>
                            )}
                            <Badge variant="outline">
                              {entry.kind === "fact"
                                ? hub.sourceFact
                                : hub.sourceItem}
                            </Badge>
                            <span className="text-muted-foreground">
                              {hub.createdAt}:{" "}
                              {formatTimeLabel(entry.createdAt)}
                            </span>
                            {entry.source && (
                              <span className="text-muted-foreground">
                                {hub.source}:{" "}
                                {isFact && entry.source !== "unknown" ? (
                                  <Link
                                    href={pathOfThread(entry.source)}
                                    className="underline underline-offset-2"
                                  >
                                    {entry.source}
                                  </Link>
                                ) : (
                                  entry.source
                                )}
                              </span>
                            )}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {isFact ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleStartEdit(entry)}
                                >
                                  {hub.correct}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    void handleTogglePin(entry as MemoryFact)
                                  }
                                  disabled={pinFactMutation.isPending}
                                >
                                  {entry.pinned
                                    ? hub.unpin
                                    : hub.pin}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    void handleToggleInaccurate(
                                      entry as MemoryFact,
                                    )
                                  }
                                  disabled={updateFactMutation.isPending}
                                >
                                  {entry.inaccurate
                                    ? hub.unmarkInaccurate
                                    : hub.markInaccurate}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleDelete(entry as MemoryFact)}
                                  disabled={deleteFactMutation.isPending}
                                >
                                  {hub.remove}
                                </Button>
                              </>
                            ) : (
                              <Badge variant="secondary">
                                {hub.readOnly}
                              </Badge>
                            )}
                          </div>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </SettingsSection>
  );
}
