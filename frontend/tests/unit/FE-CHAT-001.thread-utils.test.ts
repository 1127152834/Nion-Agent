import type { Message } from "@langchain/langgraph-sdk";
import { describe, expect, it } from "vitest";

import type { AgentThread } from "@/core/threads/types";
import {
  isGhostThread,
  isThreadAwaitingResponse,
  pathOfNewThread,
  pathOfThread,
  textOfMessage,
} from "@/core/threads/utils";

describe("FE-CHAT-001 线程与消息工具", () => {
  it("FE-CHAT-001-path helpers 返回稳定路由", () => {
    expect(pathOfNewThread()).toBe("/workspace/chats/new");
    expect(pathOfThread("thread-123")).toBe("/workspace/chats/thread-123");
  });

  it("FE-CHAT-001-textOfMessage 兼容字符串与分块消息", () => {
    expect(
      textOfMessage({
        type: "ai",
        content: "hello",
      } as unknown as Message),
    ).toBe("hello");

    expect(
      textOfMessage({
        type: "ai",
        content: [
          { type: "image_url", image_url: { url: "https://example.com" } },
          { type: "text", text: "from blocks" },
        ],
      } as unknown as Message),
    ).toBe("from blocks");
  });

  it("FE-CHAT-001-isGhostThread 与 awaiting 规则正确", () => {
    const emptyThread = {
      thread_id: "t-empty",
      values: { title: "Untitled", messages: [] },
    } as unknown as AgentThread;
    expect(isGhostThread(emptyThread)).toBe(true);

    const realThread = {
      thread_id: "t-real",
      values: {
        title: "真实线程",
        messages: [{ type: "human", content: "hi" }],
        clarification: {
          status: "awaiting_user",
          options: ["A", "B"],
          resolved_at: null,
          resolved_by_message_id: null,
        },
      },
    } as unknown as AgentThread;
    expect(isGhostThread(realThread)).toBe(false);
    expect(isThreadAwaitingResponse(realThread)).toBe(true);
  });
});
