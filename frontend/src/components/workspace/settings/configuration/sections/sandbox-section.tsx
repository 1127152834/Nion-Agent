"use client";

import { ChevronDownIcon } from "lucide-react";
import { useRef, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { FieldTip } from "../field-tip";
import {
  asBoolean,
  asObject,
  asString,
  cloneConfig,
  type ConfigDraft,
} from "../shared";

function getSandboxMode(useValue: string): "local" | "aio" | "custom" {
  if (useValue.includes("LocalSandboxProvider")) {
    return "local";
  }
  if (useValue.includes("AioSandboxProvider")) {
    return "aio";
  }
  return "custom";
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function SandboxSection({
  config,
  onChange,
  disabled,
}: {
  config: ConfigDraft;
  onChange: (next: ConfigDraft) => void;
  disabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const settingsLike = t.settings as {
    configSections?: {
      sandbox?: Record<string, string>;
    };
  };
  const copy = (settingsLike.configSections?.sandbox ?? {}) as Record<string, string | undefined>;
  const sandbox = asObject(config.sandbox);
  const sandboxUse = asString(sandbox.use);
  const sandboxMode = getSandboxMode(sandboxUse);
  const sandboxUseBeforeStrictModeRef = useRef<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const strictModeEnabled = asBoolean(sandbox.strict_mode, false);
  const strictModeTip =
    locale === "zh-CN" ? (copy.strictModeTipZh ?? "") : (copy.strictModeTipEn ?? "");

  const updateSandbox = (key: string, value: unknown) => {
    const next = cloneConfig(config);
    const target = asObject(next.sandbox);
    if (value === undefined || value === null || value === "") {
      delete target[key];
    } else {
      target[key] = value;
    }
    next.sandbox = target;
    onChange(next);
  };

  const updateSandboxBatch = (updates: Record<string, unknown>) => {
    const next = cloneConfig(config);
    const target = asObject(next.sandbox);

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === null || value === "") {
        delete target[key];
      } else {
        target[key] = value;
      }
    }

    next.sandbox = target;
    onChange(next);
  };

  const updateSandboxNumber = (key: string, raw: string) => {
    updateSandbox(key, parseOptionalNumber(raw));
  };

  const switchSandboxMode = (mode: "local" | "aio" | "custom") => {
    if (mode === "local") {
      updateSandboxBatch({
        use: "src.sandbox.local:LocalSandboxProvider",
        strict_mode: strictModeEnabled ? false : undefined,
      });
      return;
    }
    if (mode === "aio") {
      updateSandbox("use", "src.community.aio_sandbox:AioSandboxProvider");
      return;
    }
    updateSandboxBatch({
      use: "",
      strict_mode: strictModeEnabled ? false : undefined,
    });
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="grid gap-3 md:grid-cols-[1fr_220px]">
        <div className="space-y-1">
          <div className="text-sm font-medium">{copy.title}</div>
          <div className="text-muted-foreground text-xs">{copy.subtitle}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs font-medium">{copy.mode}</div>
          <Select value={sandboxMode} onValueChange={switchSandboxMode}>
            <SelectTrigger disabled={disabled} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local" disabled={strictModeEnabled}>{copy.local}</SelectItem>
              <SelectItem value="aio">{copy.aio}</SelectItem>
              <SelectItem value="custom" disabled={strictModeEnabled}>{copy.custom}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <FieldTip
        zh={copy.modeTipZh ?? ""}
        en={copy.modeTipEn ?? ""}
      />

      <div className="rounded-md border bg-muted/30 p-3">
        <div className="grid gap-3 md:grid-cols-[1fr_220px] md:items-start">
          <div className="space-y-1">
            <div className="text-sm font-medium">{copy.strictMode}</div>
            {strictModeTip ? (
              <div className="text-muted-foreground text-xs leading-relaxed">{strictModeTip}</div>
            ) : null}
          </div>
          <div className="flex justify-end">
            <Switch
              checked={strictModeEnabled}
              onCheckedChange={(checked) => {
                if (checked) {
                  // Strict mode forces AIO sandbox; remember current selection so we can restore it.
                  sandboxUseBeforeStrictModeRef.current = sandboxUse;
                  setAdvancedOpen(false);
                  updateSandboxBatch({
                    strict_mode: true,
                    use: "src.community.aio_sandbox:AioSandboxProvider",
                  });
                  return;
                }
                setAdvancedOpen(false);

                const restoreUse = sandboxUseBeforeStrictModeRef.current;
                sandboxUseBeforeStrictModeRef.current = null;

                updateSandboxBatch({
                  // Default is disabled; keep config clean by removing the override.
                  strict_mode: undefined,
                  // If strict mode was forcing AIO and we don't know previous selection, fall back to local.
                  use: restoreUse ?? (sandboxMode === "aio"
                    ? "src.sandbox.local:LocalSandboxProvider"
                    : sandboxUse),
                });
              }}
              disabled={disabled}
            />
          </div>
        </div>
      </div>

      {sandboxMode === "custom" && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium">{copy.usePath}</div>
          <Input
            value={sandboxUse}
            placeholder={copy.usePathPlaceholder}
            onChange={(e) => updateSandbox("use", e.target.value)}
            disabled={disabled}
          />
        </div>
      )}

      {sandboxMode === "aio" && (
        <>
          {copy.aioDefaultsHint ? (
            <div className="text-muted-foreground text-xs leading-relaxed">
              {copy.aioDefaultsHint}
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={asBoolean(sandbox.auto_start, true)}
              onCheckedChange={(checked) => updateSandbox("auto_start", checked)}
              disabled={disabled}
            />
            {copy.autoStart}
          </label>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
              >
                <ChevronDownIcon
                  className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")}
                />
                {copy.advanced}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="text-xs font-medium">{copy.image}</div>
                  <Input
                    value={asString(sandbox.image)}
                    placeholder={copy.imagePlaceholder}
                    onChange={(e) => updateSandbox("image", e.target.value)}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-medium">{copy.port}</div>
                  <Input
                    type="number"
                    value={asString(sandbox.port)}
                    placeholder="8080"
                    onChange={(e) => updateSandboxNumber("port", e.target.value)}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-medium">{copy.baseUrl}</div>
                  <Input
                    value={asString(sandbox.base_url)}
                    placeholder={copy.baseUrlPlaceholder}
                    onChange={(e) => updateSandbox("base_url", e.target.value)}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-medium">{copy.containerPrefix}</div>
                  <Input
                    value={asString(sandbox.container_prefix)}
                    placeholder="nion-sandbox"
                    onChange={(e) => updateSandbox("container_prefix", e.target.value)}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-medium">{copy.idleTimeout}</div>
                  <Input
                    type="number"
                    value={asString(sandbox.idle_timeout)}
                    placeholder="600"
                    onChange={(e) => updateSandboxNumber("idle_timeout", e.target.value)}
                    disabled={disabled}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}

      {sandboxMode === "custom" && (
        <div className="text-muted-foreground text-xs">
          {copy.customConfiguredHint}
        </div>
      )}
    </div>
  );
}
