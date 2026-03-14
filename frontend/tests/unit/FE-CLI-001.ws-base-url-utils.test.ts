import { describe, expect, it } from "vitest";

import { toWebSocketBaseURL } from "@/core/config/ws";

describe("FE-CLI-001 WebSocket base URL 推导（HTTP -> WS）", () => {
  it("FE-CLI-001-http -> ws", () => {
    expect(toWebSocketBaseURL("http://localhost:8001")).toBe(
      "ws://localhost:8001",
    );
  });

  it("FE-CLI-001-https -> wss", () => {
    expect(toWebSocketBaseURL("https://example.com")).toBe("wss://example.com");
  });

  it("FE-CLI-001-keep ws/wss", () => {
    expect(toWebSocketBaseURL("ws://x")).toBe("ws://x");
    expect(toWebSocketBaseURL("wss://x")).toBe("wss://x");
  });
});

