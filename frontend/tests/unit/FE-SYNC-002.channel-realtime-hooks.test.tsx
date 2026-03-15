import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChannelThreadRealtime } from "@/core/channels/channel-realtime-hooks";
import * as realtimeProvider from "@/core/channels/channel-realtime-provider";
import type { ChannelThreadRealtimeState } from "@/core/channels/channel-realtime-types";

vi.mock("@/core/channels/channel-realtime-provider", async () => {
  const actual = await vi.importActual<typeof import("@/core/channels/channel-realtime-provider")>(
    "@/core/channels/channel-realtime-provider",
  );
  return {
    ...actual,
    useChannelRealtimeContext: vi.fn(),
  };
});

const useChannelRealtimeContextMock = vi.mocked(realtimeProvider.useChannelRealtimeContext);

describe("FE-SYNC-002 Channel 实时状态归一化", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("FE-SYNC-002-无连字符 UUID 也能命中线程状态", () => {
    const normalizedThreadId = "123e4567-e89b-12d3-a456-426614174000";
    const state = {
      threadId: normalizedThreadId,
      platform: "dingtalk",
      running: true,
      pendingUserText: null,
      partialText: "",
      finalReplyText: null,
      stateValues: null,
      seq: 9,
      lastEventAt: "2026-03-11T12:00:00Z",
      terminalEvent: null,
      terminalAt: null,
    } satisfies ChannelThreadRealtimeState;

    useChannelRealtimeContextMock.mockReturnValue({
      connected: true,
      error: null,
      threadStates: {
        [normalizedThreadId]: state,
      },
    });

    const { result } = renderHook(() =>
      useChannelThreadRealtime("123E4567E89B12D3A456426614174000"),
    );

    expect(result.current).toEqual(state);
  });

  it("FE-SYNC-002-空 threadId 返回 null", () => {
    useChannelRealtimeContextMock.mockReturnValue({
      connected: true,
      error: null,
      threadStates: {},
    });

    const { result } = renderHook(() => useChannelThreadRealtime("   "));
    expect(result.current).toBeNull();
  });
});
