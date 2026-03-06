"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { type PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { ArtifactCenter } from "@/components/workspace/artifact-center";
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
import { useI18n } from "@/core/i18n/hooks";
import { useNotification } from "@/core/notification/hooks";
import { useLocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { textOfMessage } from "@/core/threads/utils";
import { env } from "@/env";
import { cn } from "@/lib/utils";

export default function ChatPage() {
  const { t } = useI18n();
  const [settings, setSettings] = useLocalSettings();
  const searchParams = useSearchParams();

  const { threadId, isNewThread, setIsNewThread, isMock } = useThreadChat();
  const prefillPrompt = searchParams.get("prefill")?.trim() ?? "";
  const prefillSentRef = useRef<string | null>(null);
  useSpecificChatMode();

  const { showNotification } = useNotification();

  const [thread, sendMessage] = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    context: settings.context,
    isMock,
    onStart: () => {
      setIsNewThread(false);
      history.replaceState(null, "", `/workspace/chats/${threadId}`);
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

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      void sendMessage(threadId, message);
    },
    [sendMessage, threadId],
  );
  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);

  useEffect(() => {
    if (!isNewThread || !prefillPrompt) {
      return;
    }
    const requestKey = `${threadId}:${prefillPrompt}`;
    if (prefillSentRef.current === requestKey) {
      return;
    }
    prefillSentRef.current = requestKey;
    void sendMessage(threadId, {
      text: prefillPrompt,
      files: [],
    }).catch(() => {
      prefillSentRef.current = null;
    });
  }, [isNewThread, prefillPrompt, sendMessage, threadId]);

  return (
    <ThreadContext.Provider value={{ thread, isMock }}>
      <ChatBox threadId={threadId}>
        <div className="relative flex size-full min-h-0 justify-between">
          <main className="flex min-h-0 max-w-full grow flex-col">
            <div className="flex size-full justify-center">
              <MessageList className="size-full" threadId={threadId} thread={thread} />
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
                {!isNewThread && (
                  <div className="bg-background/70 mb-2 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 backdrop-blur">
                    <div className="min-w-0 text-sm font-medium">
                      <ThreadTitle threadId={threadId} thread={thread} />
                    </div>
                    <div className="flex items-center gap-1">
                      <WorkingDirectoryTrigger />
                      <ArtifactCenter threadId={threadId} />
                    </div>
                  </div>
                )}
                <InputBox
                  className={cn("bg-background/5 w-full -translate-y-4")}
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
