import type { Message } from "@langchain/langgraph-sdk";

import type { AgentThread } from "./types";

export function pathOfChatsIndex() {
  return "/workspace/chats";
}

export function pathOfNewThread() {
  return "/workspace/chats/new";
}

export function pathOfThread(threadId: string) {
  return `/workspace/chats/${threadId}`;
}

export function pathOfPluginAssistant() {
  return "/workspace/plugins/assistant";
}

export function textOfMessage(message: Message) {
  if (typeof message.content === "string") {
    return message.content;
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "text") {
        return part.text;
      }
    }
  }
  return null;
}

export function titleOfThread(thread: AgentThread) {
  return thread.values?.title ?? "Untitled";
}

export function isThreadAwaitingResponse(thread: AgentThread) {
  const clarification = thread.values?.clarification;
  if (clarification?.status !== "awaiting_user") {
    return false;
  }

  if (clarification.resolved_at || clarification.resolved_by_message_id) {
    return false;
  }

  const hasChoice =
    clarification.requires_choice ??
    ((clarification.options?.length ?? 0) > 0);

  return hasChoice;
}

export function isHiddenWorkspaceThread(thread: AgentThread) {
  const visibility = thread.values?.thread_visibility;
  if (visibility === "hidden") {
    return true;
  }
  return thread.values?.workspace_mode === "plugin_assistant";
}
