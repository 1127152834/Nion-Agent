"use client";

import {
  ChevronDownIcon,
  Loader2Icon,
  PencilIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/core/i18n/hooks";
import {
  extractContentFromMessage,
  hasContent,
  parseUploadedFiles,
  stripUploadedFilesTag,
  type FileInMessage,
} from "@/core/messages/utils";
import { useLocalSettings } from "@/core/settings/hooks";
import { useThreadStream } from "@/core/threads/hooks";
import { cn } from "@/lib/utils";

// Import new assistant components
import { AICharacter3D } from "./ai-character-3d";
import { AssistantInput } from "./assistant-input";
import { AssistantMessage } from "./assistant-message";

export interface AssistantPendingPrompt {
  id: string;
  text: string;
}

interface RenderMessage {
  id: string;
  role: "human" | "assistant";
  text: string;
  implicitMentions: Array<{
    kind: "context" | "skill" | "mcp";
    value: string;
    mention: string;
  }>;
  files: FileInMessage[];
  isTaskMessage: boolean;
}

function MessageBubble({ message }: { message: RenderMessage }) {
  return (
    <AssistantMessage
      message={{
        id: message.id,
        role: message.role === "human" ? "user" : "assistant",
        content: message.text,
      }}
      implicitMentions={message.implicitMentions}
      files={message.files}
      isTaskMessage={message.isTaskMessage}
    />
  );
}

function isImplicitMention(
  value: unknown,
): value is { kind: "context" | "skill" | "mcp"; value: string; mention: string } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as {
    kind?: unknown;
    value?: unknown;
    mention?: unknown;
  };
  return (
    (candidate.kind === "context" ||
      candidate.kind === "skill" ||
      candidate.kind === "mcp") &&
    typeof candidate.value === "string" &&
    typeof candidate.mention === "string"
  );
}

function stripImplicitMentionSuffix(
  content: string,
  implicitMentions: Array<{ mention: string }>,
): string {
  if (!content || implicitMentions.length === 0) {
    return content;
  }
  const mentionLine = implicitMentions.map((item) => item.mention).join(" ");
  if (!mentionLine) {
    return content;
  }
  const normalized = content.trimEnd();
  const suffix = `\n\n${mentionLine}`;
  if (normalized.endsWith(suffix)) {
    return normalized.slice(0, -suffix.length).trimEnd();
  }
  return content;
}

function normalizeFiles(value: unknown): FileInMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const file = item as Partial<FileInMessage>;
      if (typeof file.filename !== "string" || !file.filename.trim()) {
        return null;
      }
      return {
        filename: file.filename,
        size: typeof file.size === "number" ? file.size : 0,
        path: typeof file.path === "string" ? file.path : undefined,
        status: file.status === "uploading" ? "uploading" : "uploaded",
      } as FileInMessage;
    })
    .filter((file): file is FileInMessage => Boolean(file));
}

export function FloatingEntryAssistant({
  open,
  threadId,
  isNewThread,
  entryTitle,
  pendingPrompt,
  onOpenChange,
  onNewThread,
  onThreadStarted,
  onPendingPromptConsumed,
  className,
}: {
  open: boolean;
  threadId: string;
  isNewThread?: boolean;
  entryTitle: string;
  pendingPrompt: AssistantPendingPrompt | null;
  onOpenChange: (open: boolean) => void;
  onNewThread: () => void;
  onThreadStarted: (threadId: string) => void;
  onPendingPromptConsumed: (id: string) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const [settings] = useLocalSettings();

  // For new threads, don't pass threadId to avoid 404 errors on mount
  const [thread, sendMessage] = useThreadStream({
    threadId: isNewThread ? null : threadId,
    context: settings.context,
    isNewThread,
    onStart: onThreadStarted,
  });

  const renderMessages = useMemo<RenderMessage[]>(() => {
    return thread.messages
      .map((message, index) => {
        if ((message.type !== "human" && message.type !== "ai") || !hasContent(message)) {
          return null;
        }

        const text = extractContentFromMessage(message).trim();
        const implicitMentions = Array.isArray(
          message.additional_kwargs?.implicit_mentions,
        )
          ? message.additional_kwargs.implicit_mentions.filter(isImplicitMention)
          : [];
        const additionalKwargsFiles = normalizeFiles(message.additional_kwargs?.files);
        const files =
          additionalKwargsFiles.length > 0
            ? additionalKwargsFiles
            : text.includes("<uploaded_files>")
              ? parseUploadedFiles(text)
              : [];
        const normalizedText =
          message.type === "human"
            ? stripImplicitMentionSuffix(
                stripUploadedFilesTag(text),
                implicitMentions,
              )
            : text;

        if (!normalizedText && files.length === 0) {
          return null;
        }

        return {
          id: message.id ?? `msg-${index}`,
          role: message.type === "human" ? "human" : "assistant",
          text: normalizedText,
          implicitMentions: message.type === "human" ? implicitMentions : [],
          files,
          isTaskMessage: message.additional_kwargs?.element === "task",
        };
      })
      .filter((message): message is RenderMessage => message !== null);
  }, [thread.messages]);

  const hasMessages = renderMessages.length > 0;

  const panelTitle =
    typeof thread.values.title === "string" && thread.values.title.trim().length > 0
      ? thread.values.title
      : t.rssReader.aiPanelHeaderNewChat;

  const sendPrompt = useCallback(
    async (payload: PromptInputMessage) => {
      const normalizedText = payload.text.trim();
      const files = payload.files ?? [];
      if (!normalizedText && files.length === 0) {
        return;
      }
      await sendMessage(threadId, {
        ...payload,
        text: normalizedText,
        files,
      });
    },
    [sendMessage, threadId],
  );

  const sendPromptWithToast = useCallback(
    async (payload: PromptInputMessage) => {
      try {
        await sendPrompt(payload);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t.rssReader.aiSendFailed);
      }
    },
    [sendPrompt, t.rssReader.aiSendFailed],
  );

  const pendingPromptRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingPrompt) {
      return;
    }
    if (pendingPromptRef.current === pendingPrompt.id) {
      return;
    }

    pendingPromptRef.current = pendingPrompt.id;
    void sendPrompt({
      text: pendingPrompt.text,
      files: [],
    })
      .then(() => {
        onPendingPromptConsumed(pendingPrompt.id);
      })
      .catch((error) => {
        pendingPromptRef.current = null;
        toast.error(error instanceof Error ? error.message : t.rssReader.aiSendFailed);
      });
  }, [
    onPendingPromptConsumed,
    pendingPrompt,
    sendPrompt,
    t.rssReader.aiSendFailed,
  ]);

  const quickPrompts = useMemo(
    () => [
      {
        label: t.rssReader.quickPromptSummaryLabel,
        prompt: t.rssReader.quickPromptSummaryPrompt.replace("{title}", entryTitle || ""),
      },
      {
        label: t.rssReader.quickPromptTakeawayLabel,
        prompt: t.rssReader.quickPromptTakeawayPrompt.replace("{title}", entryTitle || ""),
      },
      {
        label: t.rssReader.quickPromptTranslateLabel,
        prompt: t.rssReader.quickPromptTranslatePrompt.replace("{title}", entryTitle || ""),
      },
    ],
    [
      entryTitle,
      t.rssReader.quickPromptSummaryLabel,
      t.rssReader.quickPromptSummaryPrompt,
      t.rssReader.quickPromptTakeawayLabel,
      t.rssReader.quickPromptTakeawayPrompt,
      t.rssReader.quickPromptTranslateLabel,
      t.rssReader.quickPromptTranslatePrompt,
    ],
  );

  if (!open) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed top-[92px] right-4 bottom-4 z-50 flex w-[380px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-lg md:right-6",
        className,
      )}
      role="dialog"
      aria-label={t.rssReader.aiPanelTitle}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="truncate text-lg font-semibold text-foreground">
            {panelTitle}
          </h2>
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onNewThread}
            title={t.rssReader.shortcutNewAssistantChat}
            className="text-muted-foreground"
          >
            <PencilIcon className="size-4" />
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
            title={t.rssReader.shortcutCloseAssistant}
            className="text-muted-foreground"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 bg-muted/30">
        <ScrollArea className="size-full">
          <div className="space-y-4 px-4 pt-4 pb-[180px]">
            {!hasMessages && (
              <section className="space-y-5 py-6 text-center">
                {/* 3D Character */}
                <div className="ai-character-container mx-auto rounded-2xl overflow-hidden">
                  <AICharacter3D className="h-32" />
                </div>

                <div>
                  <h3 className="text-3xl font-semibold text-foreground">阅读助手</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t.rssReader.aiPanelSubtitle}
                  </p>
                </div>

                <div className="rounded-2xl border border-border bg-card p-4 text-left">
                  <div className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                    <SparklesIcon className="size-4" />
                    {t.rssReader.summaryTitle}
                  </div>
                  <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">
                    {entryTitle}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2">
                  {quickPrompts.map((item) => (
                    <Button
                      key={item.label}
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => {
                        void sendPromptWithToast({
                          text: item.prompt,
                          files: [],
                        });
                      }}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
              </section>
            )}

            {hasMessages &&
              renderMessages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}

            {(thread.isLoading || thread.isThreadLoading) && (
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Loader2Icon className="size-4 animate-spin" />
                {t.rssReader.loadingEntry}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="absolute right-0 bottom-0 left-0 border-t border-border bg-background/95 px-4 pt-3 pb-4 backdrop-blur">
        <AssistantInput
          onSend={sendPromptWithToast}
          isLoading={thread.isLoading}
          placeholder={t.rssReader.aiComposerPlaceholder || "问我任何关于这篇文章的问题..."}
        />
      </div>
    </div>
  );
}
