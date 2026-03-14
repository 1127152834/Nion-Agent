import type { Message } from "@langchain/langgraph-sdk";
import type { BaseStream } from "@langchain/langgraph-sdk/react";
import { useMemo } from "react";

import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import {
  extractContentFromMessage,
  extractClarificationPayload,
  extractPresentFilesFromMessage,
  extractTextFromMessage,
  groupMessages,
  hasContent,
  hasPresentFiles,
  hasReasoning,
  hasSubagent,
  isA2UIToolMessage,
  isClarificationToolMessage,
  type CLIInteractivePayload,
} from "@/core/messages/utils";
import { useRehypeSplitWordsIntoSpans } from "@/core/rehype";
import type { Subtask } from "@/core/tasks";
import { useUpdateSubtask } from "@/core/tasks/context";
import type { AgentThreadState } from "@/core/threads";
import { cn } from "@/lib/utils";

import { ArtifactFileList } from "../artifacts/artifact-file-list";
import { StreamingIndicator } from "../streaming-indicator";

import type { A2UIUserAction } from "@/core/a2ui/types";
import { A2UICard } from "./a2ui-card";
import { ClarificationCard } from "./clarification-card";
import { CLIInteractiveCard } from "./cli-interactive-card";
import { CLITerminal } from "./cli-terminal";
import { MarkdownContent } from "./markdown-content";
import { MessageGroup } from "./message-group";
import { MessageListItem } from "./message-list-item";
import { MessageListSkeleton } from "./skeleton";
import { SubtaskCard } from "./subtask-card";

function formatStreamError(error: unknown): string {
  if (!error) {
    return "";
  }
  if (typeof error === "string") {
    return error.trim();
  }
  if (error instanceof Error) {
    return error.message.trim();
  }
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
    const nestedError = (error as { error?: unknown }).error;
    if (typeof nestedError === "string" && nestedError.trim()) {
      return nestedError.trim();
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown stream error";
    }
  }
  return "Unknown stream error";
}

function isTransientStreamError(message: string): boolean {
  const normalized = message.toLowerCase();
  // Align with legacy behavior: treat SSE/network jitter as retryable.
  return (
    normalized.includes("incomplete chunked read")
    || normalized.includes("remoteprotocolerror")
    || normalized.includes("peer closed connection")
    || normalized.includes("stream")
    || normalized.includes("connection")
  );
}

export function MessageList({
  className,
  threadId,
  thread,
  paddingBottom = 160,
  onClarificationSelect,
  onRetryLastMessage,
  onSubmitMessage,
  onA2UIAction,
}: {
  className?: string;
  threadId: string;
  thread: BaseStream<AgentThreadState>;
  paddingBottom?: number;
  onClarificationSelect?: (option: string) => void;
  onRetryLastMessage?: () => void;
  onSubmitMessage?: (text: string) => void;
  onA2UIAction?: (action: A2UIUserAction) => void;
}) {
  const { t } = useI18n();
  const copy = t.workspace.messageList;
  const rehypePlugins = useRehypeSplitWordsIntoSpans(thread.isLoading);
  const updateSubtask = useUpdateSubtask();
  const messages = thread.messages;
  const streamErrorMessage = formatStreamError((thread as { error?: unknown }).error);
  const showStreamErrorNotice = !thread.isLoading && streamErrorMessage.length > 0;
  const streamErrorHint = isTransientStreamError(streamErrorMessage)
    ? copy.streamInterruptedHint
    : copy.streamEndedUnexpectedlyHint;

  const showIncompleteTurnNotice = useMemo(() => {
    if (thread.isLoading || showStreamErrorNotice) {
      return false;
    }

    let lastHumanMessageIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.type === "human") {
        lastHumanMessageIndex = index;
        break;
      }
    }
    if (lastHumanMessageIndex < 0) {
      return false;
    }

    const tailMessages = messages.slice(lastHumanMessageIndex + 1);
    if (tailMessages.length === 0) {
      return false;
    }

    const hasRenderableAssistantOutcome = tailMessages.some((message) => {
      if (message.type !== "ai") {
        if (isClarificationToolMessage(message)) {
          const clarification = extractClarificationPayload(message);
          if (clarification?.question?.trim()) {
            return true;
          }
          return extractTextFromMessage(message).trim().length > 0;
        }
        if (isA2UIToolMessage(message)) {
          return true;
        }
        return false;
      }
      if (hasContent(message) || hasPresentFiles(message)) {
        return true;
      }
      return hasSubagent(message);
    });

    if (hasRenderableAssistantOutcome) {
      return false;
    }

    // Show incomplete-turn notice only when reasoning/tool calls exist but no final visible output.
    return tailMessages.some(
      (message) =>
        message.type === "ai"
        && (hasReasoning(message) || (message.tool_calls?.length ?? 0) > 0),
    );
  }, [messages, showStreamErrorNotice, thread.isLoading]);

  if (thread.isThreadLoading && messages.length === 0) {
    return <MessageListSkeleton />;
  }
  return (
    <Conversation
      className={cn("flex size-full flex-col", className)}
    >
      <ConversationContent className="mx-auto w-full max-w-(--container-width-md) gap-8 pt-12">
        {groupMessages(messages, (group) => {
          if (group.type === "human" || group.type === "assistant") {
            return (
              <MessageListItem
                key={group.id}
                message={group.messages[0]!}
                isLoading={thread.isLoading}
              />
            );
          } else if (group.type === "assistant:clarification") {
            const message = group.messages[0];
            if (message && hasContent(message)) {
              const clarification = extractClarificationPayload(message);
              if (clarification?.question) {
                const hasChoice =
                  clarification.requires_choice ??
                  ((clarification.options?.length ?? 0) > 0);

                if (hasChoice) {
                  return (
                    <ClarificationCard
                      key={group.id}
                      clarification={clarification}
                      threadId={threadId}
                      isLoading={thread.isLoading}
                      onSelectOption={onClarificationSelect}
                    />
                  );
                }

                const clarificationText = [
                  clarification.context?.trim() ?? "",
                  clarification.question,
                ]
                  .filter(Boolean)
                  .join("\n\n");
                const assistantLikeMessage: Message = {
                  type: "ai",
                  id: message.id ?? `${group.id}-clarification`,
                  content: clarificationText,
                };
                return (
                  <MessageListItem
                    key={group.id}
                    message={assistantLikeMessage}
                    isLoading={thread.isLoading}
                  />
                );
              }
              return (
                <MarkdownContent
                  key={group.id}
                  content={extractContentFromMessage(message)}
                  isLoading={thread.isLoading}
                  rehypePlugins={rehypePlugins}
                />
              );
            }
            return null;
          } else if (group.type === "assistant:cli-interactive") {
            const message = group.messages[0];
            if (!message) return null;

            const payload = message.additional_kwargs?.cli_interactive as CLIInteractivePayload | undefined;
            if (
              payload?.status === "awaiting_terminal"
              && typeof payload.session_id === "string"
              && typeof payload.tool_id === "string"
            ) {
              const argv =
                payload.argv ??
                payload.command ??
                [];
              return (
                <CLITerminal
                  key={group.id}
                  sessionId={payload.session_id}
                  toolId={payload.tool_id}
                  command={argv}
                />
              );
            }

            return (
              <CLIInteractiveCard
                key={group.id}
                message={message}
                onSubmitInput={(input) => {
                  onSubmitMessage?.(input);
                }}
              />
            );
          } else if (group.type === "assistant:a2ui") {
            const message = group.messages[0];
            if (!message) return null;
            return (
              <A2UICard
                key={group.id}
                message={message}
                isLoading={thread.isLoading}
                onAction={onA2UIAction}
              />
            );
          } else if (group.type === "assistant:present-files") {
            const files: string[] = [];
            for (const message of group.messages) {
              if (hasPresentFiles(message)) {
                const presentFiles = extractPresentFilesFromMessage(message);
                files.push(...presentFiles);
              }
            }
            return (
              <div className="w-full" key={group.id}>
                {group.messages[0] && hasContent(group.messages[0]) && (
                  <MarkdownContent
                    content={extractContentFromMessage(group.messages[0])}
                    isLoading={thread.isLoading}
                    rehypePlugins={rehypePlugins}
                    className="mb-4"
                  />
                )}
                <ArtifactFileList files={files} threadId={threadId} />
              </div>
            );
          } else if (group.type === "assistant:subagent") {
            const tasks = new Set<Subtask>();
            for (const message of group.messages) {
              if (message.type === "ai") {
                for (const toolCall of message.tool_calls ?? []) {
                  if (toolCall.name === "task") {
                    const task: Subtask = {
                      id: toolCall.id!,
                      subagent_type: toolCall.args.subagent_type,
                      description: toolCall.args.description,
                      prompt: toolCall.args.prompt,
                      status: "in_progress",
                    };
                    updateSubtask(task);
                    tasks.add(task);
                  }
                }
              } else if (message.type === "tool") {
                const taskId = message.tool_call_id;
                if (taskId) {
                  const result = extractTextFromMessage(message);
                  if (result.startsWith("Task Succeeded. Result:")) {
                    updateSubtask({
                      id: taskId,
                      status: "completed",
                      result: result
                        .split("Task Succeeded. Result:")[1]
                        ?.trim(),
                    });
                  } else if (result.startsWith("Task failed.")) {
                    updateSubtask({
                      id: taskId,
                      status: "failed",
                      error: result.split("Task failed.")[1]?.trim(),
                    });
                  } else if (result.startsWith("Task timed out")) {
                    updateSubtask({
                      id: taskId,
                      status: "failed",
                      error: result,
                    });
                  } else {
                    updateSubtask({
                      id: taskId,
                      status: "in_progress",
                    });
                  }
                }
              }
            }
            const results: React.ReactNode[] = [];
            for (const message of group.messages.filter(
              (message) => message.type === "ai",
            )) {
              if (hasReasoning(message)) {
                results.push(
                  <MessageGroup
                    key={"thinking-group-" + message.id}
                    messages={[message]}
                    isLoading={thread.isLoading}
                  />,
                );
              }
              results.push(
                <div
                  key="subtask-count"
                  className="text-muted-foreground font-norma pt-2 text-sm"
                >
                  {t.subtasks.executing(tasks.size)}
                </div>,
              );
              const taskIds = message.tool_calls?.map(
                (toolCall) => toolCall.id,
              );
              for (const taskId of taskIds ?? []) {
                results.push(
                  <SubtaskCard
                    key={"task-group-" + taskId}
                    taskId={taskId!}
                    isLoading={thread.isLoading}
                  />,
                );
              }
            }
            return (
              <div
                key={"subtask-group-" + group.id}
                className="relative z-1 flex flex-col gap-2"
              >
                {results}
              </div>
            );
          }
          return (
            <MessageGroup
              key={"group-" + group.id}
              messages={group.messages}
              isLoading={thread.isLoading}
            />
          );
        })}
        {showStreamErrorNotice && (
          <div className="mt-1 w-full rounded-lg border border-amber-300/50 bg-amber-50/70 p-3">
            <div className="text-sm font-medium text-amber-900">
              {copy.streamInterruptedTitle}
            </div>
            <div className="text-muted-foreground mt-1 text-xs leading-5">
              {streamErrorHint}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {onRetryLastMessage ? (
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={onRetryLastMessage}
                >
                  {copy.retryLastMessage}
                </Button>
              ) : null}
              <details className="text-muted-foreground text-xs">
                <summary className="cursor-pointer select-none">
                  {copy.errorDetails}
                </summary>
                <pre className="bg-background mt-1 max-h-24 overflow-auto rounded border p-2 whitespace-pre-wrap">
                  {streamErrorMessage}
                </pre>
              </details>
            </div>
          </div>
        )}
        {showIncompleteTurnNotice && (
          <div className="mt-1 w-full rounded-lg border border-amber-300/50 bg-amber-50/70 p-3">
            <div className="text-sm font-medium text-amber-900">
              {copy.incompleteResponseTitle}
            </div>
            <div className="text-muted-foreground mt-1 text-xs leading-5">
              {copy.incompleteResponseHint}
            </div>
            {onRetryLastMessage ? (
              <div className="mt-2">
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={onRetryLastMessage}
                >
                  {copy.retryLastMessage}
                </Button>
              </div>
            ) : null}
          </div>
        )}
        {thread.isLoading && <StreamingIndicator className="my-4" />}
        <div style={{ height: `${paddingBottom}px` }} />
      </ConversationContent>
    </Conversation>
  );
}
