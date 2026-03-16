"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { type PromptInputMessage } from "@/components/ai-elements/prompt-input";
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
import { AgentPickerCards } from "@/components/workspace/agents/agent-picker-cards";
import { WorkingDirectoryTrigger } from "@/components/workspace/artifacts";
import {
  ChatBox,
  getChatThreadVisibilityOverrides,
  useSpecificChatMode,
  useThreadChat,
} from "@/components/workspace/chats";
import { InputBox } from "@/components/workspace/input-box";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import { NewChatStage } from "@/components/workspace/new-chat-stage";
import { RuntimeModeToggle } from "@/components/workspace/runtime-mode-toggle";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { TodoList } from "@/components/workspace/todo-list";
import { Welcome } from "@/components/workspace/welcome";
import type { A2UIUserAction } from "@/core/a2ui/types";
import { getAPIClient } from "@/core/api";
import { getLangGraphBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { findLastRetryableUserMessage } from "@/core/messages/retry";
import { useAppRouter as useRouter } from "@/core/navigation";
import { useNotification } from "@/core/notification/hooks";
import { platform } from "@/core/platform";
import { useDesktopRuntime } from "@/core/platform/hooks";
import { type RuntimeProfile, fetchRuntimeProfile, updateRuntimeProfile } from "@/core/runtime";
import { useLocalSettings } from "@/core/settings";
import { fetchSandboxPolicy } from "@/core/system/api";
import type { AgentThreadState } from "@/core/threads";
import {
  isThreadNotFoundError,
  pruneThreadFromCache,
  useDeleteThread,
  useThreadStream,
} from "@/core/threads/hooks";
import {
  hasThreadRenderableState,
  isThreadLikelyInitializing,
  THREAD_EMPTY_STATE_MAX_POLLS,
  THREAD_EMPTY_STATE_POLL_INTERVAL_MS,
} from "@/core/threads/thread-guard";
import { pathOfNewThread, pathOfThread, textOfMessage } from "@/core/threads/utils";
import { isUUID } from "@/core/utils/uuid";
import { env } from "@/env";
import { cn } from "@/lib/utils";

const DEFAULT_RUNTIME_PROFILE: RuntimeProfile = {
  execution_mode: "sandbox",
  host_workdir: null,
  locked: false,
  updated_at: null,
};

export default function ChatPage() {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useLocalSettings();
  const searchParams = useSearchParams();
  const { isDesktopRuntime } = useDesktopRuntime();

  const { threadId, setThreadId, isNewThread, setIsNewThread, isMock } = useThreadChat();
  const isTemporaryMode = searchParams.get("mode") === "temporary-chat";
  const chatMode = searchParams.get("mode")?.trim() ?? "";
  const prefillPrompt = searchParams.get("prefill")?.trim() ?? "";
  const chatThreadVisibilityOverrides = useMemo(
    () => getChatThreadVisibilityOverrides(chatMode),
    [chatMode],
  );
  const prefillSentRef = useRef<string | null>(null);
  const temporaryCleanupTriggeredRef = useRef(false);
  useSpecificChatMode();

  const { mutateAsync: deleteThread } = useDeleteThread();
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
  const applyChatThreadVisibility = useCallback(
    (targetThreadId: string) => {
      if (!chatThreadVisibilityOverrides) {
        return;
      }
      void getAPIClient(isMock).threads.updateState(targetThreadId, {
        values: chatThreadVisibilityOverrides,
      }).catch((error) => {
        console.warn("Failed to mark special chat thread visibility:", error);
      });
    },
    [chatThreadVisibilityOverrides, isMock],
  );

  const [thread, sendMessage, submitA2UIAction] = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    context: settings.context,
    isMock,
    onStart: (startedThreadId) => {
      setThreadId(startedThreadId);
      setIsNewThread(false);
      router.replace(
        isTemporaryMode
          ? `${pathOfThread(startedThreadId)}?mode=temporary-chat`
          : pathOfThread(startedThreadId),
      );
      if (isTemporaryMode) {
        const apiClient = getAPIClient(isMock);
        void apiClient.threads
          .updateState(startedThreadId, {
            values: {
              session_mode: "temporary_chat",
            },
          })
          .catch((updateError) => {
            console.error("Failed to mark temporary chat mode:", updateError);
          });
      }
      applyChatThreadVisibility(startedThreadId);
    },
    onFinish: (state) => {
      if (document.hidden || !document.hasFocus()) {
        let body = "Conversation finished";
        const lastMessage = state.messages.at(-1);
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

  // Keep MessageList bottom padding and the composer mask in sync.
  // The composer is translucent and floats above the message list; without a mask, users can
  // scroll content into the "gap" under the composer and still see it.
  const messageListBottomPaddingPx = 232;

  useEffect(() => {
    if (!chatThreadVisibilityOverrides) {
      return;
    }
    if (!threadId || threadId === "new") {
      return;
    }
    applyChatThreadVisibility(threadId);
  }, [applyChatThreadVisibility, chatThreadVisibilityOverrides, threadId]);

  const isTemporarySession = isTemporaryMode || thread.values.session_mode === "temporary_chat";
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
      if (isMock) {
        return true;
      }
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
    [hostModeCopy.modeSaveFailed, isMock, mapRuntimeProfileError, threadId],
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
    if (isMock || !threadId || threadId === "new") {
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
  }, [hostModeCopy.modeSaveFailed, isMock, threadId]);

  useEffect(() => {
    if (isMock || isNewThread || !threadId || threadId === "new") {
      return;
    }

    if (!isUUID(threadId)) {
      pruneThreadFromCache(queryClient, threadId);
      router.replace(pathOfNewThread());
      return;
    }

    let cancelled = false;
    const apiClient = getAPIClient(isMock);
    const removeInvalidThreadAndRedirect = () => {
      void apiClient.threads.delete(threadId).catch((deleteError) => {
        if (!isThreadNotFoundError(deleteError)) {
          console.warn("Failed to delete invalid thread:", deleteError);
        }
      });
      pruneThreadFromCache(queryClient, threadId);
      router.replace(pathOfNewThread());
    };

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
          router.replace(pathOfNewThread());
          return;
        }
      }
    };

    void confirmThreadExists();

    return () => {
      cancelled = true;
    };
  }, [isMock, isNewThread, queryClient, router, threadId]);

  const cleanupTemporaryThread = useCallback(
    async (useKeepalive: boolean) => {
      if (
        temporaryCleanupTriggeredRef.current ||
        !isTemporarySession ||
        isNewThread ||
        threadId === "new"
      ) {
        return;
      }

      temporaryCleanupTriggeredRef.current = true;

      if (useKeepalive) {
        const base = getLangGraphBaseURL(isMock).replace(/\/$/, "");
        const url = `${base}/threads/${encodeURIComponent(threadId)}`;
        try {
          void fetch(url, {
            method: "DELETE",
            keepalive: true,
          });
        } catch (cleanupError) {
          console.error("Failed to keepalive-delete temporary thread:", cleanupError);
        }
        return;
      }

      try {
        await deleteThread({ threadId });
      } catch (cleanupError) {
        console.error("Failed to delete temporary thread:", cleanupError);
      }
    },
    [deleteThread, isMock, isNewThread, isTemporarySession, threadId],
  );

  useEffect(() => {
    temporaryCleanupTriggeredRef.current = false;
  }, [threadId]);

  useEffect(() => {
    if (!isTemporarySession || isNewThread || threadId === "new") {
      return;
    }

    const handlePageLeave = () => {
      void cleanupTemporaryThread(true);
    };
    window.addEventListener("pagehide", handlePageLeave);
    window.addEventListener("beforeunload", handlePageLeave);

    return () => {
      window.removeEventListener("pagehide", handlePageLeave);
      window.removeEventListener("beforeunload", handlePageLeave);
      void cleanupTemporaryThread(false);
    };
  }, [cleanupTemporaryThread, isNewThread, isTemporarySession, threadId]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      if (hostModeMissingDir) {
        toast.error(hostModeCopy.hostDirMissing);
        return;
      }
      void sendMessage(
        threadId,
        message,
        {
          ...(isTemporarySession
            ? {
              memory_read: true,
              memory_write: false,
              session_mode: "temporary_chat",
            }
            : {}),
          execution_mode: runtimeProfile.execution_mode,
          host_workdir: runtimeProfile.host_workdir ?? undefined,
          ...(chatThreadVisibilityOverrides ?? {}),
        },
      );
    },
    [chatThreadVisibilityOverrides, hostModeCopy.hostDirMissing, hostModeMissingDir, isTemporarySession, runtimeProfile.execution_mode, runtimeProfile.host_workdir, sendMessage, threadId],
  );

  const handleCLIInteractiveSubmit = useCallback(
    (text: string) => {
      if (hostModeMissingDir) {
        toast.error(hostModeCopy.hostDirMissing);
        return;
      }
      void sendMessage(
        threadId,
        { text, files: [] },
        {
          ...(isTemporarySession
            ? {
              memory_read: true,
              memory_write: false,
              session_mode: "temporary_chat",
            }
            : {}),
          execution_mode: runtimeProfile.execution_mode,
          host_workdir: runtimeProfile.host_workdir ?? undefined,
          ...(chatThreadVisibilityOverrides ?? {}),
        },
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to send CLI input: ${message}`);
      });
    },
    [chatThreadVisibilityOverrides, hostModeCopy.hostDirMissing, hostModeMissingDir, isTemporarySession, runtimeProfile.execution_mode, runtimeProfile.host_workdir, sendMessage, threadId],
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
          ...(isTemporarySession
            ? {
              memory_read: true,
              memory_write: false,
              session_mode: "temporary_chat",
            }
            : {}),
          execution_mode: runtimeProfile.execution_mode,
          host_workdir: runtimeProfile.host_workdir ?? undefined,
          ...(chatThreadVisibilityOverrides ?? {}),
        },
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to submit UI action: ${message}`);
      });
    },
    [chatThreadVisibilityOverrides, hostModeCopy.hostDirMissing, hostModeMissingDir, isTemporarySession, runtimeProfile.execution_mode, runtimeProfile.host_workdir, submitA2UIAction, threadId],
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
        ...(isTemporarySession
          ? {
            memory_read: true,
            memory_write: false,
            session_mode: "temporary_chat",
          }
          : {}),
        execution_mode: runtimeProfile.execution_mode,
        host_workdir: runtimeProfile.host_workdir ?? undefined,
        ...(chatThreadVisibilityOverrides ?? {}),
      },
    ).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`${t.workspace.messageList.retryFailedPrefix}${message}`);
    });
  }, [chatThreadVisibilityOverrides, isTemporarySession, runtimeProfile.execution_mode, runtimeProfile.host_workdir, sendMessage, t.workspace.messageList.noRetryableUserMessage, t.workspace.messageList.retryFailedPrefix, thread.isLoading, thread.messages, threadId]);

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
        desktopOnlyDisabled={!isDesktopRuntime || isMock}
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
      isMock,
      runtimeProfile.execution_mode,
      runtimeProfile.host_workdir,
      runtimeProfile.locked,
      runtimeProfileSaving,
    ],
  );

  const handleEndTemporaryChat = useCallback(async () => {
    await cleanupTemporaryThread(false);
    void router.push(pathOfNewThread());
  }, [cleanupTemporaryThread, router]);

  useEffect(() => {
    if (!isNewThread || !prefillPrompt || hostModeMissingDir) {
      return;
    }
    const requestKey = `${threadId}:${prefillPrompt}`;
    if (prefillSentRef.current === requestKey) {
      return;
    }
    prefillSentRef.current = requestKey;
    void sendMessage(
      threadId,
      {
        text: prefillPrompt,
        files: [],
      },
      {
        ...(isTemporarySession
          ? {
              memory_read: true,
              memory_write: false,
              session_mode: "temporary_chat",
            }
          : {}),
        execution_mode: runtimeProfile.execution_mode,
        host_workdir: runtimeProfile.host_workdir ?? undefined,
      },
    ).catch(() => {
      prefillSentRef.current = null;
    });
  }, [
    isNewThread,
    isTemporarySession,
    hostModeMissingDir,
    prefillPrompt,
    runtimeProfile.execution_mode,
    runtimeProfile.host_workdir,
    sendMessage,
    threadId,
  ]);

  return (
    <ThreadContext.Provider value={{ thread, isMock }}>
      <ChatBox threadId={threadId}>
        <div className="relative flex size-full min-h-0 justify-between">
          <header
            className={cn(
              "absolute top-0 right-0 left-0 z-30 flex h-12 shrink-0 items-center px-4",
              isNewThread
                ? "bg-background/0 backdrop-blur-none"
                : "bg-background/80 shadow-xs backdrop-blur",
            )}
          >
            <div className="flex w-full items-center text-sm font-medium">
              <ThreadTitle threadId={threadId} thread={thread} />
            </div>
            <div className="flex items-center gap-1">
              <WorkingDirectoryTrigger />
            </div>
          </header>
          <main className="flex min-h-0 max-w-full grow flex-col">
            {isNewThread ? (
              <div className="flex size-full items-center justify-center px-4 pb-16 pt-24 sm:px-6 sm:pb-20">
                <NewChatStage
                  hero={<Welcome className="sm:pb-1" mode={settings.context.mode} />}
                  controls={(
                    <div className="flex w-full flex-col items-center gap-5">
                      <AgentPickerCards selectedAgentName="_default" />
                      {renderRuntimeModeToggle("mx-auto")}
                    </div>
                  )}
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
                    paddingBottom={messageListBottomPaddingPx}
                    onClarificationSelect={handleClarificationSelect}
                    onRetryLastMessage={handleRetryLastMessage}
                    onSubmitMessage={handleCLIInteractiveSubmit}
                    onA2UIAction={handleA2UIAction}
                  />
                </div>
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute right-0 bottom-0 left-0 z-20 bg-gradient-to-t from-background to-transparent"
                  style={{ height: messageListBottomPaddingPx }}
                />
                <div className="pointer-events-none absolute right-0 bottom-4 left-0 z-30 flex justify-center px-4 sm:bottom-6 sm:px-6">
                  <div className="pointer-events-auto relative w-full max-w-(--container-width-md)">
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
                    {isTemporarySession ? (
                      <div className="mb-2 flex items-center justify-end px-1 text-xs">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => {
                            void handleEndTemporaryChat();
                          }}
                        >
                          {t.settings.memory.hub.endTemporary}
                        </Button>
                      </div>
                    ) : null}
                    {shouldShowInputBox ? (
                      <InputBox
                        className={cn("w-full bg-background/72 shadow-[0_24px_60px_-36px_rgba(70,60,41,0.35)] ring-1 ring-black/6 backdrop-blur-xl")}
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
