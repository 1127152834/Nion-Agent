import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("FE-SET-002 useConfigEditor 行为", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("FE-SET-002-validate 失败时保留错误并返回 false", async () => {
    const refetchConfig = vi.fn();
    const validateMutateAsync = vi.fn().mockResolvedValue({
      valid: false,
      errors: [{ path: ["models", "0"], message: "invalid model", type: "validation_error" }],
      warnings: [{ path: ["tools"], message: "deprecated", type: "validation_warning" }],
      config: null,
    });
    const updateMutateAsync = vi.fn();

    useConfigCenterMock.mockReturnValue({
      configData: { version: "v1", config: { tools: [] } } as unknown as ConfigCenterValue["configData"],
      schemaData: null,
      runtimeStatus: null,
      isLoading: false,
      error: null,
      refetchConfig,
    } as unknown as ConfigCenterValue);
    useValidateConfigMock.mockReturnValue({
      mutateAsync: validateMutateAsync,
      isPending: false,
    } as unknown as ValidateMutationValue);
    useUpdateConfigMock.mockReturnValue({
      mutateAsync: updateMutateAsync,
      isPending: false,
    } as unknown as UpdateMutationValue);

    const { result } = renderHook(() => useConfigEditor());

    await waitFor(() => {
      expect(result.current.draftConfig).toEqual({ tools: [] });
    });

    act(() => {
      result.current.onConfigChange({ tools: ["bash"] });
    });
    expect(result.current.dirty).toBe(true);

    let ok = true;
    await act(async () => {
      ok = await result.current.onValidate();
    });

    expect(ok).toBe(false);
    expect(result.current.validationErrors).toHaveLength(1);
    expect(result.current.validationWarnings).toHaveLength(1);
    expect(validateMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("FE-SET-002-save 遇到 409 会触发 refetch", async () => {
    const refetchConfig = vi.fn();
    const validateMutateAsync = vi.fn();
    const updateMutateAsync = vi
      .fn()
      .mockRejectedValue(new ConfigCenterApiError(409, "version conflict", { current_version: "v2" }));

    useConfigCenterMock.mockReturnValue({
      configData: { version: "v1", config: { memory: { enabled: true } } } as unknown as ConfigCenterValue["configData"],
      schemaData: null,
      runtimeStatus: null,
      isLoading: false,
      error: null,
      refetchConfig,
    } as unknown as ConfigCenterValue);
    useValidateConfigMock.mockReturnValue({
      mutateAsync: validateMutateAsync,
      isPending: false,
    } as unknown as ValidateMutationValue);
    useUpdateConfigMock.mockReturnValue({
      mutateAsync: updateMutateAsync,
      isPending: false,
    } as unknown as UpdateMutationValue);

    const { result } = renderHook(() => useConfigEditor());
    await waitFor(() => {
      expect(result.current.draftConfig).toEqual({ memory: { enabled: true } });
    });

    let ok = true;
    await act(async () => {
      ok = await result.current.onSaveConfig({ memory: { enabled: false } });
    });

    expect(ok).toBe(false);
    expect(updateMutateAsync).toHaveBeenCalledTimes(1);
    expect(refetchConfig).toHaveBeenCalledTimes(1);
  });
});
