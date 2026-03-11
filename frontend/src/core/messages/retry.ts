import type { Message } from "@langchain/langgraph-sdk";

import { textOfMessage } from "@/core/threads/utils";

export function findLastRetryableUserMessage(messages: Message[]): string {
  // Keep legacy behavior: retry replays the latest human text message only.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "human") {
      continue;
    }
    return (textOfMessage(message) ?? "").trim();
  }
  return "";
}
