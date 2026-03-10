import type { AIMessage, Message } from "@langchain/langgraph-sdk";

interface ThinkTagParseResult {
  cleanContent: string;
  reasoningContent: string | null;
}

interface GenericMessageGroup<T = string> {
  type: T;
  id: string | undefined;
  messages: Message[];
}

interface HumanMessageGroup extends GenericMessageGroup<"human"> {}

interface AssistantProcessingGroup extends GenericMessageGroup<"assistant:processing"> {}

interface AssistantMessageGroup extends GenericMessageGroup<"assistant"> {}

interface AssistantPresentFilesGroup extends GenericMessageGroup<"assistant:present-files"> {}

interface AssistantClarificationGroup extends GenericMessageGroup<"assistant:clarification"> {}

interface AssistantSubagentGroup extends GenericMessageGroup<"assistant:subagent"> {}

type MessageGroup =
  | HumanMessageGroup
  | AssistantProcessingGroup
  | AssistantMessageGroup
  | AssistantPresentFilesGroup
  | AssistantClarificationGroup
  | AssistantSubagentGroup;

export interface ClarificationPayload {
  status?: "awaiting_user" | "resolved" | string;
  question: string;
  clarification_type?: string;
  context?: string | null;
  options?: string[];
  requires_choice?: boolean;
  tool_call_id?: string | null;
  asked_at?: string | null;
  resolved_at?: string | null;
  resolved_by_message_id?: string | null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeTextBlockValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function wrapAsThinkTag(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  return `<think>${normalized}</think>`;
}

function extractThinkingBlock(content: Record<string, unknown>): string {
  const candidates: unknown[] = [
    content.thinking,
    content.reasoning,
    content.text,
    content.content,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeTextBlockValue(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function parseThinkTags(content: string): ThinkTagParseResult {
  if (!content) {
    return {
      cleanContent: "",
      reasoningContent: null,
    };
  }

  const reasoningParts: string[] = [];
  let cleanContent = content.replace(
    /<think\b[^>]*>([\s\S]*?)<\/think>/gi,
    (_, reasoning: string) => {
      const normalizedReasoning = reasoning.trim();
      if (normalizedReasoning) {
        reasoningParts.push(normalizedReasoning);
      }
      return "";
    },
  );

  // Handle streamed responses that end with an unmatched opening <think>.
  const danglingOpenTag = /<think\b[^>]*>/i.exec(cleanContent);
  if (danglingOpenTag?.index !== undefined) {
    const openTagStart = danglingOpenTag.index;
    const openTagEnd = openTagStart + danglingOpenTag[0].length;
    const danglingReasoning = cleanContent.slice(openTagEnd).trim();
    if (danglingReasoning) {
      reasoningParts.push(danglingReasoning);
    }
    cleanContent = cleanContent.slice(0, openTagStart);
  }

  cleanContent = cleanContent.replace(/<\/think>/gi, "").trim();

  return {
    cleanContent,
    reasoningContent:
      reasoningParts.length > 0 ? reasoningParts.join("\n\n") : null,
  };
}

function extractRawContentFromMessage(message: Message) {
  if (typeof message.content === "string") {
    return message.content.trim();
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((content) => {
        if (!content || typeof content !== "object" || !("type" in content)) {
          return "";
        }
        const block = content as Record<string, unknown> & { type: string };
        switch (block.type) {
          case "text":
          case "input_text":
            return normalizeTextBlockValue(block.text);
          case "image_url":
            if (
              !block.image_url ||
              (typeof block.image_url !== "string" &&
                (typeof block.image_url !== "object" ||
                  !("url" in block.image_url)))
            ) {
              return "";
            }
            return `![image](${extractURLFromImageURLContent(
              block.image_url as string | { url: string },
            )})`;
          case "thinking":
          case "reasoning":
            return wrapAsThinkTag(extractThinkingBlock(block));
          default:
            return "";
        }
      })
      .join("\n")
      .trim();
  }

  return "";
}

export function groupMessages<T>(
  messages: Message[],
  mapper: (group: MessageGroup) => T,
): T[] {
  if (messages.length === 0) {
    return [];
  }

  const groups: MessageGroup[] = [];

  function lastOpenGroup() {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.type !== "human" &&
      last.type !== "assistant" &&
      last.type !== "assistant:clarification"
    ) {
      return last;
    }
    return null;
  }

  for (const message of messages) {
    // Filter out todo_reminder to avoid showing internal system reminders.
    if (message.name === "todo_reminder") {
      continue;
    }

    if (message.type === "human") {
      groups.push({ id: message.id, type: "human", messages: [message] });
      continue;
    }

    if (message.type === "tool") {
      if (isClarificationToolMessage(message)) {
        lastOpenGroup()?.messages.push(message);
        groups.push({
          id: message.id,
          type: "assistant:clarification",
          messages: [message],
        });
      } else {
        const open = lastOpenGroup();
        if (open) {
          open.messages.push(message);
        } else {
          console.error("Unexpected tool message outside a processing group", message);
        }
      }
      continue;
    }

    if (message.type === "ai") {
      if (hasPresentFiles(message)) {
        groups.push({
          id: message.id,
          type: "assistant:present-files",
          messages: [message],
        });
      } else if (hasSubagent(message)) {
        groups.push({
          id: message.id,
          type: "assistant:subagent",
          messages: [message],
        });
      } else if (hasReasoning(message) || hasToolCalls(message)) {
        const lastGroup = groups[groups.length - 1];
        if (lastGroup?.type !== "assistant:processing") {
          groups.push({
            id: message.id,
            type: "assistant:processing",
            messages: [message],
          });
        } else {
          lastGroup.messages.push(message);
        }
      }

      if (hasContent(message) && !hasToolCalls(message)) {
        groups.push({ id: message.id, type: "assistant", messages: [message] });
      }
    }
  }

  return groups
    .map(mapper)
    .filter((result) => result !== undefined && result !== null) as T[];
}

export function extractTextFromMessage(message: Message) {
  if (typeof message.content === "string") {
    return message.content.trim();
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((content) => (content.type === "text" ? content.text : ""))
      .join("\n")
      .trim();
  }
  return "";
}

export function extractContentFromMessage(message: Message) {
  const rawContent = extractRawContentFromMessage(message);
  if (message.type !== "ai") {
    return rawContent;
  }
  return parseThinkTags(rawContent).cleanContent;
}

export function extractReasoningContentFromMessage(message: Message) {
  if (message.type !== "ai") {
    return null;
  }

  const metadataReasoning = normalizeOptionalText(
    message.additional_kwargs?.reasoning_content,
  );
  const thinkTagReasoning = parseThinkTags(
    extractRawContentFromMessage(message),
  ).reasoningContent;

  if (metadataReasoning && thinkTagReasoning) {
    return metadataReasoning === thinkTagReasoning
      ? metadataReasoning
      : `${metadataReasoning}\n\n${thinkTagReasoning}`;
  }

  return metadataReasoning ?? thinkTagReasoning;
}

export function removeReasoningContentFromMessage(message: Message) {
  if (message.type !== "ai" || !message.additional_kwargs) {
    return;
  }
  delete message.additional_kwargs.reasoning_content;
}

export function extractURLFromImageURLContent(
  content:
    | string
    | {
        url: string;
      },
) {
  if (typeof content === "string") {
    return content;
  }
  return content.url;
}

export function hasContent(message: Message) {
  if (message.type === "ai") {
    return extractContentFromMessage(message).length > 0;
  }
  if (typeof message.content === "string") {
    return message.content.trim().length > 0;
  }
  if (Array.isArray(message.content)) {
    return message.content.length > 0;
  }
  return false;
}

export function hasReasoning(message: Message) {
  return message.type === "ai" && !!extractReasoningContentFromMessage(message);
}

export function hasToolCalls(message: Message) {
  return (
    message.type === "ai" && message.tool_calls && message.tool_calls.length > 0
  );
}

export function hasPresentFiles(message: Message) {
  return (
    message.type === "ai" &&
    message.tool_calls?.some((toolCall) => toolCall.name === "present_files")
  );
}

export function isClarificationToolMessage(message: Message) {
  return message.type === "tool" && message.name === "ask_clarification";
}

function normalizeClarificationOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLegacyClarification(content: string): ClarificationPayload | null {
  const text = content.trim();
  if (!text) {
    return null;
  }

  const lines = text.split("\n");
  const optionRegex = /^\s*\d+[.)]\s+(.+)$/;
  const options: string[] = [];
  const questionLines: string[] = [];
  for (const line of lines) {
    const optionMatch = optionRegex.exec(line);
    if (optionMatch) {
      const option = optionMatch[1]?.trim();
      if (option) {
        options.push(option);
      }
      continue;
    }
    questionLines.push(line);
  }

  const question = questionLines.join("\n").trim();
  if (!question) {
    return null;
  }
  return {
    status: "awaiting_user",
    question,
    options,
    requires_choice: options.length > 0,
  };
}

export function extractClarificationPayload(message: Message): ClarificationPayload | null {
  if (!isClarificationToolMessage(message)) {
    return null;
  }

  const rawClarification = message.additional_kwargs?.clarification;
  if (rawClarification && typeof rawClarification === "object") {
    const payload = rawClarification as Record<string, unknown>;
    const question = typeof payload.question === "string" ? payload.question.trim() : "";
    if (question) {
      return {
        status: typeof payload.status === "string" ? payload.status : "awaiting_user",
        question,
        clarification_type:
          typeof payload.clarification_type === "string"
            ? payload.clarification_type
            : undefined,
        context:
          typeof payload.context === "string"
            ? payload.context
            : payload.context === null
              ? null
              : undefined,
        options: normalizeClarificationOptions(payload.options),
        requires_choice:
          typeof payload.requires_choice === "boolean"
            ? payload.requires_choice
            : undefined,
        tool_call_id:
          typeof payload.tool_call_id === "string"
            ? payload.tool_call_id
            : payload.tool_call_id === null
              ? null
              : undefined,
        asked_at:
          typeof payload.asked_at === "string"
            ? payload.asked_at
            : payload.asked_at === null
              ? null
              : undefined,
        resolved_at:
          typeof payload.resolved_at === "string"
            ? payload.resolved_at
            : payload.resolved_at === null
              ? null
              : undefined,
        resolved_by_message_id:
          typeof payload.resolved_by_message_id === "string"
            ? payload.resolved_by_message_id
            : payload.resolved_by_message_id === null
              ? null
              : undefined,
      };
    }
  }

  return parseLegacyClarification(extractTextFromMessage(message));
}

export function extractPresentFilesFromMessage(message: Message) {
  if (message.type !== "ai" || !hasPresentFiles(message)) {
    return [];
  }
  const files: string[] = [];
  for (const toolCall of message.tool_calls ?? []) {
    if (
      toolCall.name === "present_files" &&
      Array.isArray(toolCall.args.filepaths)
    ) {
      files.push(...(toolCall.args.filepaths as string[]));
    }
  }
  return files;
}

export function hasSubagent(message: AIMessage) {
  for (const toolCall of message.tool_calls ?? []) {
    if (toolCall.name === "task") {
      return true;
    }
  }
  return false;
}

export function findToolCallResult(toolCallId: string, messages: Message[]) {
  for (const message of messages) {
    if (message.type === "tool" && message.tool_call_id === toolCallId) {
      const content = extractTextFromMessage(message);
      if (content) {
        return content;
      }
    }
  }
  return undefined;
}

/**
 * Represents a file stored in message additional_kwargs.files.
 * Used for optimistic UI (uploading state) and structured file metadata.
 */
export interface FileInMessage {
  filename: string;
  size: number; // bytes
  path?: string; // virtual path, may not be set during upload
  virtual_path?: string;
  markdown_file?: string;
  markdown_path?: string;
  markdown_virtual_path?: string;
  markdown_artifact_url?: string;
  status?: "uploading" | "uploaded";
}

/**
 * Strip <uploaded_files> tag from message content.
 * Returns the content with the tag removed.
 */
export function stripUploadedFilesTag(content: string): string {
  return content
    .replace(/<uploaded_files>[\s\S]*?<\/uploaded_files>/g, "")
    .trim();
}

export function parseUploadedFiles(content: string): FileInMessage[] {
  // Match <uploaded_files>...</uploaded_files> tag
  const uploadedFilesRegex = /<uploaded_files>([\s\S]*?)<\/uploaded_files>/;
  // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec
  const match = content.match(uploadedFilesRegex);

  if (!match) {
    return [];
  }

  const uploadedFilesContent = match[1];

  // Check if it's "No files have been uploaded yet."
  if (uploadedFilesContent?.includes("No files have been uploaded yet.")) {
    return [];
  }

  // Check if the backend reported no new files were uploaded in this message
  if (uploadedFilesContent?.includes("(empty)")) {
    return [];
  }

  // Parse file list
  // Format: - filename (size)\n  Path: /path/to/file
  const fileRegex = /- ([^\n(]+)\s*\(([^)]+)\)\s*\n\s*Path:\s*([^\n]+)/g;
  const files: FileInMessage[] = [];
  let fileMatch;

  while ((fileMatch = fileRegex.exec(uploadedFilesContent ?? "")) !== null) {
    files.push({
      filename: fileMatch[1].trim(),
      size: parseInt(fileMatch[2].trim(), 10) ?? 0,
      path: fileMatch[3].trim(),
    });
  }

  return files;
}
