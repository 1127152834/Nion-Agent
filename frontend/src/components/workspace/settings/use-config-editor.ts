/**
 * Configuration Editor Hook
 *
 * Manages configuration editing state with validation and save functionality.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ConfigCenterApiError,
  useConfigCenter,
  useUpdateConfig,
  useValidateConfig,
} from "@/core/config-center";
import type { ConfigValidateErrorItem, ConfigValidateWarningItem } from "@/core/config-center";

type ConfigDraft = Record<string, unknown>;

function jsonStable(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function cloneConfig(config: unknown): ConfigDraft {
  return JSON.parse(JSON.stringify(config ?? {})) as ConfigDraft;
}

function extractValidationErrors(detail: unknown): ConfigValidateErrorItem[] | null {
  if (!detail || typeof detail !== "object") {
    return null;
  }
  const errors = (detail as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return null;
  }
  return errors
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const source = item as {
        path?: unknown;
        message?: unknown;
        type?: unknown;
      };
      const message = typeof source.message === "string" ? source.message : "";
      const type = typeof source.type === "string" ? source.type : "validation_error";
      return {
        path: Array.isArray(source.path) ? source.path.map((v) => String(v)) : [],
        message,
        type,
      } satisfies ConfigValidateErrorItem;
    })
    .filter((item): item is ConfigValidateErrorItem => item !== null);
}

function extractValidationWarnings(detail: unknown): ConfigValidateWarningItem[] | null {
  if (!detail || typeof detail !== "object") {
    return null;
  }
  const warnings = (detail as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) {
    return null;
  }
  return warnings
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const source = item as {
        path?: unknown;
        message?: unknown;
        type?: unknown;
      };
      const message = typeof source.message === "string" ? source.message : "";
      const type = typeof source.type === "string" ? source.type : "validation_warning";
      return {
        path: Array.isArray(source.path) ? source.path.map((v) => String(v)) : [],
        message,
        type,
      } satisfies ConfigValidateWarningItem;
    })
    .filter((item): item is ConfigValidateWarningItem => item !== null);
}

type UseConfigEditorOptions = {
  prepareConfig?: (config: ConfigDraft) => ConfigDraft;
};

export function useConfigEditor(options: UseConfigEditorOptions = {}) {
  const { prepareConfig } = options;
  const { configData, runtimeStatus, isLoading, error, refetchConfig } = useConfigCenter();
  const validateMutation = useValidateConfig();
  const updateMutation = useUpdateConfig();

  const [version, setVersion] = useState<string>("");
  const [initialConfig, setInitialConfig] = useState<ConfigDraft>({});
  const [draftConfig, setDraftConfig] = useState<ConfigDraft>({});
  const [validationErrors, setValidationErrors] = useState<ConfigValidateErrorItem[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<ConfigValidateWarningItem[]>([]);

  useEffect(() => {
    if (!configData) {
      return;
    }
    setVersion(configData.version);
    setInitialConfig(cloneConfig(configData.config));
    setDraftConfig(cloneConfig(configData.config));
    setValidationErrors([]);
    setValidationWarnings([]);
  }, [configData]);

  const dirty = useMemo(
    () => jsonStable(draftConfig) !== jsonStable(initialConfig),
    [draftConfig, initialConfig],
  );

  const onConfigChange = useCallback((next: ConfigDraft) => {
    setDraftConfig(next);
    setValidationErrors([]);
    setValidationWarnings([]);
  }, []);

  const onDiscard = useCallback(() => {
    setDraftConfig(cloneConfig(initialConfig));
    setValidationErrors([]);
    setValidationWarnings([]);
  }, [initialConfig]);

  const prepareDraftConfig = useCallback(() => {
    const baseDraft = cloneConfig(draftConfig);
    if (!prepareConfig) {
      return baseDraft;
    }
    return prepareConfig(baseDraft);
  }, [draftConfig, prepareConfig]);

  const onValidate = useCallback(async () => {
    const preparedDraft = prepareDraftConfig();
    if (jsonStable(preparedDraft) !== jsonStable(draftConfig)) {
      setDraftConfig(cloneConfig(preparedDraft));
    }
    try {
      const result = await validateMutation.mutateAsync({ config: preparedDraft });
      if (!result.valid) {
        setValidationErrors(result.errors ?? []);
        setValidationWarnings(result.warnings ?? []);
        return false;
      }
      setValidationErrors([]);
      setValidationWarnings(result.warnings ?? []);
      if (result.config) {
        setDraftConfig(cloneConfig(result.config));
      }
      return true;
    } catch (err) {
      if (err instanceof ConfigCenterApiError && err.status === 422) {
        const parsedErrors = extractValidationErrors(err.detail);
        const parsedWarnings = extractValidationWarnings(err.detail);
        if (parsedErrors) {
          setValidationErrors(parsedErrors);
        }
        if (parsedWarnings) {
          setValidationWarnings(parsedWarnings);
        }
      }
      return false;
    }
  }, [draftConfig, prepareDraftConfig, validateMutation]);

  const onSaveConfig = useCallback(async (nextConfig: ConfigDraft) => {
    const baseConfig = cloneConfig(nextConfig);
    const preparedDraft = prepareConfig ? prepareConfig(baseConfig) : baseConfig;
    if (jsonStable(preparedDraft) !== jsonStable(draftConfig)) {
      setDraftConfig(cloneConfig(preparedDraft));
    }
    try {
      const result = await updateMutation.mutateAsync({
        version,
        config: preparedDraft,
      });
      setVersion(result.version);
      setInitialConfig(cloneConfig(result.config));
      setDraftConfig(cloneConfig(result.config));
      setValidationErrors([]);
      setValidationWarnings(result.warnings ?? []);
      return true;
    } catch (err) {
      if (err instanceof ConfigCenterApiError) {
        if (err.status === 422) {
          const parsedErrors = extractValidationErrors(err.detail);
          const parsedWarnings = extractValidationWarnings(err.detail);
          if (parsedErrors) {
            setValidationErrors(parsedErrors);
          }
          if (parsedWarnings) {
            setValidationWarnings(parsedWarnings);
          }
        }
        if (err.status === 409) {
          void refetchConfig();
        }
      }
      return false;
    }
  }, [draftConfig, prepareConfig, refetchConfig, updateMutation, version]);

  const onSave = useCallback(async () => {
    const preparedDraft = prepareDraftConfig();
    return onSaveConfig(preparedDraft);
  }, [onSaveConfig, prepareDraftConfig]);

  return {
    configData,
    runtimeStatus,
    draftConfig,
    validationErrors,
    validationWarnings,
    isLoading,
    error,
    dirty,
    disabled: isLoading || updateMutation.isPending,
    validating: validateMutation.isPending,
    saving: updateMutation.isPending,
    onConfigChange,
    onDiscard,
    onValidate,
    onSave,
    onSaveConfig,
    refetchConfig,
  };
}
