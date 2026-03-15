import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadStreamModeModule() {
  vi.resetModules();
  return import("@/core/api/stream-mode");
}

describe("FE-CHAT-002 流式模式兼容层", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("FE-CHAT-002-保留受支持 streamMode", async () => {
    const { sanitizeRunStreamOptions } = await loadStreamModeModule();

    const payload = sanitizeRunStreamOptions({
      streamMode: ["messages", "values", "custom"],
      limit: 5,
    });

    expect(payload).toEqual({
      streamMode: ["messages", "values", "custom"],
      limit: 5,
    });
  });

  it("FE-CHAT-002-丢弃不支持 streamMode 且相同模式仅告警一次", async () => {
    const { sanitizeRunStreamOptions } = await loadStreamModeModule();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((message) => message);

    const first = sanitizeRunStreamOptions({
      streamMode: ["messages-tuple", "unknown-mode"],
    });
    const second = sanitizeRunStreamOptions({
      streamMode: ["values", "unknown-mode"],
    });

    expect(first).toEqual({
      streamMode: ["messages-tuple"],
    });
    expect(second).toEqual({
      streamMode: ["values"],
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const firstWarnMessage = warnSpy.mock.calls[0]?.[0];
    expect(String(firstWarnMessage)).toContain("unknown-mode");
  });
});
