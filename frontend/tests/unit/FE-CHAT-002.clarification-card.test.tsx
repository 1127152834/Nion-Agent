import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClarificationCard } from "@/components/workspace/messages/clarification-card";
import { I18nProvider } from "@/core/i18n/context";
import type { AgentThread } from "@/core/threads/types";

describe("FE-CHAT-002 ClarificationCard 选项选择", () => {
  it("FE-CHAT-002-click 选项后应清除 threads 缓存的 awaiting 状态", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const threadId = "thread-clarification-1";
    const params = {
      limit: 50,
      sortBy: "updated_at",
      sortOrder: "desc",
      select: ["thread_id", "created_at", "updated_at", "status", "values"],
    };

    const thread = {
      thread_id: threadId,
      values: {
        title: "测试线程",
        messages: [],
        clarification: {
          status: "awaiting_user",
          question: "请选择选项",
          options: ["A", "B"],
          requires_choice: true,
          resolved_at: null,
          resolved_by_message_id: null,
        },
      },
    } as unknown as AgentThread;

    queryClient.setQueryData(["threads", "search", params], [thread]);

    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider initialLocale="zh-CN">
          <ClarificationCard
            clarification={thread.values.clarification!}
            threadId={threadId}
            isLoading={false}
          />
        </I18nProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "A" }));

    const updated = queryClient.getQueryData<AgentThread[]>([
      "threads",
      "search",
      params,
    ]);
    expect(updated?.[0]?.values?.clarification?.status).toBe("resolved");
  });
});
