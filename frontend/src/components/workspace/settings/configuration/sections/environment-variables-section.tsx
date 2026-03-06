"use client";

import { EyeIcon, EyeOffIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/core/i18n/hooks";

import { asObject, cloneConfig, type ConfigDraft } from "../shared";

const RESERVED_PREFIXES = ["NEXT_PUBLIC_", "BETTER_AUTH_"];

function isValidEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

function hasReservedPrefix(key: string): boolean {
  const upper = key.trim().toUpperCase();
  return RESERVED_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

function toEnvValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

export function EnvironmentVariablesSection({
  config,
  onChange,
  disabled,
}: {
  config: ConfigDraft;
  onChange: (next: ConfigDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const copy = t.settings.configSections.environmentVariables;
  const [showValues, setShowValues] = useState(false);

  const runtimeEnv = asObject(config.runtime_env);
  const entries: Array<[string, string]> = Object.entries(runtimeEnv).map(
    ([key, value]) => [key, toEnvValue(value)],
  );

  const updateEntries = (nextEntries: Array<[string, string]>) => {
    const normalized: Record<string, string> = {};
    for (const [rawKey, rawValue] of nextEntries) {
      const key = rawKey.trim();
      if (!key) {
        continue;
      }
      normalized[key] = rawValue;
    }

    const next = cloneConfig(config);
    if (Object.keys(normalized).length === 0) {
      delete next.runtime_env;
    } else {
      next.runtime_env = normalized;
    }
    onChange(next);
  };

  const updateKey = (index: number, nextKey: string) => {
    const nextEntries = [...entries];
    const currentValue = nextEntries[index]?.[1] ?? "";
    nextEntries[index] = [nextKey, currentValue];
    updateEntries(nextEntries);
  };

  const updateValue = (index: number, nextValue: string) => {
    const nextEntries = [...entries];
    const currentKey = nextEntries[index]?.[0] ?? "";
    nextEntries[index] = [currentKey, nextValue];
    updateEntries(nextEntries);
  };

  const removeEntry = (index: number) => {
    const nextEntries = entries.filter((_, idx) => idx !== index);
    updateEntries(nextEntries);
  };

  const addEntry = (presetKey?: string) => {
    const usedKeys = new Set(entries.map(([key]) => key));
    let key = presetKey ?? "NEW_ENV_KEY";
    if (!presetKey) {
      let suffix = 1;
      while (usedKeys.has(key)) {
        key = `NEW_ENV_KEY_${suffix}`;
        suffix += 1;
      }
    } else if (usedKeys.has(key)) {
      return;
    }
    updateEntries([...entries, [key, ""]]);
  };

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden rounded-lg border p-4">
      <div className="space-y-1">
        <div className="text-sm font-medium">{copy.title}</div>
        <div className="text-muted-foreground text-xs">{copy.subtitle}</div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => addEntry()}
          disabled={disabled}
        >
          <PlusIcon className="mr-1 size-3.5" />
          {copy.add}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setShowValues((prev) => !prev)}
          disabled={disabled}
        >
          {showValues ? (
            <EyeOffIcon className="mr-1 size-3.5" />
          ) : (
            <EyeIcon className="mr-1 size-3.5" />
          )}
          {showValues ? copy.hide : copy.show}
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="text-muted-foreground rounded-md border border-dashed px-3 py-5 text-center text-sm">
          {copy.empty}
        </div>
      ) : (
        <div className="min-w-0 space-y-3">
          {entries.map(([key, value], index) => {
            const trimmedKey = key.trim();
            const invalidFormat = trimmedKey.length > 0 && !isValidEnvKey(trimmedKey);
            const invalidReserved = trimmedKey.length > 0 && hasReservedPrefix(trimmedKey);
            const invalidConfigStorage =
              trimmedKey.toUpperCase() === "NION_CONFIG_STORAGE" &&
              value.trim().length > 0 &&
              !["auto", "sqlite"].includes(value.trim().toLowerCase());
            return (
              <div key={`${key}-${index}`} className="space-y-2 rounded-md border p-3">
                <div className="grid gap-2 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                  <div className="space-y-1">
                    <div className="text-muted-foreground text-[11px]">{copy.key}</div>
                    <Input
                      value={key}
                      placeholder="TAVILY_API_KEY"
                      onChange={(e) => updateKey(index, e.target.value)}
                      disabled={disabled}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-muted-foreground text-[11px]">{copy.value}</div>
                    <Input
                      type={showValues ? "text" : "password"}
                      value={value}
                      placeholder={copy.value}
                      onChange={(e) => updateValue(index, e.target.value)}
                      disabled={disabled}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeEntry(index)}
                    disabled={disabled}
                    aria-label={copy.remove}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
                {invalidFormat && (
                  <div className="text-destructive text-xs">{copy.invalidKey}</div>
                )}
                {invalidReserved && (
                  <div className="text-destructive text-xs">{copy.reservedKey}</div>
                )}
                {invalidConfigStorage && (
                  <div className="text-destructive text-xs">{copy.invalidConfigStorage}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
