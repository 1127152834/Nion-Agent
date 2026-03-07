"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { type PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { WorkingDirectoryTrigger } from "@/components/workspace/artifacts";
import {
  ChatBox,
  useSpecificChatMode,
  useThreadChat,
} from "@/components/workspace/chats";
import { InputBox } from "@/components/workspace/input-box";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { TodoList } from "@/components/workspace/todo-list";
import { Welcome } from "@/components/workspace/welcome";
import { getAPIClient } from "@/core/api";
import { getLangGraphBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { useNotification } from "@/core/notification/hooks";
import { useLocalSettings } from "@/core/settings";
import { useDeleteThread, useThreadStream } from "@/core/threads/hooks";
import { textOfMessage } from "@/core/threads/utils";
import { env } from "@/env";
import { cn } from "@/lib/utils";

export default function ChatPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [settings, setSettings] = useLocalSettings();
  const searchParams = useSearchParams();

  const { threadId, isNewThread, setIsNewThread, isMock } = useThreadChat();
  const isTemporaryMode = searchParams.get("mode") === "temporary-chat";
  const prefillPrompt = searchParams.get("prefill")?.trim() ?? "";
  const prefillSentRef = useRef<string | null>(null);
  const temporaryCleanupTriggeredRef = useRef(false);
  useSpecificChatMode();

  const { mutateAsync: deleteThread } = useDeleteThread();
  const { showNotification } = useNotification();

  const [thread, sendMessage] = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    context: settings.context,
    isMock,
    onStart: (startedThreadId) => {
      setIsNewThread(false);
      history.replaceState(
        null,
        "",
        isTemporaryMode
          ? `/workspace/chats/${startedThreadId}?mode=temporary-chat`
          : `/workspace/chats/${startedThreadId}`,
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

  const isTemporarySession = isTemporaryMode || thread.values.session_mode === "temporary_chat";

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
      void sendMessage(
        threadId,
        message,
        isTemporarySession
          ? {
              memory_read: true,
              memory_write: false,
              session_mode: "temporary_chat",
            }
          : undefined,
      );
    },
    [isTemporarySession, sendMessage, threadId],
  );
  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);

  const handleEndTemporaryChat = useCallback(async () => {
    await cleanupTemporaryThread(false);
    void router.push("/workspace/chats/new");
  }, [cleanupTemporaryThread, router]);

  useEffect(() => {
    if (!isNewThread || !prefillPrompt) {
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
      isTemporarySession
        ? {
            memory_read: true,
            memory_write: false,
            session_mode: "temporary_chat",
          }
        : undefined,
    ).catch(() => {
      prefillSentRef.current = null;
    });
  }, [isNewThread, isTemporarySession, prefillPrompt, sendMessage, threadId]);

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
            <div className="flex size-full justify-center">
              <MessageList
                className={cn("size-full", !isNewThread && "pt-10")}
                threadId={threadId}
                thread={thread}
              />
            </div>
            <div className="absolute right-0 bottom-0 left-0 z-30 flex justify-center px-4">
              <div
                className={cn(
                  "relative w-full",
                  isNewThread && "-translate-y-[calc(50vh-96px)]",
                  isNewThread
                    ? "max-w-(--container-width-sm)"
                    : "max-w-(--container-width-md)",
                )}
              >
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
                {isTemporarySession && !isNewThread ? (
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
                <InputBox
                  className={cn("bg-background/5 w-full -translate-y-4")}
                  threadId={threadId}
                  isNewThread={isNewThread}
                  autoFocus={isNewThread}
                  status={thread.isLoading ? "streaming" : "ready"}
                  context={settings.context}
                  extraHeader={
                    isNewThread && <Welcome mode={settings.context.mode} />
                  }
                  disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"}
                  onContextChange={(context) => setSettings("context", context)}
                  onSubmit={handleSubmit}
                  onStop={handleStop}
                />
                {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" && (
                  <div className="text-muted-foreground/67 w-full translate-y-12 text-center text-xs">
                    {t.common.notAvailableInDemoMode}
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </ChatBox>
    </ThreadContext.Provider>
  );
}
