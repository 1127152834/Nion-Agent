"use client";

import { useEffect } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/core/i18n/hooks";

import { FieldTip } from "../field-tip";
import { asObject, asString, cloneConfig, type ConfigDraft } from "../shared";

type CheckpointerType = "memory" | "sqlite";

const DEFAULT_SQLITE_CONNECTION_STRING = "checkpoints.db";

function normalizeType(value: unknown): CheckpointerType {
  if (typeof value !== "string") {
    return "sqlite";
  }
  const raw = value.trim().toLowerCase();
  if (raw === "memory") {
    return raw;
  }
  return "sqlite";
}

export function CheckpointerSection({
  config,
  onChange,
  disabled,
}: {
  config: ConfigDraft;
  onChange: (next: ConfigDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const settingsLike = t.settings as {
    configSections?: {
      checkpointer?: Record<string, string>;
    };
  };
  const copy = settingsLike.configSections?.checkpointer ?? {};
  const checkpointer = asObject(config.checkpointer);
  const rawType = asString(checkpointer.type).trim().toLowerCase();
  const type = normalizeType(rawType);
  const hasUnsupportedType = Boolean(rawType) && rawType !== "memory" && rawType !== "sqlite";
  const rawConnectionString = asString(checkpointer.connection_string);
  const connectionString = type === "sqlite" && !hasUnsupportedType ? rawConnectionString : "";

  const updateCheckpointer = (updates: Partial<Record<"type" | "connection_string", unknown>>) => {
    const next = cloneConfig(config);
    const target = asObject(next.checkpointer);

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === null || value === "") {
        delete target[key];
      } else {
        target[key] = value;
      }
    }

    target.type ??= "sqlite";

    next.checkpointer = target;
    onChange(next);
  };

  useEffect(() => {
    if (!hasUnsupportedType) return;
    updateCheckpointer({ type: "sqlite", connection_string: DEFAULT_SQLITE_CONNECTION_STRING });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsupportedType]);

  useEffect(() => {
    // Product decision: do not expose the checkpointer storage path in the UI.
    // Always normalize SQLite to a stable default so users don't end up with
    // surprising thread-state persistence behavior.
    if (hasUnsupportedType) return;
    if (type !== "sqlite") return;
    if (connectionString !== DEFAULT_SQLITE_CONNECTION_STRING) {
      updateCheckpointer({ connection_string: DEFAULT_SQLITE_CONNECTION_STRING });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionString, hasUnsupportedType, type]);

  const handleTypeChange = (nextType: string) => {
    const normalized = normalizeType(nextType);
    if (normalized === "memory") {
      updateCheckpointer({ type: normalized, connection_string: undefined });
      return;
    }
    updateCheckpointer({
      type: "sqlite",
      connection_string: DEFAULT_SQLITE_CONNECTION_STRING,
    });
  };

  const connectionHint = type === "sqlite" ? copy.sqliteHint : copy.memoryHint;

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="grid gap-3 md:grid-cols-[1fr_220px]">
        <div className="space-y-1">
          <div className="text-sm font-medium">{copy.title}</div>
          <div className="text-muted-foreground text-xs">{copy.subtitle}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs font-medium">{copy.backend}</div>
          <Select value={type} onValueChange={handleTypeChange}>
            <SelectTrigger disabled={disabled} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sqlite">{copy.typeSqlite}</SelectItem>
              <SelectItem value="memory">{copy.typeMemory}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <FieldTip
        zh={copy.backendTipZh ?? ""}
        en={copy.backendTipEn ?? ""}
        recommended={copy.backendRecommended}
        risk={copy.backendRisk}
      />

      {type !== "memory" ? (
        <div className="space-y-1.5">
          <div className="text-xs font-medium">{copy.connectionString}</div>
          <div className="bg-muted/10 text-foreground/80 rounded-md border px-3 py-2 text-xs font-mono">
            {DEFAULT_SQLITE_CONNECTION_STRING}
          </div>
          <div className="text-muted-foreground text-xs">{connectionHint}</div>
        </div>
      ) : (
        <div className="text-muted-foreground text-xs">{connectionHint}</div>
      )}
    </div>
  );
}
