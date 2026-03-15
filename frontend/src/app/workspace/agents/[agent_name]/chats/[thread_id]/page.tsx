"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BotIcon, PlusSquare } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AgentWelcome } from "@/components/workspace/agent-welcome";
import { WorkingDirectoryTrigger } from "@/components/workspace/artifacts";
import { ChatBox, useThreadChat } from "@/components/workspace/chats";
import { InputBox } from "@/components/workspace/input-box";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import { NewChatStage } from "@/components/workspace/new-chat-stage";
import { RuntimeModeToggle } from "@/components/workspace/runtime-mode-toggle";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { TodoList } from "@/components/workspace/todo-list";
import { Tooltip } from "@/components/workspace/tooltip";
import type { A2UIUserAction } from "@/core/a2ui/types";
import { useAgent } from "@/core/agents";
import { getAPIClient } from "@/core/api";
import { useI18n } from "@/core/i18n/hooks";
import { findLastRetryableUserMessage } from "@/core/messages/retry";
import { useAppRouter as useRouter } from "@/core/navigation";
import { useNotification } from "@/core/notification/hooks";
import { platform } from "@/core/platform";
import { useDesktopRuntime } from "@/core/platform/hooks";
import { type RuntimeProfile, fetchRuntimeProfile, updateRuntimeProfile } from "@/core/runtime-profile/api";
import { useLocalSettings } from "@/core/settings";
import { fetchSandboxPolicy } from "@/core/system/api";
import type { AgentThreadState } from "@/core/threads";
import {
  isThreadNotFoundError,
  pruneThreadFromCache,
  useThreadStream,
} from "@/core/threads/hooks";
import {
  hasThreadRenderableState,
  isThreadLikelyInitializing,
  THREAD_EMPTY_STATE_MAX_POLLS,
  THREAD_EMPTY_STATE_POLL_INTERVAL_MS,
} from "@/core/threads/thread-guard";
import { textOfMessage } from "@/core/threads/utils";
import { isUUID } from "@/core/utils/uuid";
import { env } from "@/env";
import { cn } from "@/lib/utils";

const DEFAULT_RUNTIME_PROFILE: RuntimeProfile = {
  execution_mode: "sandbox",
  host_workdir: null,
  locked: false,
  updated_at: null,
};

export default function AgentChatPage() {
  const { t } = useI18n();
  const [settings, setSettings] = useLocalSettings();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isDesktopRuntime } = useDesktopRuntime();

  const { agent_name } = useParams<{
    agent_name: string;
  }>();

  const { agent } = useAgent(agent_name);

  const { threadId, setThreadId, isNewThread, setIsNewThread } = useThreadChat();

  const { showNotification } = useNotification();
  const [runtimeProfile, setRuntimeProfile] = useState<RuntimeProfile>(DEFAULT_RUNTIME_PROFILE);
  const [runtimeProfileLoading, setRuntimeProfileLoading] = useState(false);
  const [runtimeProfileSaving, setRuntimeProfileSaving] = useState(false);
  const [hostSetupDialogOpen, setHostSetupDialogOpen] = useState(false);
  const [hostSetupPreviousProfile, setHostSetupPreviousProfile] = useState<RuntimeProfile | null>(null);
  const [hostSetupErrorMessage, setHostSetupErrorMessage] = useState<string | null>(null);
  const [hostSetupCreateBaseDir, setHostSetupCreateBaseDir] = useState<string | null>(null);
  const [hostSetupCreateInputVisible, setHostSetupCreateInputVisible] = useState(false);
  const [hostSetupCreateDirName, setHostSetupCreateDirName] = useState("workspace");
  const [hostSetupCreateSaving, setHostSetupCreateSaving] = useState(false);

  const hostModeCopy = t.workspace.runtimeMode;
  const ensureHostModeAllowed = useCallback(async (): Promise<boolean> => {
    try {
      const policy = await fetchSandboxPolicy();
      if (policy.strict_mode) {
        toast.error(hostModeCopy.strictDisabled);
        return false;
      }
    } catch (error) {
      console.warn("Failed to load sandbox policy:", error);
    }
    return true;
  }, [hostModeCopy.strictDisabled]);
  const mapRuntimeProfileError = useCallback(
    (message: string): string => {
      if (message.includes("empty directory")) {
        const foundMatch = /found:\s*([^)]+)/i.exec(message);
        if (foundMatch?.[1]) {
          return hostModeCopy.hostDirDetected(foundMatch[1]);
        }
        return hostModeCopy.hostDirMissing;
      }
      if (message.includes("already bound")) {
        return hostModeCopy.hostDirLocked;
      }
      return message;
    },
    [hostModeCopy],
  );

  const [thread, sendMessage, submitA2UIAction] = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    context: { ...settings.context, agent_name: agent_name },
    onStart: (startedThreadId) => {
      setThreadId(startedThreadId);
      setIsNewThread(false);
      router.replace(
        `/workspace/agents/${agent_name}/chats/${startedThreadId}`,
      );
    },
    onFinish: (state) => {
      if (document.hidden || !document.hasFocus()) {
        let body = "Conversation finished";
        const lastMessage = state.messages[state.messages.length - 1];
        if (lastMessage) {
          const textContent = textOfMessage(lastMessage);
          if (textContent) {
            body =
              textContent.length > 200
                ? textContent.substring(0, 200) + "..."
                : textContent;
          }
        }
        showNotification(state.title, { body });
      }
    },
  });

  const hostModeMissingDir = runtimeProfile.execution_mode === "host" && !runtimeProfile.host_workdir;
  const inputDisabled = env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"
    || runtimeProfileLoading
    || runtimeProfileSaving
    || hostSetupDialogOpen
    || hostModeMissingDir;
  const shouldShowInputBox = hostSetupDialogOpen
    || !isNewThread
    || runtimeProfile.execution_mode !== "host"
    || Boolean(runtimeProfile.host_workdir);

  const persistRuntimeProfile = useCallback(
    async (
      payload: { execution_mode: "sandbox" | "host"; host_workdir?: string | null },
      options?: { onError?: (displayMessage: string, rawMessage: string) => void },
    ): Promise<boolean> => {
      if (threadId === "new") {
        setRuntimeProfile((prev) => ({
          ...prev,
          execution_mode: payload.execution_mode,
          host_workdir: payload.execution_mode === "host" ? (payload.host_workdir ?? null) : null,
        }));
        return true;
      }
      setRuntimeProfileSaving(true);
      try {
        const updated = await updateRuntimeProfile(threadId, payload);
        setRuntimeProfile(updated);
        return true;
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : hostModeCopy.modeSaveFailed;
        const displayMessage = mapRuntimeProfileError(rawMessage || hostModeCopy.modeSaveFailed);
        if (options?.onError) {
          options.onError(displayMessage || hostModeCopy.modeSaveFailed, rawMessage);
        } else {
          toast.error(displayMessage || hostModeCopy.modeSaveFailed);
        }
        return false;
      } finally {
        setRuntimeProfileSaving(false);
      }
    },
    [hostModeCopy.modeSaveFailed, mapRuntimeProfileError, threadId],
  );

  const pickHostDirectory = useCallback(async (): Promise<string | null> => {
    if (!isDesktopRuntime) {
      toast.error(hostModeCopy.desktopOnly);
      return null;
    }
    if (!(await ensureHostModeAllowed())) {
      return null;
    }
    if (runtimeProfile.locked) {
      toast.error(hostModeCopy.locked);
      return null;
    }
    try {
      const picked = await platform.pickHostFile({
        title: hostModeCopy.pickDir,
        defaultPath: runtimeProfile.host_workdir ?? undefined,
        kind: "directory",
      });
      if (picked.canceled || !picked.path) {
        return null;
      }
      return picked.path;
    } catch (error) {
      const message = error instanceof Error ? error.message : hostModeCopy.modeSaveFailed;
      toast.error(message || hostModeCopy.modeSaveFailed);
      return null;
    }
  }, [
    ensureHostModeAllowed,
    isDesktopRuntime,
    hostModeCopy.desktopOnly,
    hostModeCopy.locked,
    hostModeCopy.modeSaveFailed,
    hostModeCopy.pickDir,
    runtimeProfile.host_workdir,
    runtimeProfile.locked,
  ]);

  const handleChooseHostSetupDirectory = useCallback(async () => {
    setHostSetupErrorMessage(null);
    setHostSetupCreateBaseDir(null);
    setHostSetupCreateInputVisible(false);

    const selectedPath = await pickHostDirectory();
    if (!selectedPath) {
      return;
    }
    const saved = await persistRuntimeProfile({
      execution_mode: "host",
      host_workdir: selectedPath,
    }, {
      onError: (displayMessage, rawMessage) => {
        setHostSetupErrorMessage(displayMessage);
        if (rawMessage.includes("empty directory")) {
          setHostSetupCreateBaseDir(selectedPath);
        }
      },
    });
    if (!saved) {
      return;
    }
    setHostSetupPreviousProfile(null);
    setHostSetupErrorMessage(null);
    setHostSetupCreateBaseDir(null);
    setHostSetupCreateInputVisible(false);
    setHostSetupCreateDirName("workspace");
    setHostSetupDialogOpen(false);
  }, [persistRuntimeProfile, pickHostDirectory]);

  const handleCreateWorkspaceFromSelectedDir = useCallback(async () => {
    if (!hostSetupCreateBaseDir) {
      return;
    }
    if (!(await ensureHostModeAllowed())) {
      return;
    }
    const trimmedName = hostSetupCreateDirName.trim();
    if (!trimmedName) {
      setHostSetupErrorMessage(hostModeCopy.folderNameRequired);
      return;
    }
    if (/[\\/]/.test(trimmedName)) {
      setHostSetupErrorMessage(hostModeCopy.folderNameInvalid);
      return;
    }

    const normalizedBase = hostSetupCreateBaseDir.replace(/[\\/]+$/, "");
    const separator = normalizedBase.includes("\\") && !normalizedBase.includes("/") ? "\\" : "/";
    const workspaceDir = `${normalizedBase}${separator}${trimmedName}`;
    const placeholderPath = `${workspaceDir}${separator}.gitkeep`;

    setHostSetupCreateSaving(true);
    setHostSetupErrorMessage(null);
    try {
      await platform.writeHostFile({
        path: placeholderPath,
        content: "",
        append: false,
        encoding: "utf-8",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : hostModeCopy.modeSaveFailed;
      setHostSetupErrorMessage(message || hostModeCopy.modeSaveFailed);
      setHostSetupCreateSaving(false);
      return;
    }

    const saved = await persistRuntimeProfile({
      execution_mode: "host",
      host_workdir: workspaceDir,
    }, {
      onError: (displayMessage) => {
        setHostSetupErrorMessage(displayMessage);
      },
    });
    setHostSetupCreateSaving(false);
    if (!saved) {
      return;
    }

    setHostSetupPreviousProfile(null);
    setHostSetupErrorMessage(null);
    setHostSetupCreateBaseDir(null);
    setHostSetupCreateInputVisible(false);
    setHostSetupCreateDirName("workspace");
    setHostSetupDialogOpen(false);
  }, [
    ensureHostModeAllowed,
    hostModeCopy.folderNameInvalid,
    hostModeCopy.folderNameRequired,
    hostModeCopy.modeSaveFailed,
    hostSetupCreateBaseDir,
    hostSetupCreateDirName,
    persistRuntimeProfile,
  ]);

  const handleCancelHostSetup = useCallback(() => {
    if (hostSetupPreviousProfile) {
      setRuntimeProfile(hostSetupPreviousProfile);
    }
    setHostSetupPreviousProfile(null);
    setHostSetupErrorMessage(null);
    setHostSetupCreateBaseDir(null);
    setHostSetupCreateInputVisible(false);
    setHostSetupCreateDirName("workspace");
    setHostSetupDialogOpen(false);
  }, [hostSetupPreviousProfile]);

  const handleOpenHostSetup = useCallback(() => {
    void ensureHostModeAllowed().then((allowed) => {
      if (!allowed) {
        return;
      }
      setHostSetupPreviousProfile(runtimeProfile);
      setHostSetupErrorMessage(null);
      setHostSetupCreateBaseDir(null);
      setHostSetupCreateInputVisible(false);
      setHostSetupCreateDirName("workspace");
      setRuntimeProfile((prev) => ({
        ...prev,
        execution_mode: "host",
      }));
      setHostSetupDialogOpen(true);
    });
  }, [ensureHostModeAllowed, runtimeProfile]);

  const handleSwitchMode = useCallback(
    async (mode: "sandbox" | "host") => {
      if (runtimeProfile.locked) {
        toast.error(hostModeCopy.locked);
        return;
      }
      if (mode === runtimeProfile.execution_mode) {
        if (mode === "host" && !runtimeProfile.host_workdir) {
          handleOpenHostSetup();
        }
        return;
      }
      if (mode === "sandbox") {
        await persistRuntimeProfile({ execution_mode: "sandbox", host_workdir: null });
        return;
      }
      if (!(await ensureHostModeAllowed())) {
        return;
      }
      if (runtimeProfile.host_workdir) {
        await persistRuntimeProfile({
          execution_mode: "host",
          host_workdir: runtimeProfile.host_workdir,
        });
        return;
      }
      handleOpenHostSetup();
    },
    [
      ensureHostModeAllowed,
      handleOpenHostSetup,
      hostModeCopy.locked,
      persistRuntimeProfile,
      runtimeProfile.execution_mode,
      runtimeProfile.host_workdir,
      runtimeProfile.locked,
    ],
  );

  useEffect(() => {
    if (threadId === "new") {
      setRuntimeProfile(DEFAULT_RUNTIME_PROFILE);
      setRuntimeProfileLoading(false);
      setRuntimeProfileSaving(false);
    }
  }, [threadId]);

  useEffect(() => {
    if (!threadId || threadId === "new") {
      return;
    }
    let cancelled = false;
    setRuntimeProfileLoading(true);
    void fetchRuntimeProfile(threadId)
      .then((profile) => {
        if (!cancelled) {
          setRuntimeProfile(profile);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : hostModeCopy.modeSaveFailed;
          toast.error(message || hostModeCopy.modeSaveFailed);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRuntimeProfileLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hostModeCopy.modeSaveFailed, threadId]);

  useEffect(() => {
    if (isNewThread || !threadId || threadId === "new") {
      return;
    }

    let cancelled = false;
    const apiClient = getAPIClient();
    const fallbackPath = `/workspace/agents/${agent_name}/chats/new`;
    const removeInvalidThreadAndRedirect = () => {
      void apiClient.threads.delete(threadId).catch((deleteError) => {
        if (!isThreadNotFoundError(deleteError)) {
          console.warn("Failed to delete invalid thread:", deleteError);
        }
      });
      pruneThreadFromCache(queryClient, threadId);
      router.replace(fallbackPath);
    };

    if (!isUUID(threadId)) {
      pruneThreadFromCache(queryClient, threadId);
      router.replace(fallbackPath);
      return;
    }

    const confirmThreadExists = async () => {
      let notFoundRetries = 0;

      for (let pollAttempt = 0; pollAttempt < THREAD_EMPTY_STATE_MAX_POLLS; pollAttempt += 1) {
        try {
          const threadMeta = await apiClient.threads.get(threadId);
          const threadState = await apiClient.threads.getState<AgentThreadState>(threadId);

          if (hasThreadRenderableState(threadState?.values)) {
            return;
          }

          const hasMorePolls = pollAttempt < THREAD_EMPTY_STATE_MAX_POLLS - 1;
          const isInitializing = isThreadLikelyInitializing(threadMeta);
          if (hasMorePolls) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, THREAD_EMPTY_STATE_POLL_INTERVAL_MS);
            });
            if (cancelled) {
              return;
            }
            continue;
          }

          if (!isInitializing) {
            removeInvalidThreadAndRedirect();
            return;
          }

          return;
        } catch (error) {
          if (!isThreadNotFoundError(error)) {
            return;
          }
          if (notFoundRetries < 1) {
            notFoundRetries += 1;
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, 220);
            });
            if (cancelled) {
              return;
            }
            continue;
          }
          if (cancelled) {
            return;
          }
          pruneThreadFromCache(queryClient, threadId);
          router.replace(fallbackPath);
          return;
        }
      }
    };

    void confirmThreadExists();

    return () => {
      cancelled = true;
    };
  }, [agent_name, isNewThread, queryClient, router, threadId]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      if (hostModeMissingDir) {
        toast.error(hostModeCopy.hostDirMissing);
        return;
      }
      void sendMessage(threadId, message, {
        agent_name,
        execution_mode: runtimeProfile.execution_mode,
        host_workdir: runtimeProfile.host_workdir ?? undefined,
      });
    },
    [agent_name, hostModeCopy.hostDirMissing, hostModeMissingDir, runtimeProfile.execution_mode, runtimeProfile.host_workdir, sendMessage, threadId],
  );

  const handleClarificationSelect = useCallback(
    (option: string) => {
      void handleSubmit({
        text: option,
        files: [],
      });
    },
    [handleSubmit],
  );

  const handleA2UIAction = useCallback(
    (action: A2UIUserAction) => {
      if (hostModeMissingDir) {
        toast.error(hostModeCopy.hostDirMissing);
        return;
      }
      void submitA2UIAction(
        threadId,
        action,
        {
          agent_name,
          execution_mode: runtimeProfile.execution_mode,
          host_workdir: runtimeProfile.host_workdir ?? undefined,
        },
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to submit UI action: ${message}`);
      });
    },
    [agent_name, hostModeCopy.hostDirMissing, hostModeMissingDir, runtimeProfile.execution_mode, runtimeProfile.host_workdir, submitA2UIAction, threadId],
  );

  const handleRetryLastMessage = useCallback(() => {
    if (thread.isLoading) {
      return;
    }
    const retryText = findLastRetryableUserMessage(thread.messages);
    if (!retryText) {
      toast.error(t.workspace.messageList.noRetryableUserMessage);
      return;
    }
    void sendMessage(
      threadId,
      {
        text: retryText,
        files: [],
      },
      {
        agent_name,
        execution_mode: runtimeProfile.execution_mode,
        host_workdir: runtimeProfile.host_workdir ?? undefined,
      },
    ).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`${t.workspace.messageList.retryFailedPrefix}${message}`);
    });
  }, [agent_name, runtimeProfile.execution_mode, runtimeProfile.host_workdir, sendMessage, t.workspace.messageList.noRetryableUserMessage, t.workspace.messageList.retryFailedPrefix, thread.isLoading, thread.messages, threadId]);

  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);

  const renderRuntimeModeToggle = useCallback(
    (className: string) => (
      <RuntimeModeToggle
        className={className}
        mode={runtimeProfile.execution_mode}
        locked={runtimeProfile.locked}
        saving={runtimeProfileSaving}
        desktopOnlyDisabled={!isDesktopRuntime}
        hostDirPath={runtimeProfile.host_workdir}
        copy={hostModeCopy}
        onSwitch={(nextMode) => {
          void handleSwitchMode(nextMode);
        }}
      />
    ),
    [
      handleSwitchMode,
      hostModeCopy,
      isDesktopRuntime,
      runtimeProfile.execution_mode,
      runtimeProfile.host_workdir,
      runtimeProfile.locked,
      runtimeProfileSaving,
    ],
  );

  return (
    <ThreadContext.Provider value={{ thread }}>
      <ChatBox threadId={threadId}>
        <div className="relative flex size-full min-h-0 justify-between">
          <header
            className={cn(
              "absolute top-0 right-0 left-0 z-30 flex h-12 shrink-0 items-center gap-2 px-4",
              isNewThread
                ? "bg-background/0 backdrop-blur-none"
                : "bg-background/80 shadow-xs backdrop-blur",
            )}
          >
            {/* Agent badge */}
            <div className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1">
              <BotIcon className="text-primary h-3.5 w-3.5" />
              <span className="text-xs font-medium">
                {agent?.name ?? agent_name}
              </span>
            </div>

            <div className="flex w-full items-center text-sm font-medium">
              <ThreadTitle threadId={threadId} thread={thread} />
            </div>
            <div className="mr-4 flex items-center gap-1">
              <Tooltip content={t.agents.newChat}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    router.push(`/workspace/agents/${agent_name}/chats/new`);
                  }}
                >
                  <PlusSquare /> {t.agents.newChat}
                </Button>
              </Tooltip>
              <WorkingDirectoryTrigger />
            </div>
          </header>

          <main className="flex min-h-0 max-w-full grow flex-col">
            {isNewThread ? (
              <div className="flex size-full items-center justify-center px-4 pb-16 pt-24 sm:px-6 sm:pb-20">
                <NewChatStage
                  hero={<AgentWelcome className="sm:pb-1" agent={agent} agentName={agent_name} />}
                  controls={renderRuntimeModeToggle("mx-auto")}
                  composer={
                    shouldShowInputBox ? (
                      <InputBox
                        className="w-full bg-background/72 shadow-[0_34px_80px_-52px_rgba(70,60,41,0.4)] ring-1 ring-black/6 backdrop-blur-xl"
                        threadId={threadId}
                        isNewThread={isNewThread}
                        autoFocus={isNewThread}
                        status={thread.isLoading ? "streaming" : "ready"}
                        context={settings.context}
                        disabled={inputDisabled}
                        onContextChange={(context) => setSettings("context", context)}
                        onSubmit={handleSubmit}
                        onStop={handleStop}
                      />
                    ) : null
                  }
                  footer={
                    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" ? (
                      <div className="text-muted-foreground/67 text-xs">
                        {t.common.notAvailableInDemoMode}
                      </div>
                    ) : null
                  }
                />
              </div>
            ) : (
              <>
                <div className="flex size-full justify-center">
                  <MessageList
                    className={cn("size-full", !isNewThread && "pt-10")}
                    threadId={threadId}
                    thread={thread}
                    onClarificationSelect={handleClarificationSelect}
                    onRetryLastMessage={handleRetryLastMessage}
                    onA2UIAction={handleA2UIAction}
                  />
                </div>
                <div className="absolute right-0 bottom-0 left-0 z-30 flex justify-center px-4">
                  <div className="relative w-full max-w-(--container-width-md)">
                    <div className="absolute -top-4 right-0 left-0 z-0">
                      <div className="absolute right-0 bottom-0 left-0">
                        <TodoList
                          className="bg-background/5"
                          todos={thread.values.todos ?? []}
                          hidden={
                            !thread.values.todos || thread.values.todos.length === 0
                          }
                        />
                      </div>
                    </div>

                    {shouldShowInputBox ? (
                      <InputBox
                        className={cn("bg-background/5 w-full")}
                        threadId={threadId}
                        isNewThread={isNewThread}
                        autoFocus={isNewThread}
                        status={thread.isLoading ? "streaming" : "ready"}
                        context={settings.context}
                        disabled={inputDisabled}
                        onContextChange={(context) => setSettings("context", context)}
                        onSubmit={handleSubmit}
                        onStop={handleStop}
                      />
                    ) : null}
                    {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" && (
                      <div className="text-muted-foreground/67 w-full translate-y-12 text-center text-xs">
                        {t.common.notAvailableInDemoMode}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
        <Dialog
          open={hostSetupDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              handleCancelHostSetup();
            }
          }}
        >
          <DialogContent className="max-w-md" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{hostModeCopy.hostDialogTitle}</DialogTitle>
              <DialogDescription>{hostModeCopy.hostDialogDescription}</DialogDescription>
            </DialogHeader>
            {hostSetupErrorMessage ? (
              <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                {hostSetupErrorMessage}
              </div>
            ) : null}
            {hostSetupCreateBaseDir ? (
              <div className="rounded-md border border-border/70 bg-muted/25 px-3 py-2 text-sm">
                <div className="text-muted-foreground">
                  {hostModeCopy.hostDirNotEmptyHint}
                </div>
                {!hostSetupCreateInputVisible ? (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setHostSetupCreateInputVisible(true)}
                    >
                      {hostModeCopy.createEmptyFolderAndUse}
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      value={hostSetupCreateDirName}
                      onChange={(event) => setHostSetupCreateDirName(event.target.value)}
                      placeholder={hostModeCopy.folderNamePlaceholder}
                      className="h-9"
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        void handleCreateWorkspaceFromSelectedDir();
                      }}
                      disabled={hostSetupCreateSaving}
                    >
                      {hostSetupCreateSaving
                        ? hostModeCopy.creating
                        : hostModeCopy.confirm}
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={handleCancelHostSetup}
              >
                {hostModeCopy.hostDialogCancel}
              </Button>
              <Button
                onClick={() => {
                  void handleChooseHostSetupDirectory();
                }}
                variant="outline"
                disabled={runtimeProfileSaving || hostSetupCreateSaving}
              >
                {hostModeCopy.hostDialogChooseDir}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </ChatBox>
    </ThreadContext.Provider>
  );
}
