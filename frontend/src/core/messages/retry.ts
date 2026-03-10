import type { Message } from "@langchain/langgraph-sdk";

import { textOfMessage } from "@/core/threads/utils";

export function findLastRetryableUserMessage(messages: Message[]): string {
  // 复用旧项目“重试上一条”语义：仅回放最近一条 human 文本消息。
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "human") {
      continue;
    }
    return (textOfMessage(message) ?? "").trim();
  }
  return "";
}
