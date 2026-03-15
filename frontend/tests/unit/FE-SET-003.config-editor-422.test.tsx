import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfigEditor } from "@/components/workspace/settings/use-config-editor";
import * as configCenterHooks from "@/core/config-center";
import { ConfigCenterApiError } from "@/core/config-center/types";

vi.mock("@/core/config-center", async () => {
  const actual = await vi.importActual<typeof import("@/core/config-center")>("@/core/config-center");
  return {
    ...actual,
    useConfigCenter: vi.fn(),
    useValidateConfig: vi.fn(),
    useUpdateConfig: vi.fn(),
  };
});

const useConfigCenterMock = vi.mocked(configCenterHooks.useConfigCenter);
const useValidateConfigMock = vi.mocked(configCenterHooks.useValidateConfig);
const useUpdateConfigMock = vi.mocked(configCenterHooks.useUpdateConfig);
type ConfigCenterValue = ReturnType<typeof configCenterHooks.useConfigCenter>;
type ValidateMutationValue = ReturnType<typeof configCenterHooks.useValidateConfig>;
type UpdateMutationValue = ReturnType<typeof configCenterHooks.useUpdateConfig>;

describe("FE-SET-003 useConfigEditor 422 错误解析", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("FE-SET-003-save 422 时提取字段级错误与警告", async () => {
    useConfigCenterMock.mockReturnValue({
      configData: { version: "v3", config: { tools: ["bash"] } } as unknown as ConfigCenterValue["configData"],
      schemaData: null,
      runtimeStatus: null,
      isLoading: false,
      error: null,
      refetchConfig: vi.fn(),
    } as unknown as ConfigCenterValue);
    useValidateConfigMock.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ValidateMutationValue);
    useUpdateConfigMock.mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(
        new ConfigCenterApiError(422, "validation failed", {
          errors: [
            {
              path: ["models", "0", "name"],
              message: "required",
              type: "validation_error",
            },
          ],
          warnings: [
            {
              path: ["tools", "1"],
              message: "deprecated",
              type: "validation_warning",
            },
          ],
        }),
      ),
      isPending: false,
    } as unknown as UpdateMutationValue);

    const { result } = renderHook(() => useConfigEditor());
    await waitFor(() => {
      expect(result.current.draftConfig).toEqual({ tools: ["bash"] });
    });

    let saved = true;
    await act(async () => {
      saved = await result.current.onSaveConfig({ tools: ["bash", "python"] });
    });

    expect(saved).toBe(false);
    expect(result.current.validationErrors).toEqual([
      {
        path: ["models", "0", "name"],
        message: "required",
        type: "validation_error",
      },
    ]);
    expect(result.current.validationWarnings).toEqual([
      {
        path: ["tools", "1"],
        message: "deprecated",
        type: "validation_warning",
      },
    ]);
  });
});

describe("FE-SET-003 Select 弹层层级", () => {
  it("FE-SET-003-portal-zindex SelectContent 应高于设置弹窗层级", () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });

    render(
      <Select open value="fast" onValueChange={vi.fn()}>
        <SelectTrigger aria-label="mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent data-testid="settings-select-content">
          <SelectItem value="fast">Fast</SelectItem>
          <SelectItem value="llm">LLM</SelectItem>
        </SelectContent>
      </Select>,
    );

    const content = screen.getByTestId("settings-select-content");
    expect(content.className).toContain("z-[200]");
  });
});
