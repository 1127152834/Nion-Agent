"use client";

import {
  BotIcon,
  Loader2Icon,
  MessageCircleIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import {
  extractContentFromMessage,
  extractReasoningContentFromMessage,
  hasContent,
  hasReasoning,
} from "@/core/messages/utils";
import {
  useRSSAssistantPanelState,
  useRSSContext,
  useRSSEntryThreadSession,
  type RSSContextBlock,
  type RSSEntry,
  useSummarizeRSSEntry,
  useTranslateRSSEntry,
} from "@/core/rss";
import { useLocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { uuid } from "@/core/utils/uuid";
import { cn } from "@/lib/utils";

import { RSSAssistantSpline } from "./ai-spline";
import { AssistantContextBar } from "./assistant-context-bar";

const MIN_PANEL_WIDTH = 380;
const MAX_PANEL_WIDTH = 760;
const MIN_PANEL_HEIGHT = 500;
const MAX_PANEL_HEIGHT = 860;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatSelectedTextPrompt(text: string, template: string) {
  return template.replace("{text}", text);
}

type AssistantPrefillRequest = {
  id: number;
  prompt: string;
};

function buildSelectedTextBlock(
  text: string,
  entry: RSSEntry,
): RSSContextBlock {
  return {
    id: "selectedText",
    type: "selectedText",
    value: text,
    metadata: {
      entry_id: entry.id,
      feed_id: entry.feed_id,
      title: entry.title,
      url: entry.url,
      summary: entry.description,
    },
  };
}

export function FloatingEntryAssistant({
  entry,
  prefillRequest,
}: {
  entry: RSSEntry;
  prefillRequest: AssistantPrefillRequest | null;
}) {
  const { t } = useI18n();
  const [settings] = useLocalSettings();
  const summarizeEntryMutation = useSummarizeRSSEntry();
  const translateEntryMutation = useTranslateRSSEntry();
  const { blocks, addBlock, removeBlock } = useRSSContext();
  const { threadId, setThreadId, clearThread } = useRSSEntryThreadSession(entry.id);
  const { panelState, updatePanelState } = useRSSAssistantPanelState();

  const [activeThreadId, setActiveThreadId] = useState(() => threadId ?? uuid());
  const [draft, setDraft] = useState("");
  const [generatedSummary, setGeneratedSummary] = useState("");
  const [generatedTranslation, setGeneratedTranslation] = useState("");
  const [restorableSelectedText, setRestorableSelectedText] = useState<string | null>(
    null,
  );

  const panelRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const handledPrefillRef = useRef<number | null>(null);
  const lastResizeRef = useRef({ width: panelState.width, height: panelState.height });

  const [thread, sendMessage] = useThreadStream({
    threadId: threadId ?? undefined,
    context: settings.context,
    onStart: (createdThreadId) => {
      setThreadId(createdThreadId);
      setActiveThreadId(createdThreadId);
    },
  });

  useEffect(() => {
    setActiveThreadId(threadId ?? uuid());
  }, [entry.id, threadId]);

  useEffect(() => {
    setGeneratedSummary("");
    setGeneratedTranslation("");
    setRestorableSelectedText(null);
  }, [entry.id]);

  useEffect(() => {
    if (!panelState.visible || !panelRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) {
        return;
      }

      const width = clamp(Math.round(box.width), MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
      const height = clamp(Math.round(box.height), MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT);
      const last = lastResizeRef.current;

      if (Math.abs(last.width - width) < 2 && Math.abs(last.height - height) < 2) {
        return;
      }

      lastResizeRef.current = { width, height };
      updatePanelState({ width, height });
    });

    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [panelState.visible, updatePanelState]);

  useEffect(() => {
    if (!prefillRequest) {
      return;
    }
    if (handledPrefillRef.current === prefillRequest.id) {
      return;
    }

    handledPrefillRef.current = prefillRequest.id;
    updatePanelState({ visible: true });

    void sendMessage(activeThreadId, {
      text: prefillRequest.prompt,
      files: [],
    }).catch((error) => {
      toast.error(
        error instanceof Error ? error.message : t.rssReader.entryLoadFailed,
      );
    });
  }, [
    activeThreadId,
    prefillRequest,
    sendMessage,
    t.rssReader.entryLoadFailed,
    updatePanelState,
  ]);

  useEffect(() => {
    const node = messagesRef.current;
    if (!node) {
      return;
    }

    node.scrollTop = node.scrollHeight;
  }, [thread.isLoading, thread.messages.length, generatedSummary, generatedTranslation]);

  const assistantBlocks = useMemo(
    () =>
      blocks.filter(
        (block) =>
          block.type === "mainEntry" ||
          block.type === "mainFeed" ||
          block.type === "selectedText",
      ),
    [blocks],
  );

  const selectedTextBlock = useMemo(
    () => assistantBlocks.find((block) => block.type === "selectedText") ?? null,
    [assistantBlocks],
  );

  const visibleMessages = useMemo(
    () =>
      thread.messages.filter((message) => {
        if (message.type === "human") {
          return hasContent(message);
        }
        if (message.type === "ai") {
          return hasContent(message) || hasReasoning(message);
        }
        return false;
      }),
    [thread.messages],
  );

  const handleSubmit = useCallback(() => {
    const text = draft.trim();
    if (!text) {
      return;
    }

    setDraft("");
    updatePanelState({ visible: true });
    void sendMessage(activeThreadId, { text, files: [] }).catch((error) => {
      toast.error(
        error instanceof Error ? error.message : t.rssReader.entryLoadFailed,
      );
    });
  }, [
    activeThreadId,
    draft,
    sendMessage,
    t.rssReader.entryLoadFailed,
    updatePanelState,
  ]);

  const handleNewChat = useCallback(() => {
    clearThread();
    setActiveThreadId(uuid());
  }, [clearThread]);

  const handleTogglePanel = useCallback(
    (visible: boolean) => {
      updatePanelState({ visible });
    },
    [updatePanelState],
  );

  const handleGenerateSummary = useCallback(async () => {
    try {
      const response = await summarizeEntryMutation.mutateAsync(entry.id);
      setGeneratedSummary(response.summary);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.rssReader.summaryFailed);
    }
  }, [entry.id, summarizeEntryMutation, t.rssReader.summaryFailed]);

  const handleGenerateTranslation = useCallback(async () => {
    try {
      const response = await translateEntryMutation.mutateAsync({
        entryId: entry.id,
        request: {
          target_language: "zh-cn",
        },
      });
      setGeneratedTranslation(response.content);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.rssReader.translationFailed);
    }
  }, [entry.id, t.rssReader.translationFailed, translateEntryMutation]);

  const handleRemoveSelectedText = useCallback(() => {
    if (!selectedTextBlock) {
      return;
    }

    setRestorableSelectedText(selectedTextBlock.value);
    removeBlock(selectedTextBlock.id);
  }, [removeBlock, selectedTextBlock]);

  const handleRestoreSelectedText = useCallback(() => {
    if (!restorableSelectedText) {
      return;
    }
    addBlock(buildSelectedTextBlock(restorableSelectedText, entry));
    setRestorableSelectedText(null);
  }, [addBlock, entry, restorableSelectedText]);

  const handleAskSelection = useCallback(() => {
    if (!selectedTextBlock?.value) {
      return;
    }

    const prompt = formatSelectedTextPrompt(
      selectedTextBlock.value,
      t.rssReader.askAIPrompt,
    );
    void sendMessage(activeThreadId, { text: prompt, files: [] }).catch((error) => {
      toast.error(
        error instanceof Error ? error.message : t.rssReader.entryLoadFailed,
      );
    });
  }, [
    activeThreadId,
    selectedTextBlock?.value,
    sendMessage,
    t.rssReader.askAIPrompt,
    t.rssReader.entryLoadFailed,
  ]);

  if (!panelState.visible) {
    return (
      <>
        <div className="pointer-events-none fixed inset-y-0 right-0 z-40">
          <div className="from-primary/0 via-primary/35 to-primary/0 absolute inset-y-0 right-0 w-[3px] bg-gradient-to-b" />
          <div className="bg-primary/18 absolute right-0 bottom-10 h-40 w-16 rounded-l-full blur-2xl" />
        </div>
        <button
          type="button"
          className="group bg-background/92 fixed right-5 bottom-5 z-50 w-[280px] rounded-2xl border p-4 text-left shadow-xl backdrop-blur"
          onClick={() => handleTogglePanel(true)}
        >
          <div className="mb-2 flex items-center gap-2">
            <RSSAssistantSpline className="size-11 shrink-0" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {t.rssReader.aiPanelTitle}
              </div>
              <div className="text-muted-foreground line-clamp-1 text-xs">
                {entry.title}
              </div>
            </div>
          </div>

          <div className="text-muted-foreground mb-3 text-xs leading-relaxed">
            {t.rssReader.assistantFloatingDescription}
          </div>

          <div className="text-primary inline-flex items-center gap-1 text-sm font-semibold">
            <SparklesIcon className="size-4" />
            {t.rssReader.assistantOpen}
          </div>

          <div className="bg-primary/18 pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      </>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <div
        ref={panelRef}
        className="bg-background/95 pointer-events-auto absolute right-5 bottom-5 flex min-h-[500px] min-w-[380px] max-w-[760px] max-h-[860px] flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur resize"
        style={{
          width: clamp(panelState.width, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH),
          height: clamp(panelState.height, MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT),
        }}
      >
        <header className="from-background via-background/95 to-background/70 relative border-b bg-gradient-to-b px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <RSSAssistantSpline className="size-11 shrink-0" />
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">
                  {t.rssReader.aiPanelTitle}
                </h3>
                <p className="text-muted-foreground truncate text-xs">
                  {entry.title}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={handleNewChat}>
                {t.rssReader.assistantNewChat}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => handleTogglePanel(false)}
                aria-label={t.rssReader.assistantClose}
              >
                <XIcon className="size-4" />
              </Button>
            </div>
          </div>
        </header>

        <AssistantContextBar
          blocks={assistantBlocks}
          onRemoveSelectedText={handleRemoveSelectedText}
          onRestoreSelectedText={handleRestoreSelectedText}
          hasRestorableSelectedText={Boolean(restorableSelectedText)}
        />

        <div ref={messagesRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {visibleMessages.length === 0 ? (
            <section className="space-y-3 pt-3">
              <div className="bg-muted/40 rounded-xl border p-3">
                <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                  <BotIcon className="text-primary size-4" />
                  {t.rssReader.assistantWelcomeTitle}
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {t.rssReader.assistantWelcomeDescription}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleGenerateSummary()}
                  disabled={summarizeEntryMutation.isPending}
                >
                  {summarizeEntryMutation.isPending && (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  )}
                  {t.rssReader.generateSummary}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleGenerateTranslation()}
                  disabled={translateEntryMutation.isPending}
                >
                  {translateEntryMutation.isPending && (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  )}
                  {t.rssReader.generateTranslation}
                </Button>
                {selectedTextBlock && (
                  <Button size="sm" variant="outline" onClick={handleAskSelection}>
                    <MessageCircleIcon className="size-3.5" />
                    {t.rssReader.assistantAskSelection}
                  </Button>
                )}
              </div>
            </section>
          ) : (
            <>
              {visibleMessages.map((message) => {
                const content = extractContentFromMessage(message);
                const reasoning = extractReasoningContentFromMessage(message);
                const isUser = message.type === "human";

                return (
                  <article
                    key={message.id}
                    className={cn("flex", isUser ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-xl border px-3 py-2 text-sm",
                        isUser
                          ? "bg-primary text-primary-foreground border-primary/30"
                          : "bg-card border-border",
                      )}
                    >
                      {reasoning && !content && (
                        <details className="mb-1 text-xs opacity-80" open={thread.isLoading}>
                          <summary>{t.rssReader.assistantThinking}</summary>
                          <p className="mt-1 whitespace-pre-wrap leading-relaxed">{reasoning}</p>
                        </details>
                      )}

                      {content && (
                        <MessageResponse className="text-sm leading-relaxed">
                          {content}
                        </MessageResponse>
                      )}
                    </div>
                  </article>
                );
              })}
            </>
          )}

          {generatedSummary && (
            <section className="bg-card rounded-xl border p-3">
              <h4 className="mb-2 text-sm font-semibold">{t.rssReader.summaryTitle}</h4>
              <p className="text-muted-foreground whitespace-pre-wrap text-sm leading-relaxed">
                {generatedSummary}
              </p>
            </section>
          )}

          {generatedTranslation && (
            <section className="bg-card rounded-xl border p-3">
              <h4 className="mb-2 text-sm font-semibold">{t.rssReader.translationTitle}</h4>
              <p className="text-muted-foreground whitespace-pre-wrap text-sm leading-relaxed">
                {generatedTranslation}
              </p>
            </section>
          )}

          {thread.isLoading && (
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <Loader2Icon className="size-3.5 animate-spin" />
              {t.rssReader.assistantThinking}
            </div>
          )}
        </div>

        <footer className="border-t p-3">
          <div className="mb-2 flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => void handleGenerateSummary()}
              disabled={summarizeEntryMutation.isPending}
            >
              {t.rssReader.generateSummary}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => void handleGenerateTranslation()}
              disabled={translateEntryMutation.isPending}
            >
              {t.rssReader.generateTranslation}
            </Button>
            {thread.isLoading && (
              <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={thread.stop}>
                Stop
              </Button>
            )}
          </div>

          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
              className="bg-muted/30 min-h-[74px] flex-1 resize-none rounded-xl border px-3 py-2 text-sm outline-none focus-visible:ring-2"
              placeholder={t.rssReader.assistantInputPlaceholder}
            />
            <Button
              size="sm"
              className="h-10 px-4"
              onClick={handleSubmit}
              disabled={thread.isLoading || !draft.trim()}
            >
              {t.rssReader.assistantSend}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
