"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  FilesIcon,
  FolderInputIcon,
  FolderMinusIcon,
  PencilIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ArtifactFileList } from "@/components/workspace/artifacts/artifact-file-list";
import {
  artifactGroupDownloadURL,
  filterAndSortArtifacts,
  groupArtifactsByPrefix,
  type ArtifactFilterType,
  type ArtifactSortMode,
} from "@/core/artifacts";
import { useArtifactGroups } from "@/core/artifacts/hooks";
import { useI18n } from "@/core/i18n/hooks";
import { useAppRouter as useRouter } from "@/core/navigation";
import { getFileName } from "@/core/utils/files";
import { buildWorkbenchSlotRouteURL, getWorkbenchRegistry } from "@/core/workbench";
import { cn } from "@/lib/utils";

import { useThread } from "../messages/context";

const AUTO_GROUPING_STORAGE_KEY = "nion:artifact-center:auto-grouping-enabled";

export function ArtifactCenter({
  open,
  onOpenChange,
  artifacts,
  threadId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifacts: string[];
  threadId: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isMock } = useThread();
  const [autoGroupingEnabled, setAutoGroupingEnabled] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<ArtifactFilterType>("all");
  const [sortMode, setSortMode] = useState<ArtifactSortMode>("recent");
  const [draggingArtifact, setDraggingArtifact] = useState<{
    path: string;
    fromGroupId?: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "ungrouped" | null>(
    null,
  );
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const {
    groups,
    replaceGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    addToGroup,
    removeFromGroup,
    isSaving,
  } = useArtifactGroups(
    threadId,
    {
      isMock,
    },
  );
  const fallbackAutoGroups = useMemo(
    () => groupArtifactsByPrefix(artifacts),
    [artifacts],
  );
  const isUsingAutoGroups =
    groups.length === 0 && autoGroupingEnabled && fallbackAutoGroups.length > 0;
  const sourceGroups = useMemo(
    () =>
      groups.length > 0
        ? groups
        : autoGroupingEnabled
          ? fallbackAutoGroups
          : [],
    [autoGroupingEnabled, fallbackAutoGroups, groups],
  );
  const persistedGroupIds = useMemo(
    () => new Set(groups.map((group) => group.id)),
    [groups],
  );
  const filteredArtifacts = useMemo(
    () =>
      filterAndSortArtifacts(artifacts, {
        query: searchQuery,
        filterType,
        sortMode,
      }),
    [artifacts, filterType, searchQuery, sortMode],
  );
  const hasActiveFilters =
    searchQuery.trim().length > 0 || filterType !== "all" || sortMode !== "recent";
  const resultSummary = t.artifactCenter.resultSummary
    .replace("{matched}", String(filteredArtifacts.length))
    .replace("{total}", String(artifacts.length));

  const groupedArtifacts = useMemo(() => {
    const artifactSet = new Set(artifacts);
    return sourceGroups
      .map((group) => ({
        ...group,
        artifacts: filterAndSortArtifacts(
          group.artifacts.filter((artifact) => artifactSet.has(artifact)),
          {
            query: searchQuery,
            filterType,
            sortMode,
          },
        ),
      }))
      .filter((group) => group.artifacts.length > 0);
  }, [artifacts, filterType, searchQuery, sortMode, sourceGroups]);

  const ungroupedArtifacts = useMemo(() => {
    const groupedArtifactSet = new Set(
      groupedArtifacts.flatMap((group) => group.artifacts),
    );
    return filteredArtifacts.filter((artifact) => !groupedArtifactSet.has(artifact));
  }, [filteredArtifacts, groupedArtifacts]);

  const handleSelectArtifact = useCallback(
    (filepath: string) => {
      const registry = getWorkbenchRegistry();
      const plugin = registry.findBestMatch({
        path: filepath,
        kind: "file",
        metadata: {},
      });
      const nextURL = buildWorkbenchSlotRouteURL({
        pathname,
        pluginId: plugin?.id ?? "frontend-workbench",
        artifactPath: filepath,
        targetKind: "file",
        searchParams,
      });
      router.push(nextURL);
      onOpenChange(false);
    },
    [onOpenChange, pathname, router, searchParams],
  );

  const toggleGroupCollapsed = useCallback((groupId: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(AUTO_GROUPING_STORAGE_KEY);
      if (stored === null) {
        return;
      }
      setAutoGroupingEnabled(stored === "1");
    } catch {
      // Ignore storage read errors.
    }
  }, []);

  const handleToggleAutoGrouping = useCallback(() => {
    setAutoGroupingEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTO_GROUPING_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage write errors.
      }
      return next;
    });
  }, []);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterType("all");
    setSortMode("recent");
  }, []);

  const handleCreateGroupFromUngrouped = useCallback(async () => {
    if (ungroupedArtifacts.length < 2) {
      return;
    }
    const defaultName = getFileName(ungroupedArtifacts[0] ?? "artifacts");
    const groupName = window.prompt(
      t.artifactCenter.createGroupPrompt,
      defaultName,
    );
    if (!groupName || groupName.trim().length === 0) {
      return;
    }
    await createGroup({
      name: groupName,
      artifacts: ungroupedArtifacts,
    });
  }, [
    createGroup,
    t.artifactCenter.createGroupPrompt,
    ungroupedArtifacts,
  ]);

  const handleRenameGroup = useCallback(
    async (groupId: string, currentName: string) => {
      const nextName = window.prompt(
        t.artifactCenter.renameGroupPrompt,
        currentName,
      );
      if (!nextName || nextName.trim().length === 0 || nextName === currentName) {
        return;
      }
      await updateGroup(groupId, { name: nextName });
    },
    [t.artifactCenter.renameGroupPrompt, updateGroup],
  );

  const handleDeleteGroup = useCallback(
    async (groupId: string, groupName: string) => {
      const confirmed = window.confirm(
        t.artifactCenter.deleteGroupConfirm.replace("{name}", groupName),
      );
      if (!confirmed) {
        return;
      }
      await deleteGroup(groupId);
    },
    [deleteGroup, t.artifactCenter.deleteGroupConfirm],
  );

  const handleDownloadGroup = useCallback(
    (groupId: string) => {
      const downloadUrl = artifactGroupDownloadURL(threadId, groupId);
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    },
    [threadId],
  );

  const handleMoveArtifactToGroup = useCallback(
    async (artifactPath: string, fromGroupId?: string) => {
      const existingNames = groups.map((group) => group.name).join(", ");
      const promptHint = existingNames
        ? existingNames
        : t.artifactCenter.moveArtifactNoGroupHint;
      const targetName = window.prompt(
        `${t.artifactCenter.moveArtifactPrompt}\n${promptHint}`,
        getFileName(artifactPath),
      );

      if (!targetName || targetName.trim().length === 0) {
        return;
      }

      const normalizedTargetName = targetName.trim();
      const targetGroup = groups.find(
        (group) =>
          group.name.toLowerCase() === normalizedTargetName.toLowerCase(),
      );

      if (targetGroup) {
        if (fromGroupId && targetGroup.id === fromGroupId) {
          return;
        }
        await addToGroup(targetGroup.id, artifactPath);
      } else {
        await createGroup({
          name: normalizedTargetName,
          artifacts: [artifactPath],
        });
      }

      if (fromGroupId && persistedGroupIds.has(fromGroupId)) {
        await removeFromGroup(fromGroupId, artifactPath);
      }
    },
    [
      addToGroup,
      createGroup,
      groups,
      persistedGroupIds,
      removeFromGroup,
      t.artifactCenter.moveArtifactNoGroupHint,
      t.artifactCenter.moveArtifactPrompt,
    ],
  );

  const handleRemoveFromGroup = useCallback(
    async (groupId: string, artifactPath: string) => {
      await removeFromGroup(groupId, artifactPath);
    },
    [removeFromGroup],
  );

  const handleArtifactDragStart = useCallback(
    (artifactPath: string, fromGroupId?: string) => {
      setDraggingArtifact({
        path: artifactPath,
        fromGroupId,
      });
    },
    [],
  );

  const handleArtifactDragEnd = useCallback(() => {
    setDraggingArtifact(null);
    setDropTarget(null);
  }, []);

  const handleDropToGroup = useCallback(
    async (targetGroupId: string) => {
      if (!draggingArtifact || !persistedGroupIds.has(targetGroupId)) {
        return;
      }

      const { path, fromGroupId } = draggingArtifact;
      if (fromGroupId === targetGroupId) {
        setDropTarget(null);
        return;
      }

      await addToGroup(targetGroupId, path);
      if (fromGroupId && persistedGroupIds.has(fromGroupId)) {
        await removeFromGroup(fromGroupId, path);
      }
      setDraggingArtifact(null);
      setDropTarget(null);
    },
    [addToGroup, draggingArtifact, persistedGroupIds, removeFromGroup],
  );

  const handleDropToUngrouped = useCallback(async () => {
    if (!draggingArtifact?.fromGroupId) {
      setDropTarget(null);
      return;
    }

    if (persistedGroupIds.has(draggingArtifact.fromGroupId)) {
      await removeFromGroup(draggingArtifact.fromGroupId, draggingArtifact.path);
    }
    setDraggingArtifact(null);
    setDropTarget(null);
  }, [draggingArtifact, persistedGroupIds, removeFromGroup]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full p-0 sm:max-w-md" side="right">
          <SheetHeader className="border-b px-6 py-5">
            <SheetTitle>{t.artifactCenter.title}</SheetTitle>
            <SheetDescription>{t.artifactCenter.description}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {artifacts.length > 0 ? (
              <div className="flex flex-col gap-4">
                <div className="space-y-2">
                  <div className="relative">
                    <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2.5 left-2 size-3.5" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={t.artifactCenter.searchPlaceholder}
                      className="h-8 pl-7 text-xs"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-1 flex-wrap gap-2">
                      <Select
                        value={filterType}
                        onValueChange={(value) =>
                          setFilterType(value as ArtifactFilterType)
                        }
                      >
                        <SelectTrigger size="sm" className="h-8 min-w-[150px] text-xs">
                          <SelectValue placeholder={t.artifactCenter.filterLabel} />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value="all">
                            {t.artifactCenter.filterAll}
                          </SelectItem>
                          <SelectItem value="document">
                            {t.artifactCenter.filterDocuments}
                          </SelectItem>
                          <SelectItem value="image">
                            {t.artifactCenter.filterImages}
                          </SelectItem>
                          <SelectItem value="media">
                            {t.artifactCenter.filterMedia}
                          </SelectItem>
                          <SelectItem value="code">
                            {t.artifactCenter.filterCode}
                          </SelectItem>
                          <SelectItem value="skill">
                            {t.artifactCenter.filterSkills}
                          </SelectItem>
                          <SelectItem value="other">
                            {t.artifactCenter.filterOther}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={sortMode}
                        onValueChange={(value) =>
                          setSortMode(value as ArtifactSortMode)
                        }
                      >
                        <SelectTrigger size="sm" className="h-8 min-w-[150px] text-xs">
                          <SelectValue placeholder={t.artifactCenter.sortLabel} />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value="recent">
                            {t.artifactCenter.sortRecent}
                          </SelectItem>
                          <SelectItem value="name-asc">
                            {t.artifactCenter.sortNameAsc}
                          </SelectItem>
                          <SelectItem value="name-desc">
                            {t.artifactCenter.sortNameDesc}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground px-1 text-[11px]">
                        {resultSummary}
                      </span>
                      {hasActiveFilters && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={handleClearFilters}
                        >
                          {t.artifactCenter.clearFiltersAction}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={handleToggleAutoGrouping}
                      >
                        {autoGroupingEnabled
                          ? t.artifactCenter.disableAutoGrouping
                          : t.artifactCenter.enableAutoGrouping}
                      </Button>
                    </div>
                  </div>
                </div>
                {filteredArtifacts.length > 0 ? (
                  <>
                    {groupedArtifacts.length > 0 && (
                      <section className="space-y-3">
                        <div className="flex items-center justify-between gap-2 px-1">
                          <h3 className="text-muted-foreground text-xs font-medium">
                            {t.artifactCenter.groupedSectionTitle}
                          </h3>
                          {isUsingAutoGroups && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              disabled={isSaving}
                              onClick={() => void replaceGroups(fallbackAutoGroups)}
                            >
                              {t.artifactCenter.persistAutoGroups}
                            </Button>
                          )}
                        </div>
                        {isUsingAutoGroups && (
                          <p className="text-muted-foreground px-1 text-[11px]">
                            {t.artifactCenter.autoGroupHint}
                          </p>
                        )}
                        <p className="text-muted-foreground px-1 text-[11px]">
                          {t.artifactCenter.dragToMoveHint}
                        </p>
                        {groupedArtifacts.map((group) => {
                          const isPersistedGroup = persistedGroupIds.has(group.id);
                          return (
                            <div
                              key={group.id}
                              className={cn(
                                "space-y-2 rounded-xl border p-3 transition-colors",
                                dropTarget === group.id &&
                                  "border-primary bg-accent/20",
                              )}
                              onDragOver={(event) => {
                                if (!isPersistedGroup || !draggingArtifact) {
                                  return;
                                }
                                event.preventDefault();
                                if (dropTarget !== group.id) {
                                  setDropTarget(group.id);
                                }
                              }}
                              onDrop={(event) => {
                                if (!isPersistedGroup) {
                                  return;
                                }
                                event.preventDefault();
                                void handleDropToGroup(group.id);
                              }}
                            >
                              <button
                                type="button"
                                className="flex w-full items-center justify-between"
                                onClick={() => toggleGroupCollapsed(group.id)}
                              >
                                <span className="flex items-center gap-1 text-sm font-medium">
                                  {collapsedGroupIds.has(group.id) ? (
                                    <ChevronRightIcon className="size-4" />
                                  ) : (
                                    <ChevronDownIcon className="size-4" />
                                  )}
                                  {group.name}
                                </span>
                                <span className="flex items-center gap-1">
                                  <span className="text-muted-foreground text-xs">
                                    {group.artifacts.length}
                                  </span>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    className="size-6"
                                    disabled={isSaving || !isPersistedGroup}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (!isPersistedGroup) {
                                        return;
                                      }
                                      handleDownloadGroup(group.id);
                                    }}
                                    aria-label={t.artifactCenter.downloadGroupAction}
                                  >
                                    <DownloadIcon className="size-3.5" />
                                  </Button>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    className="size-6"
                                    disabled={isSaving || !isPersistedGroup}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (!isPersistedGroup) {
                                        return;
                                      }
                                      void handleRenameGroup(group.id, group.name);
                                    }}
                                    aria-label={t.artifactCenter.renameGroupAction}
                                  >
                                    <PencilIcon className="size-3.5" />
                                  </Button>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    className="size-6"
                                    disabled={isSaving || !isPersistedGroup}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (!isPersistedGroup) {
                                        return;
                                      }
                                      void handleDeleteGroup(group.id, group.name);
                                    }}
                                    aria-label={t.artifactCenter.deleteGroupAction}
                                  >
                                    <Trash2Icon className="size-3.5" />
                                  </Button>
                                </span>
                              </button>
                              {!collapsedGroupIds.has(group.id) && (
                                <ArtifactFileList
                                  className="gap-2"
                                  files={group.artifacts}
                                  threadId={threadId}
                                  onSelectArtifact={handleSelectArtifact}
                                  draggableArtifacts={isPersistedGroup}
                                  onDragStartArtifact={
                                    isPersistedGroup
                                      ? (filepath) =>
                                          handleArtifactDragStart(filepath, group.id)
                                      : undefined
                                  }
                                  onDragEndArtifact={handleArtifactDragEnd}
                                  renderExtraActions={
                                    isPersistedGroup
                                      ? (filepath) => (
                                          <>
                                            <Button
                                              size="icon-sm"
                                              variant="ghost"
                                              className="size-6"
                                              disabled={isSaving}
                                              onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                void handleMoveArtifactToGroup(
                                                  filepath,
                                                  group.id,
                                                );
                                              }}
                                              aria-label={t.artifactCenter.moveArtifactAction}
                                            >
                                              <FolderInputIcon className="size-3.5" />
                                            </Button>
                                            <Button
                                              size="icon-sm"
                                              variant="ghost"
                                              className="size-6"
                                              disabled={isSaving}
                                              onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                void handleRemoveFromGroup(
                                                  group.id,
                                                  filepath,
                                                );
                                              }}
                                              aria-label={t.artifactCenter.removeFromGroupAction}
                                            >
                                              <FolderMinusIcon className="size-3.5" />
                                            </Button>
                                          </>
                                        )
                                      : undefined
                                  }
                                />
                              )}
                            </div>
                          );
                        })}
                      </section>
                    )}

                    {ungroupedArtifacts.length > 0 && (
                      <section
                        className={cn(
                          "space-y-3 rounded-xl p-1 transition-colors",
                          dropTarget === "ungrouped" && "bg-accent/20",
                        )}
                        onDragOver={(event) => {
                          if (!draggingArtifact) {
                            return;
                          }
                          event.preventDefault();
                          if (dropTarget !== "ungrouped") {
                            setDropTarget("ungrouped");
                          }
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          void handleDropToUngrouped();
                        }}
                      >
                        {groupedArtifacts.length > 0 && (
                          <div className="flex items-center justify-between gap-2 px-1">
                            <h3 className="text-muted-foreground text-xs font-medium">
                              {t.artifactCenter.ungroupedSectionTitle}
                            </h3>
                            {ungroupedArtifacts.length > 1 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs"
                                disabled={isSaving}
                                onClick={() =>
                                  void handleCreateGroupFromUngrouped()
                                }
                              >
                                {t.artifactCenter.createGroupAction}
                              </Button>
                            )}
                          </div>
                        )}
                        <ArtifactFileList
                          className="gap-3"
                          files={ungroupedArtifacts}
                          threadId={threadId}
                          onSelectArtifact={handleSelectArtifact}
                          draggableArtifacts
                          onDragStartArtifact={(filepath) =>
                            handleArtifactDragStart(filepath)
                          }
                          onDragEndArtifact={handleArtifactDragEnd}
                          renderExtraActions={(filepath) => (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="size-6"
                              disabled={isSaving}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void handleMoveArtifactToGroup(filepath);
                              }}
                              aria-label={t.artifactCenter.moveArtifactAction}
                            >
                              <FolderInputIcon className="size-3.5" />
                            </Button>
                          )}
                        />
                      </section>
                    )}
                  </>
                ) : (
                  <ConversationEmptyState
                    className="h-[280px]"
                  >
                    <div className="text-muted-foreground">
                      <FilesIcon className="size-5" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-sm font-medium">
                        {t.artifactCenter.filteredEmptyTitle}
                      </h3>
                      <p className="text-muted-foreground text-sm">
                        {t.artifactCenter.filteredEmptyDescription}
                      </p>
                    </div>
                    {hasActiveFilters && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={handleClearFilters}
                      >
                        {t.artifactCenter.clearFiltersAction}
                      </Button>
                    )}
                  </ConversationEmptyState>
                )}
              </div>
            ) : (
              <ConversationEmptyState
                className="h-full"
                icon={<FilesIcon className="size-5" />}
                title={t.artifactCenter.emptyTitle}
                description={t.artifactCenter.emptyDescription}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

    </>
  );
}
