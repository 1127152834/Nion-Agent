import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { AgentAvatarEditor } from "@/components/workspace/agents/agent-avatar-editor";
import { I18nProvider } from "@/core/i18n/context";

vi.mock("@radix-ui/react-avatar", () => {
  return {
    Root: ({ children, ...props }: React.ComponentProps<"span">) => (
      <span {...props}>{children}</span>
    ),
    Image: (props: React.ComponentProps<"img">) => <img {...props} alt={props.alt ?? ""} />,
    Fallback: ({ children, ...props }: React.ComponentProps<"span">) => (
      <span {...props}>{children}</span>
    ),
  };
});

describe("FE-AGENT-001 AgentAvatarEditor 头像 URL 解析（/api -> gateway base URL）", () => {
  it("FE-AGENT-001-resolve-relative-avatar-url 相对路径应解析到 http://localhost:8001（jsdom 默认 fallback）", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider initialLocale="zh-CN">
          <AgentAvatarEditor
            agentName="foo"
            avatarUrl="/api/agents/foo/avatar"
            fallbackLabel="Foo"
          />
        </I18nProvider>
      </QueryClientProvider>,
    );

    const img = screen.getByAltText("Foo");
    expect(img.getAttribute("src")).toMatch(
      /^http:\/\/localhost:8001\/api\/agents\/foo\/avatar/,
    );
  });

  it("FE-AGENT-001-keep-absolute-avatar-url 已是绝对 URL 时不应被二次拼接", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider initialLocale="zh-CN">
          <AgentAvatarEditor
            agentName="foo"
            avatarUrl="https://example.com/api/agents/foo/avatar"
            fallbackLabel="Foo"
          />
        </I18nProvider>
      </QueryClientProvider>,
    );

    const img = screen.getByAltText("Foo");
    expect(img.getAttribute("src")).toMatch(
      /^https:\/\/example\.com\/api\/agents\/foo\/avatar/,
    );
  });
});
