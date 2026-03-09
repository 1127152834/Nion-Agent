"use client";

import { Input } from "@/components/ui/input";
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

type CheckpointerType = "memory" | "sqlite" | "postgres";

function normalizeType(value: unknown): CheckpointerType {
  if (typeof value !== "string") {
    return "sqlite";
  }
  const raw = value.trim().toLowerCase();
  if (raw === "memory" || raw === "postgres") {
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
  const type = normalizeType(checkpointer.type);
  const connectionString = asString(checkpointer.connection_string);

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

  const handleTypeChange = (nextType: string) => {
    const normalized = normalizeType(nextType);
    if (normalized === "memory") {
      updateCheckpointer({ type: normalized, connection_string: undefined });
      return;
    }
    if (normalized === "sqlite") {
      updateCheckpointer({
        type: normalized,
        connection_string: connectionString || "checkpoints.db",
      });
      return;
    }
    updateCheckpointer({ type: normalized });
  };

  const connectionHint = type === "sqlite"
    ? copy.sqliteHint
    : type === "postgres"
      ? copy.postgresHint
      : copy.memoryHint;

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
            <SelectTrigger disabled={disabled}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sqlite">{copy.typeSqlite}</SelectItem>
              <SelectItem value="memory">{copy.typeMemory}</SelectItem>
              <SelectItem value="postgres">{copy.typePostgres}</SelectItem>
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
          <Input
            value={connectionString}
            placeholder={type === "sqlite" ? copy.sqlitePlaceholder : copy.postgresPlaceholder}
            onChange={(event) => updateCheckpointer({ connection_string: event.target.value })}
            disabled={disabled}
          />
          <div className="text-muted-foreground text-xs">{connectionHint}</div>
        </div>
      ) : (
        <div className="text-muted-foreground text-xs">{connectionHint}</div>
      )}
    </div>
  );
}
