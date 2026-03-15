"use client";

import { ArrowLeftIcon, CheckCircleIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { ArtifactsProvider } from "@/components/workspace/artifacts";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import type { A2UIUserAction } from "@/core/a2ui/types";
import { useI18n } from "@/core/i18n/hooks";
import { findLastRetryableUserMessage } from "@/core/messages/retry";
import { useAppRouter as useRouter } from "@/core/navigation";
import { useLocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { uuid } from "@/core/utils/uuid";

export default function AgentBootstrapPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [settings] = useLocalSettings();
  const copy = t.agents.bootstrap;

  const threadId = useMemo(() => uuid(), []);
  const firstMessageSentRef = useRef(false);
  const [completed, setCompleted] = useState(false);

  const [thread, sendMessage, submitA2UIAction] = useThreadStream({
    threadId,
    context: {
      ...settings.context,
      mode: "flash",
      is_bootstrap: true,
    },
    onToolEnd({ name }) {
      if (name !== "setup_agent") return;
      setCompleted(true);
    },
  });

  useEffect(() => {
    if (firstMessageSentRef.current) return;
    firstMessageSentRef.current = true;
    void sendMessage(threadId, { text: copy.startMessage, files: [] });
  }, [copy.startMessage, sendMessage, threadId]);

  const handleChatSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thread.isLoading) return;
      await sendMessage(threadId, { text: trimmed, files: [] });
    },
    [sendMessage, thread.isLoading, threadId],
  );

  const handleA2UIAction = useCallback(
    (action: A2UIUserAction) => {
      if (thread.isLoading) {
        return;
      }
      void submitA2UIAction(threadId, action).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to submit UI action: ${message}`);
      });
    },
    [submitA2UIAction, thread.isLoading, threadId],
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
    void sendMessage(threadId, { text: retryText, files: [] }).catch(
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`${t.workspace.messageList.retryFailedPrefix}${message}`);
      },
    );
  }, [
    sendMessage,
    t.workspace.messageList.noRetryableUserMessage,
    t.workspace.messageList.retryFailedPrefix,
    thread.isLoading,
    thread.messages,
    threadId,
  ]);

  return (
    <ThreadContext.Provider value={{ thread }}>
      <ArtifactsProvider>
        <div className="flex size-full flex-col">
          <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => router.push("/workspace/agents")}
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>
            <h1 className="text-sm font-semibold">{copy.pageTitle}</h1>
          </header>

          <main className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 justify-center">
              <MessageList
                className="size-full pt-10"
                threadId={threadId}
                thread={thread}
                onClarificationSelect={(option) => {
                  void handleChatSubmit(option);
                }}
                onRetryLastMessage={handleRetryLastMessage}
                onA2UIAction={handleA2UIAction}
              />
            </div>

            <div className="bg-background flex shrink-0 justify-center border-t px-4 py-4">
              <div className="w-full max-w-(--container-width-md)">
                {completed ? (
                  <div className="flex flex-col items-center gap-4 rounded-2xl border py-8 text-center">
                    <CheckCircleIcon className="text-primary h-10 w-10" />
                    <p className="font-semibold">{copy.completedTitle}</p>
                    <div className="flex gap-2">
                      <Button
                        onClick={() =>
                          router.push(
                            "/workspace/agents/_default/settings?section=soul",
                          )
                        }
                      >
                        {copy.reviewSoul}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => router.push("/workspace/agents")}
                      >
                        {t.agents.backToGallery}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <PromptInput
                    onSubmit={({ text }) => void handleChatSubmit(text)}
                  >
                    <PromptInputTextarea
                      autoFocus
                      placeholder={copy.pageSubtitle}
                      disabled={thread.isLoading}
                    />
                    <PromptInputFooter className="justify-end">
                      <PromptInputSubmit disabled={thread.isLoading} />
                    </PromptInputFooter>
                  </PromptInput>
                )}
              </div>
            </div>
          </main>
        </div>
      </ArtifactsProvider>
    </ThreadContext.Provider>
  );
}

