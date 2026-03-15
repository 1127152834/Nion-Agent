import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_LOCAL_SETTINGS,
  getLocalSettings,
  saveLocalSettings,
} from "@/core/settings/local";

const LOCAL_SETTINGS_KEY = "nion.local-settings";

describe("FE-SET-001 本地设置持久化", () => {
  let localData: Record<string, string>;

  beforeEach(() => {
    localData = {};
    const mockLocalStorage = {
      getItem: (key: string) => localData[key] ?? null,
      setItem: (key: string, value: string) => {
        localData[key] = value;
      },
      removeItem: (key: string) => {
        delete localData[key];
      },
      clear: () => {
        localData = {};
      },
      key: (_index: number) => null,
      get length() {
        return Object.keys(localData).length;
      },
    } satisfies Storage;
    vi.stubGlobal("localStorage", mockLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("FE-SET-001-读取默认值", () => {
    expect(getLocalSettings()).toEqual(DEFAULT_LOCAL_SETTINGS);
  });

  it("FE-SET-001-保存并读取合并结果", () => {
    saveLocalSettings({
      ...DEFAULT_LOCAL_SETTINGS,
      context: {
        ...DEFAULT_LOCAL_SETTINGS.context,
        model_name: "model-a",
        mode: "thinking",
        reasoning_effort: "medium",
      },
      layout: {
        sidebar_collapsed: true,
      },
      notification: {
        enabled: false,
      },
    });

    const loaded = getLocalSettings();
    expect(loaded.context.model_name).toBe("model-a");
    expect(loaded.context.mode).toBe("thinking");
    expect(loaded.layout.sidebar_collapsed).toBe(true);
    expect(loaded.notification.enabled).toBe(false);
  });

  it("FE-SET-001-损坏 JSON 回退默认值", () => {
    localStorage.setItem(LOCAL_SETTINGS_KEY, "{invalid-json");
    expect(getLocalSettings()).toEqual(DEFAULT_LOCAL_SETTINGS);
  });
});
