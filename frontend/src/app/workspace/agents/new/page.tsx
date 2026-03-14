"use client";

import { ArrowLeftIcon, BotIcon, CheckCircleIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArtifactsProvider } from "@/components/workspace/artifacts";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import type { Agent } from "@/core/agents";
import { checkAgentName, getAgent } from "@/core/agents/api";
import { AGENT_SLUG_RE, toAgentSlug } from "@/core/agents/slug";
import type { A2UIUserAction } from "@/core/a2ui/types";
import { useI18n } from "@/core/i18n/hooks";
import { findLastRetryableUserMessage } from "@/core/messages/retry";
import { useAppRouter as useRouter } from "@/core/navigation";
import { useLocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { uuid } from "@/core/utils/uuid";
import { cn } from "@/lib/utils";

type Step = "name" | "chat";

export default function NewAgentPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [settings] = useLocalSettings();

  // ── Step 1: name form ──────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("name");
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [nameError, setNameError] = useState("");
  const [isCheckingName, setIsCheckingName] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentDisplayName, setAgentDisplayName] = useState("");
  const [agent, setAgent] = useState<Agent | null>(null);
  // ── Step 2: chat ───────────────────────────────────────────────────────────

  // Stable thread ID — all turns belong to the same thread
  const threadId = useMemo(() => uuid(), []);

  const [thread, sendMessage, submitA2UIAction] = useThreadStream({
    threadId: step === "chat" ? threadId : undefined,
    context: {
      ...settings.context,
      mode: "flash",
      is_bootstrap: true,
    },
    onToolEnd({ name }) {
      if (name !== "setup_agent" || !agentName) return;
      getAgent(agentName)
        .then((fetched) => setAgent(fetched))
        .catch(() => {
          // agent write may not be flushed yet — ignore silently
        });
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleConfirmName = useCallback(async () => {
    const displayName = displayNameInput.trim();
    if (!displayName) return;

    const candidateSlug = (slugInput.trim() || toAgentSlug(displayName)).trim();
    if (!candidateSlug) {
      setNameError(t.agents.nameStepInvalidError);
      return;
    }
    if (!AGENT_SLUG_RE.test(candidateSlug)) {
      setNameError(t.agents.nameStepInvalidError);
      return;
    }

    setNameError("");
    setIsCheckingName(true);
    let normalizedSlug = "";
    try {
      const initial = await checkAgentName(candidateSlug);
      normalizedSlug = initial.name;

      if (!initial.available) {
        if (slugManuallyEdited) {
          setNameError(t.agents.nameStepAlreadyExistsError);
          return;
        }

        let cursor = 2;
        while (cursor <= 50) {
          const alt = await checkAgentName(`${normalizedSlug}-${cursor}`);
          if (alt.available) {
            normalizedSlug = alt.name;
            break;
          }
          cursor += 1;
        }

        // Still taken after trying suffixes.
        if (cursor > 50) {
          setNameError(t.agents.nameStepAlreadyExistsError);
          return;
        }
      }
    } catch {
      setNameError(t.agents.nameStepCheckError);
      return;
    } finally {
      setIsCheckingName(false);
    }

    setSlugInput(normalizedSlug);
    setAgentName(normalizedSlug);
    setAgentDisplayName(displayName);
    setStep("chat");
    await sendMessage(threadId, {
      text: t.agents.nameStepBootstrapMessage
        .replace("{displayName}", displayName)
        .replace("{name}", normalizedSlug),
      files: [],
    }, { agent_name: normalizedSlug, agent_display_name: displayName });
  }, [
    displayNameInput,
    sendMessage,
    slugInput,
    slugManuallyEdited,
    threadId,
    t.agents.nameStepBootstrapMessage,
    t.agents.nameStepInvalidError,
    t.agents.nameStepAlreadyExistsError,
    t.agents.nameStepCheckError,
  ]);

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleConfirmName();
    }
  };

  const handleChatSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thread.isLoading) return;
      await sendMessage(
        threadId,
        { text: trimmed, files: [] },
        { agent_name: agentName, agent_display_name: agentDisplayName },
      );
    },
    [thread.isLoading, sendMessage, threadId, agentName, agentDisplayName],
  );

  const handleA2UIAction = useCallback(
    (action: A2UIUserAction) => {
      if (thread.isLoading) {
        return;
      }
      void submitA2UIAction(
        threadId,
        action,
        { agent_name: agentName, agent_display_name: agentDisplayName },
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to submit UI action: ${message}`);
      });
    },
    [agentName, agentDisplayName, submitA2UIAction, thread.isLoading, threadId],
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
      { agent_name: agentName, agent_display_name: agentDisplayName },
    ).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`${t.workspace.messageList.retryFailedPrefix}${message}`);
    });
  }, [agentName, agentDisplayName, sendMessage, t.workspace.messageList.noRetryableUserMessage, t.workspace.messageList.retryFailedPrefix, thread.isLoading, thread.messages, threadId]);

  // ── Shared header ──────────────────────────────────────────────────────────

  const header = (
    <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => router.push("/workspace/agents")}
      >
        <ArrowLeftIcon className="h-4 w-4" />
      </Button>
      <h1 className="text-sm font-semibold">{t.agents.createPageTitle}</h1>
    </header>
  );

  // ── Step 1: name form ──────────────────────────────────────────────────────

  if (step === "name") {
    return (
      <div className="flex size-full flex-col">
        {header}
        <main className="flex flex-1 flex-col items-center justify-center px-4">
          <div className="w-full max-w-sm space-y-8">
            <div className="space-y-3 text-center">
              <div className="bg-primary/10 mx-auto flex h-14 w-14 items-center justify-center rounded-full">
                <BotIcon className="text-primary h-7 w-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">
                  {t.agents.nameStepTitle}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {t.agents.nameStepHint}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="agent-display-name">{t.agents.nameStepDisplayNameLabel}</Label>
                <Input
                  id="agent-display-name"
                  autoFocus
                  placeholder={t.agents.nameStepDisplayNamePlaceholder}
                  value={displayNameInput}
                  onChange={(e) => {
                    const next = e.target.value;
                    setDisplayNameInput(next);
                    setNameError("");
                    if (!slugManuallyEdited) {
                      setSlugInput(toAgentSlug(next));
                    }
                  }}
                  onKeyDown={handleNameKeyDown}
                  className={cn(nameError && "border-destructive")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="agent-slug">{t.agents.nameStepSlugLabel}</Label>
                <Input
                  id="agent-slug"
                  placeholder={t.agents.nameStepPlaceholder}
                  value={slugInput}
                  onChange={(e) => {
                    setSlugInput(e.target.value);
                    setSlugManuallyEdited(true);
                    setNameError("");
                  }}
                  onKeyDown={handleNameKeyDown}
                  className={cn(nameError && "border-destructive")}
                />
              </div>

              {nameError && (
                <p className="text-destructive text-sm">{nameError}</p>
              )}
              <Button
                className="w-full"
                onClick={() => void handleConfirmName()}
                disabled={!displayNameInput.trim() || !slugInput.trim() || isCheckingName}
              >
                {t.agents.nameStepContinue}
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Step 2: chat ───────────────────────────────────────────────────────────

  return (
    <ThreadContext.Provider value={{ thread }}>
      <ArtifactsProvider>
        <div className="flex size-full flex-col">
          {header}

          <main className="flex min-h-0 flex-1 flex-col">
            {/* ── Message area ── */}
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

            {/* ── Bottom action area ── */}
            <div className="bg-background flex shrink-0 justify-center border-t px-4 py-4">
              <div className="w-full max-w-(--container-width-md)">
                {agent ? (
                  // ✅ Success card
                  <div className="flex flex-col items-center gap-4 rounded-2xl border py-8 text-center">
                    <CheckCircleIcon className="text-primary h-10 w-10" />
                    <p className="font-semibold">{t.agents.agentCreated}</p>
                    <div className="flex gap-2">
                      <Button
                        onClick={() =>
                          router.push(
                            `/workspace/agents/${agentName}/chats/new`,
                          )
                        }
                      >
                        {t.agents.startChatting}
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
                  // 📝 Normal input
                  <PromptInput
                    onSubmit={({ text }) => void handleChatSubmit(text)}
                  >
                    <PromptInputTextarea
                      autoFocus
                      placeholder={t.agents.createPageSubtitle}
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
