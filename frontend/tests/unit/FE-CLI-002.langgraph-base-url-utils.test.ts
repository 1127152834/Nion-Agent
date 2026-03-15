import { afterEach, describe, expect, it, vi } from "vitest";

function setLangGraphBaseURL(value: string | undefined) {
  if (typeof value === "string") {
    process.env.NEXT_PUBLIC_LANGGRAPH_BASE_URL = value;
  } else {
    delete process.env.NEXT_PUBLIC_LANGGRAPH_BASE_URL;
  }
}

describe("FE-CLI-002 LangGraph BaseURL 纠错（/api -> /api/langgraph）", () => {
  const previous = process.env.NEXT_PUBLIC_LANGGRAPH_BASE_URL;

  afterEach(() => {
    vi.resetModules();
    setLangGraphBaseURL(previous);
  });

  it("FE-CLI-002-auto-correct /api suffix", async () => {
    vi.resetModules();
    setLangGraphBaseURL("http://localhost:8001/api");

    const { getLangGraphBaseURL } = await import("@/core/config");
    expect(getLangGraphBaseURL()).toBe("http://localhost:8001/api/langgraph");
  });

  it("FE-CLI-002-keep /api/langgraph", async () => {
    vi.resetModules();
    setLangGraphBaseURL("http://localhost:8001/api/langgraph");

    const { getLangGraphBaseURL } = await import("@/core/config");
    expect(getLangGraphBaseURL()).toBe("http://localhost:8001/api/langgraph");
  });

  it("FE-CLI-002-normalize trailing slash without rewriting", async () => {
    vi.resetModules();
    setLangGraphBaseURL("http://localhost:2024/");

    const { getLangGraphBaseURL } = await import("@/core/config");
    expect(getLangGraphBaseURL()).toBe("http://localhost:2024");
  });
});

