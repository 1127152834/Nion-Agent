import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchSettingsPage } from "@/components/workspace/settings/search-settings-page";
import { I18nProvider } from "@/core/i18n/context";

const onConfigChange = vi.fn();

type SearchSettingsConfigSnapshot = {
  search_settings?: {
    web_search?: {
      providers?: string[];
    };
    web_fetch?: {
      providers?: string[];
    };
  };
};

vi.mock("@/components/workspace/settings/use-config-editor", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useConfigEditor: () => {
      const [draftConfig, setDraftConfig] = React.useState<Record<string, unknown>>({});
      const [dirty, setDirty] = React.useState(false);
      return {
        draftConfig,
        validationErrors: [],
        validationWarnings: [],
        runtimeStatus: null,
        isLoading: false,
        error: null,
        dirty,
        disabled: false,
        saving: false,
        onConfigChange: (next: Record<string, unknown>) => {
          setDraftConfig(next);
          setDirty(true);
          onConfigChange(next);
        },
        onDiscard: vi.fn(),
        onSave: vi.fn(),
      };
    },
  };
});

describe("FE-SET-004 SearchSettingsPage", () => {
  beforeEach(() => {
    onConfigChange.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({ status: "ok", result: { message: "OK" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("FE-SET-004-enable-web-search-provider 需要先测试连接通过才能启用，并从可用列表移动到已启用列表", async () => {
    render(
      <I18nProvider initialLocale="en-US">
        <SearchSettingsPage />
      </I18nProvider>,
    );

    const braveSwitch = screen.getByRole("switch", { name: "Brave Search" });
    fireEvent.click(braveSwitch);

    // 进入启用流程：先配置并测试连接
    const enableButton = screen.getByRole("button", { name: "Enable" });
    expect(enableButton).toBeDisabled();

    const apiKeyInput = screen.getByPlaceholderText("$BRAVE_API_KEY");
    fireEvent.change(apiKeyInput, { target: { value: "brave-key" } });

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Enable" })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      // 启用后从可用列表消失（没有 switch），并出现在已启用列表
      expect(screen.queryByRole("switch", { name: "Brave Search" })).toBeNull();
      expect(screen.getByText("Brave Search")).toBeInTheDocument();
    });

    const calls = onConfigChange.mock.calls;
    const nextConfig = calls[calls.length - 1]?.[0] as SearchSettingsConfigSnapshot | undefined;
    expect(nextConfig?.search_settings?.web_search?.providers).toEqual(["brave", "searxng_public"]);
    expect(nextConfig?.search_settings?.web_fetch?.providers).toEqual(["jina", "direct"]);
  });
});
