"use client";

import {
  CheckCheck,
  CheckCircle2,
  Circle,
  Loader2,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import {
  useDeleteThread,
  useRenameThread,
  useThreads,
} from "@/core/threads/hooks";
import {
  isHiddenWorkspaceThread,
  isThreadAwaitingResponse,
  pathOfNewThread,
  pathOfThread,
  titleOfThread,
} from "@/core/threads/utils";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import { useWorkspaceSidebarNavigation } from "./workspace-sidebar-routing";

type CurrentThreadDeleteIntent =
  | { kind: "single"; threadId: string }
  | { kind: "batch"; threadIds: string[] }
  | null;

export function RecentChatList() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const handleNavigate = useWorkspaceSidebarNavigation();
  const { thread_id: threadIdFromPath } = useParams<{ thread_id: string }>();
  const { data: threads = [] } = useThreads();
  const visibleThreads = useMemo(
    () =>
      threads.filter(
        (thread) =>
          thread.values?.session_mode !== "temporary_chat"
          && !isHiddenWorkspaceThread(thread),
      ),
    [threads],
  );
  const visibleThreadIds = useMemo(
    () => visibleThreads.map((thread) => thread.thread_id),
    [visibleThreads],
  );
  const { mutateAsync: deleteThreadAsync } = useDeleteThread();
  const { mutate: renameThread } = useRenameThread();

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameThreadId, setRenameThreadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const currentThreadId =
    threadIdFromPath && threadIdFromPath !== "new" ? threadIdFromPath : null;
  const [currentThreadDeleteIntent, setCurrentThreadDeleteIntent] =
    useState<CurrentThreadDeleteIntent>(null);
  const [currentThreadDeleteDialogOpen, setCurrentThreadDeleteDialogOpen] =
    useState(false);
  const [isCurrentThreadDeleting, setIsCurrentThreadDeleting] = useState(false);

  const selectedThreadIdSet = useMemo(
    () => new Set(selectedThreadIds),
    [selectedThreadIds],
  );
  const selectedThreads = useMemo(
    () => visibleThreads.filter((thread) => selectedThreadIdSet.has(thread.thread_id)),
    [selectedThreadIdSet, visibleThreads],
  );
  const currentThread = useMemo(
    () =>
      currentThreadId
        ? visibleThreads.find((thread) => thread.thread_id === currentThreadId) ?? null
        : null,
    [currentThreadId, visibleThreads],
  );
  const selectedCount = selectedThreadIds.length;

  useEffect(() => {
    const visibleThreadIdSet = new Set(visibleThreadIds);
    setSelectedThreadIds((current) => {
      const next = current.filter((id) => visibleThreadIdSet.has(id));
      return next.length === current.length ? current : next;
    });
  }, [visibleThreadIds]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedThreadIds([]);
    setBatchDeleteDialogOpen(false);
  }, []);

  const toggleThreadSelection = useCallback((threadId: string) => {
    setSelectedThreadIds((current) =>
      current.includes(threadId)
        ? current.filter((id) => id !== threadId)
        : [...current, threadId],
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedThreadIds(visibleThreads.map((thread) => thread.thread_id));
  }, [visibleThreads]);

  const handleClearSelection = useCallback(() => {
    setSelectedThreadIds([]);
  }, []);

  const openCurrentThreadDeleteDialog = useCallback(
    (intent: Exclude<CurrentThreadDeleteIntent, null>) => {
      setBatchDeleteDialogOpen(false);
      setCurrentThreadDeleteIntent(intent);
      setCurrentThreadDeleteDialogOpen(true);
    },
    [],
  );

  const closeCurrentThreadDeleteDialog = useCallback(() => {
    if (isBatchDeleting || isCurrentThreadDeleting) {
      return;
    }
    setCurrentThreadDeleteDialogOpen(false);
    setCurrentThreadDeleteIntent(null);
  }, [isBatchDeleting, isCurrentThreadDeleting]);

  const getRedirectPathAfterDeletingThreads = useCallback(
    (removingIds: string[]) => {
      const deletingSet = new Set(removingIds);

      if (
        currentThreadId
        && removingIds.length === 1
        && removingIds[0] === currentThreadId
      ) {
        const currentIndex = visibleThreads.findIndex(
          (thread) => thread.thread_id === currentThreadId,
        );

        if (currentIndex >= 0) {
          const nextThread = visibleThreads[currentIndex + 1];
          if (nextThread && !deletingSet.has(nextThread.thread_id)) {
            return pathOfThread(nextThread.thread_id);
          }

          const previousThread = visibleThreads[currentIndex - 1];
          if (previousThread && !deletingSet.has(previousThread.thread_id)) {
            return pathOfThread(previousThread.thread_id);
          }
        }
      }

      const fallbackThread = visibleThreads.find(
        (thread) => !deletingSet.has(thread.thread_id),
      );

      return fallbackThread
        ? pathOfThread(fallbackThread.thread_id)
        : pathOfNewThread();
    },
    [currentThreadId, visibleThreads],
  );

  const navigateAwayFromCurrentThread = useCallback(async (targetPath: string) => {
    router.push(targetPath);
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 80);
    });
  }, [router]);

  const deleteSingleThread = useCallback(
    async (threadId: string, options?: { redirectPath?: string | null }) => {
      if (options?.redirectPath) {
        await navigateAwayFromCurrentThread(options.redirectPath);
      }
      await deleteThreadAsync({ threadId });
      if (options?.redirectPath) {
        router.push(options.redirectPath);
      }
    },
    [deleteThreadAsync, navigateAwayFromCurrentThread, router],
  );

  const handleDelete = useCallback(
    (threadId: string) => {
      if (threadId === currentThreadId) {
        openCurrentThreadDeleteDialog({ kind: "single", threadId });
        return;
      }
      void deleteSingleThread(threadId);
    },
    [currentThreadId, deleteSingleThread, openCurrentThreadDeleteDialog],
  );

  const handleRenameClick = useCallback(
    (threadId: string, currentTitle: string) => {
      setRenameThreadId(threadId);
      setRenameValue(currentTitle);
      setRenameDialogOpen(true);
    },
    [],
  );

  const handleRenameSubmit = useCallback(() => {
    if (renameThreadId && renameValue.trim()) {
      renameThread({ threadId: renameThreadId, title: renameValue.trim() });
      setRenameDialogOpen(false);
      setRenameThreadId(null);
      setRenameValue("");
    }
  }, [renameThread, renameThreadId, renameValue]);

  const handleShare = useCallback(
    async (threadId: string) => {
      const VERCEL_URL = "https://nion-v2.vercel.app";
      const isLocalhost =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";
      const baseUrl = isLocalhost ? VERCEL_URL : window.location.origin;
      const shareUrl = `${baseUrl}/workspace/chats/${threadId}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success(t.clipboard.linkCopied);
      } catch {
        toast.error(t.clipboard.failedToCopyToClipboard);
      }
    },
    [t],
  );

  const performBatchDelete = useCallback(
    async (
      removingIds: string[],
      options?: { redirectPath?: string | null },
    ) => {
      if (removingIds.length === 0 || isBatchDeleting) {
        return;
      }

      setIsBatchDeleting(true);
      try {
        if (options?.redirectPath) {
          await navigateAwayFromCurrentThread(options.redirectPath);
        }

        const results = await Promise.allSettled(
          removingIds.map((threadId) => deleteThreadAsync({ threadId })),
        );

        const successCount = results.filter((result) => result.status === "fulfilled").length;
        const failedCount = results.length - successCount;
        if (options?.redirectPath) {
          router.push(options.redirectPath);
        }

        if (failedCount === 0) {
          toast.success(t.sidebar.bulkDeleteSuccess);
        } else if (successCount > 0) {
          toast.error(t.sidebar.bulkDeletePartialFailure);
        } else {
          toast.error(t.sidebar.bulkDeleteFailure);
        }

        if (failedCount === 0) {
          exitSelectionMode();
        } else {
          setSelectedThreadIds(
            removingIds.filter((_, index) => results[index]?.status !== "fulfilled"),
          );
          setBatchDeleteDialogOpen(false);
        }
      } catch {
        toast.error(t.sidebar.bulkDeleteFailure);
      } finally {
        setIsBatchDeleting(false);
      }
    },
    [deleteThreadAsync, exitSelectionMode, isBatchDeleting, navigateAwayFromCurrentThread, router, t.sidebar],
  );

  const handleRequestBatchDelete = useCallback(() => {
    if (selectedCount === 0 || isBatchDeleting) {
      return;
    }

    if (currentThreadId && selectedThreadIdSet.has(currentThreadId)) {
      openCurrentThreadDeleteDialog({
        kind: "batch",
        threadIds: [...selectedThreadIds],
      });
      return;
    }

    void performBatchDelete([...selectedThreadIds]);
  }, [
    currentThreadId,
    isBatchDeleting,
    openCurrentThreadDeleteDialog,
    performBatchDelete,
    selectedCount,
    selectedThreadIdSet,
    selectedThreadIds,
  ]);

  const handleConfirmCurrentThreadDelete = useCallback(async () => {
    if (!currentThreadDeleteIntent || isCurrentThreadDeleting) {
      return;
    }

    setIsCurrentThreadDeleting(true);
    try {
      if (currentThreadDeleteIntent.kind === "single") {
        const redirectPath = getRedirectPathAfterDeletingThreads([
          currentThreadDeleteIntent.threadId,
        ]);
        await deleteSingleThread(currentThreadDeleteIntent.threadId, {
          redirectPath,
        });
      } else {
        const redirectPath = getRedirectPathAfterDeletingThreads(
          currentThreadDeleteIntent.threadIds,
        );
        await performBatchDelete(currentThreadDeleteIntent.threadIds, {
          redirectPath,
        });
      }

      setCurrentThreadDeleteDialogOpen(false);
      setCurrentThreadDeleteIntent(null);
    } catch {
      toast.error(t.sidebar.deleteChatFailed);
    } finally {
      setIsCurrentThreadDeleting(false);
    }
  }, [
    currentThreadDeleteIntent,
    deleteSingleThread,
    getRedirectPathAfterDeletingThreads,
    isCurrentThreadDeleting,
    performBatchDelete,
    t.sidebar.deleteChatFailed,
  ]);

  if (visibleThreads.length === 0) {
    return null;
  }

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel className="h-auto flex-col items-stretch gap-2 px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate">
                {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true"
                  ? t.sidebar.recentChats
                  : t.sidebar.demoChats}
              </span>
              {selectionMode ? (
                <Badge
                  variant="secondary"
                  className="rounded-full border border-sidebar-border bg-sidebar-accent/70 px-2 py-0.5 text-[10px] font-medium"
                >
                  {selectedCount}
                </Badge>
              ) : null}
            </div>

            {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true" ? (
              selectionMode ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 rounded-full text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      onClick={exitSelectionMode}
                      aria-label={t.sidebar.cancelManageChats}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t.sidebar.cancelManageChats}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 rounded-full text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      onClick={() => setSelectionMode(true)}
                      aria-label={t.sidebar.manageChats}
                    >
                      <CheckCheck className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t.sidebar.manageChats}
                  </TooltipContent>
                </Tooltip>
              )
            ) : null}
          </div>

          {selectionMode ? (
            <div className="grid w-full grid-cols-2 gap-1 rounded-xl border border-sidebar-border/70 bg-sidebar-accent/45 p-1 shadow-sm backdrop-blur-sm">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full min-w-0 justify-center rounded-lg px-2 text-[11px]"
                onClick={handleSelectAll}
              >
                <CheckCheck className="size-3.5" />
                <span className="truncate">{t.sidebar.selectAllChats}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full min-w-0 justify-center rounded-lg px-2 text-[11px]"
                onClick={handleClearSelection}
                disabled={selectedCount === 0}
              >
                <X className="size-3.5" />
                <span className="truncate">{t.sidebar.clearChatSelection}</span>
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="col-span-2 h-7 w-full min-w-0 justify-center rounded-lg px-2 text-[11px] shadow-sm"
                disabled={selectedCount === 0}
                onClick={() => setBatchDeleteDialogOpen(true)}
              >
                <Trash2 className="size-3.5" />
                <span className="truncate">{t.sidebar.deleteSelectedChats}</span>
              </Button>
            </div>
          ) : null}
        </SidebarGroupLabel>
        <SidebarGroupContent className="group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0">
          <SidebarMenu>
            <div className="flex w-full flex-col gap-1">
              {visibleThreads.map((thread) => {
                const isActive = pathOfThread(thread.thread_id) === pathname;
                const isSelected = selectedThreadIdSet.has(thread.thread_id);

                if (selectionMode) {
                  return (
                    <SidebarMenuItem
                      key={thread.thread_id}
                      className="group/side-menu-item"
                    >
                      <SidebarMenuButton
                        asChild
                        isActive={false}
                        variant={isSelected ? "outline" : "default"}
                        className={cn(
                          "h-9 transition-all duration-200 hover:translate-x-[1px]",
                          isSelected
                            ? "border-primary/25 bg-primary/8 text-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]"
                            : isActive
                              ? "bg-sidebar-accent/60"
                              : "",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleThreadSelection(thread.thread_id)}
                          className="cursor-pointer"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className={cn(
                                "flex size-4 items-center justify-center rounded-full transition-transform duration-200",
                                isSelected ? "text-primary" : "text-sidebar-foreground/35",
                              )}
                            >
                              {isSelected ? (
                                <CheckCircle2 className="size-4" />
                              ) : (
                                <Circle className="size-4" />
                              )}
                            </span>
                            <span className="inline-flex min-w-0 max-w-full items-center gap-2">
                              <span className="truncate">{titleOfThread(thread)}</span>
                              {isThreadAwaitingResponse(thread) ? (
                                <Badge
                                  variant="secondary"
                                  className="border-emerald-200 bg-emerald-100 text-[10px] text-emerald-700"
                                >
                                  {t.chats.awaitingResponse}
                                </Badge>
                              ) : null}
                            </span>
                          </span>
                        </button>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                return (
                  <SidebarMenuItem
                    key={thread.thread_id}
                    className="group/side-menu-item"
                  >
                    <SidebarMenuButton isActive={isActive} asChild>
                      <div>
                        <Link
                          className="text-muted-foreground block w-full whitespace-nowrap group-hover/side-menu-item:overflow-hidden"
                          href={pathOfThread(thread.thread_id)}
                          onClick={handleNavigate}
                        >
                          <span className="inline-flex max-w-full items-center gap-2">
                            <span className="truncate">{titleOfThread(thread)}</span>
                            {isThreadAwaitingResponse(thread) ? (
                              <Badge
                                variant="secondary"
                                className="border-emerald-200 bg-emerald-100 text-[10px] text-emerald-700"
                              >
                                {t.chats.awaitingResponse}
                              </Badge>
                            ) : null}
                          </span>
                        </Link>
                        {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true" && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <SidebarMenuAction
                                showOnHover
                                className="bg-background/50 hover:bg-background"
                              >
                                <MoreHorizontal />
                                <span className="sr-only">{t.common.more}</span>
                              </SidebarMenuAction>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              className="w-48 rounded-lg"
                              side={"right"}
                              align={"start"}
                            >
                              <DropdownMenuItem
                                onSelect={() =>
                                  handleRenameClick(
                                    thread.thread_id,
                                    titleOfThread(thread),
                                  )
                                }
                              >
                                <Pencil className="text-muted-foreground" />
                                <span>{t.common.rename}</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => handleShare(thread.thread_id)}
                              >
                                <Share2 className="text-muted-foreground" />
                                <span>{t.common.share}</span>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() => handleDelete(thread.thread_id)}
                              >
                                <Trash2 className="text-muted-foreground" />
                                <span>{t.common.delete}</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </div>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t.common.rename}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={t.common.rename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleRenameSubmit();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameDialogOpen(false)}
            >
              {t.common.cancel}
            </Button>
            <Button onClick={handleRenameSubmit}>{t.common.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={batchDeleteDialogOpen}
        onOpenChange={(open) => {
          if (isBatchDeleting) {
            return;
          }
          setBatchDeleteDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{t.sidebar.bulkDeleteTitle}</DialogTitle>
            <DialogDescription>
              {t.sidebar.bulkDeleteDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <div className="flex flex-wrap gap-2">
              {selectedThreads.slice(0, 6).map((thread) => (
                <Badge
                  key={thread.thread_id}
                  variant="secondary"
                  className="max-w-full rounded-full px-2.5 py-1 text-xs"
                >
                  <span className="max-w-[220px] truncate">
                    {titleOfThread(thread)}
                  </span>
                </Badge>
              ))}
            </div>
            {selectedCount > 6 ? (
              <p className="text-muted-foreground text-xs">
                + {selectedCount - 6} {t.sidebar.moreSelectedChats}
              </p>
            ) : null}
            {currentThreadId && selectedThreadIdSet.has(currentThreadId) ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-xs leading-5 text-amber-900 dark:text-amber-100">
                {t.sidebar.deleteCurrentChatInSelectionDescription}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBatchDeleteDialogOpen(false)}
              disabled={isBatchDeleting}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRequestBatchDelete}
              disabled={selectedCount === 0 || isBatchDeleting}
            >
              {isBatchDeleting ? (
                <>
                  <Loader2 className="animate-spin" />
                  <span>{t.common.loading}</span>
                </>
              ) : (
                <>
                  <Trash2 />
                  <span>{t.sidebar.deleteSelectedChats}</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={currentThreadDeleteDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            return;
          }
          closeCurrentThreadDeleteDialog();
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>
              {currentThreadDeleteIntent?.kind === "batch"
                ? t.sidebar.deleteCurrentChatInSelectionTitle
                : t.sidebar.deleteCurrentChatTitle}
            </DialogTitle>
            <DialogDescription>
              {currentThreadDeleteIntent?.kind === "batch"
                ? t.sidebar.deleteCurrentChatInSelectionDescription
                : t.sidebar.deleteCurrentChatDescription}
            </DialogDescription>
          </DialogHeader>

          {currentThread ? (
            <div className="py-1">
              <Badge
                variant="secondary"
                className="max-w-full rounded-full px-2.5 py-1 text-xs"
              >
                <span className="max-w-[260px] truncate">
                  {titleOfThread(currentThread)}
                </span>
              </Badge>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeCurrentThreadDeleteDialog}
              disabled={isCurrentThreadDeleting || isBatchDeleting}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleConfirmCurrentThreadDelete()}
              disabled={!currentThreadDeleteIntent || isCurrentThreadDeleting || isBatchDeleting}
            >
              {isCurrentThreadDeleting || isBatchDeleting ? (
                <>
                  <Loader2 className="animate-spin" />
                  <span>{t.common.loading}</span>
                </>
              ) : (
                <>
                  <Trash2 />
                  <span>{t.common.delete}</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
