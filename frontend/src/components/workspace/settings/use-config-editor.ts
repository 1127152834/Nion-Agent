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
import type { ConfigValidateErrorItem } from "@/core/config-center";

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
      const message = typeof source.message === "string" ? source.message : "Validation error";
      const type = typeof source.type === "string" ? source.type : "validation_error";
      return {
        path: Array.isArray(source.path) ? source.path.map((v) => String(v)) : [],
        message,
        type,
      } satisfies ConfigValidateErrorItem;
    })
    .filter((item): item is ConfigValidateErrorItem => item !== null);
}

type UseConfigEditorOptions = {
  prepareConfig?: (config: ConfigDraft) => ConfigDraft;
};

export function useConfigEditor(options: UseConfigEditorOptions = {}) {
  const { prepareConfig } = options;
  const { configData, isLoading, error, refetchConfig } = useConfigCenter();
  const validateMutation = useValidateConfig();
  const updateMutation = useUpdateConfig();

  const [version, setVersion] = useState<string>("");
  const [initialConfig, setInitialConfig] = useState<ConfigDraft>({});
  const [draftConfig, setDraftConfig] = useState<ConfigDraft>({});
  const [validationErrors, setValidationErrors] = useState<ConfigValidateErrorItem[]>([]);

  useEffect(() => {
    if (!configData) {
      return;
    }
    setVersion(configData.version);
    setInitialConfig(cloneConfig(configData.config));
    setDraftConfig(cloneConfig(configData.config));
    setValidationErrors([]);
  }, [configData]);

  const dirty = useMemo(
    () => jsonStable(draftConfig) !== jsonStable(initialConfig),
    [draftConfig, initialConfig],
  );

  const onConfigChange = useCallback((next: ConfigDraft) => {
    setDraftConfig(next);
    setValidationErrors([]);
  }, []);

  const onDiscard = useCallback(() => {
    setDraftConfig(cloneConfig(initialConfig));
    setValidationErrors([]);
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
        return false;
      }
      setValidationErrors([]);
      if (result.config) {
        setDraftConfig(cloneConfig(result.config));
      }
      return true;
    } catch (err) {
      if (err instanceof ConfigCenterApiError && err.status === 422) {
        const parsedErrors = extractValidationErrors(err.detail);
        if (parsedErrors) {
          setValidationErrors(parsedErrors);
        }
      }
      return false;
    }
  }, [draftConfig, prepareDraftConfig, validateMutation]);

  const onSave = useCallback(async () => {
    const preparedDraft = prepareDraftConfig();
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
      return true;
    } catch (err) {
      if (err instanceof ConfigCenterApiError) {
        if (err.status === 422) {
          const parsedErrors = extractValidationErrors(err.detail);
          if (parsedErrors) {
            setValidationErrors(parsedErrors);
          }
        }
        if (err.status === 409) {
          void refetchConfig();
        }
      }
      return false;
    }
  }, [draftConfig, prepareDraftConfig, refetchConfig, updateMutation, version]);

  return {
    configData,
    draftConfig,
    validationErrors,
    isLoading,
    error,
    dirty,
    validating: validateMutation.isPending,
    saving: updateMutation.isPending,
    onConfigChange,
    onDiscard,
    onValidate,
    onSave,
    refetchConfig,
  };
}
