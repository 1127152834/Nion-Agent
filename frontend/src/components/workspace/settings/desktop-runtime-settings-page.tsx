"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/core/i18n/hooks";
import { useDesktopRuntime } from "@/core/platform/hooks";

import { SettingsSection } from "./settings-section";

type RuntimePortsPayload = {
  frontendPort: number;
  gatewayPort: number;
  langgraphPort: number;
};

type RuntimePortsDraft = {
  frontendPort: string;
  gatewayPort: string;
  langgraphPort: string;
};

const MIN_PORT = 1024;
const MAX_PORT = 65535;

const EMPTY_DRAFT: RuntimePortsDraft = {
  frontendPort: "3000",
  gatewayPort: "8001",
  langgraphPort: "2024",
};

function toDraft(ports: RuntimePortsPayload): RuntimePortsDraft {
  return {
    frontendPort: String(ports.frontendPort),
    gatewayPort: String(ports.gatewayPort),
    langgraphPort: String(ports.langgraphPort),
  };
}

function parseDraft(draft: RuntimePortsDraft): RuntimePortsPayload | null {
  const frontendPort = Number(draft.frontendPort);
  const gatewayPort = Number(draft.gatewayPort);
  const langgraphPort = Number(draft.langgraphPort);

  if (![frontendPort, gatewayPort, langgraphPort].every(Number.isInteger)) {
    return null;
  }

  return {
    frontendPort,
    gatewayPort,
    langgraphPort,
  };
}

function portsEqual(a: RuntimePortsDraft, b: RuntimePortsDraft): boolean {
  return (
    a.frontendPort === b.frontendPort
    && a.gatewayPort === b.gatewayPort
    && a.langgraphPort === b.langgraphPort
  );
}

export function DesktopRuntimeSettingsPage() {
  const { t } = useI18n();
  const { mounted, isDesktopRuntime } = useDesktopRuntime();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [activePorts, setActivePorts] = useState<RuntimePortsPayload | null>(null);
  const [initialDraft, setInitialDraft] = useState<RuntimePortsDraft>(EMPTY_DRAFT);
  const [draft, setDraft] = useState<RuntimePortsDraft>(EMPTY_DRAFT);

  const validationMessage = useMemo(() => {
    const parsed = parseDraft(draft);
    if (!parsed) {
      return t.settings.desktopRuntime.validationInteger;
    }

    const values = [parsed.frontendPort, parsed.gatewayPort, parsed.langgraphPort];
    const inRange = values.every((value) => value >= MIN_PORT && value <= MAX_PORT);
    if (!inRange) {
      return t.settings.desktopRuntime.validationRange;
    }

    if (new Set(values).size !== values.length) {
      return t.settings.desktopRuntime.validationDistinct;
    }

    return null;
  }, [draft, t.settings.desktopRuntime.validationDistinct, t.settings.desktopRuntime.validationInteger, t.settings.desktopRuntime.validationRange]);

  const dirty = useMemo(() => !portsEqual(draft, initialDraft), [draft, initialDraft]);
  const activePortItems = useMemo(
    () =>
      activePorts
        ? [
          {
            label: t.settings.desktopRuntime.frontendPortLabel,
            value: activePorts.frontendPort,
          },
          {
            label: t.settings.desktopRuntime.gatewayPortLabel,
            value: activePorts.gatewayPort,
          },
          {
            label: t.settings.desktopRuntime.langgraphPortLabel,
            value: activePorts.langgraphPort,
          },
        ]
        : [],
    [
      activePorts,
      t.settings.desktopRuntime.frontendPortLabel,
      t.settings.desktopRuntime.gatewayPortLabel,
      t.settings.desktopRuntime.langgraphPortLabel,
    ],
  );

  const loadRuntimePorts = useCallback(async () => {
    if (!window.electronAPI) {
      return;
    }

    setLoading(true);
    try {
      const payload = await window.electronAPI.getRuntimePorts();
      setVersion(payload.version);
      setActivePorts(payload.active ?? null);
      const nextDraft = toDraft(payload.ports);
      setInitialDraft(nextDraft);
      setDraft(nextDraft);
    } catch (error) {
      console.error("[Settings] Failed to load runtime ports:", error);
      toast.error(t.settings.desktopRuntime.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [t.settings.desktopRuntime.loadFailed]);

  useEffect(() => {
    if (!mounted || !isDesktopRuntime) {
      return;
    }
    void loadRuntimePorts();
  }, [isDesktopRuntime, loadRuntimePorts, mounted]);

  const onSave = useCallback(async () => {
    if (!window.electronAPI) {
      return;
    }

    const parsed = parseDraft(draft);
    if (!parsed || validationMessage) {
      return;
    }

    setSaving(true);
    try {
      const payload = await window.electronAPI.updateRuntimePorts(parsed);
      setVersion(payload.version);
      setActivePorts(payload.active);
      const nextDraft = toDraft(payload.ports);
      setInitialDraft(nextDraft);
      setDraft(nextDraft);
      toast.success(t.settings.desktopRuntime.saveSuccess);
    } catch (error) {
      console.error("[Settings] Failed to update runtime ports:", error);
      toast.error(t.settings.desktopRuntime.saveFailed);
    } finally {
      setSaving(false);
    }
  }, [draft, t.settings.desktopRuntime.saveFailed, t.settings.desktopRuntime.saveSuccess, validationMessage]);

  return (
    <SettingsSection
      title={t.settings.desktopRuntime.title}
      description={t.settings.desktopRuntime.description}
    >
      {!mounted ? null : !isDesktopRuntime ? (
        <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          {t.settings.desktopRuntime.desktopOnlyHint}
        </div>
      ) : (
        <div className="space-y-4">
          <Card className="border-border/70 py-0">
            <CardContent className="space-y-4 p-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                  <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                    {t.settings.desktopRuntime.configVersion}
                  </div>
                  <div className="mt-1 font-mono text-2xl leading-none tracking-tight">
                    {version ?? "-"}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                  <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                    {t.settings.desktopRuntime.activePorts}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {activePortItems.length > 0 ? activePortItems.map((item) => (
                      <Badge
                        key={item.label}
                        variant="outline"
                        className="font-mono text-xs"
                      >
                        {item.label.replace(/\s*端口$|\s*Port$/i, "")}:{item.value}
                      </Badge>
                    )) : (
                      <span className="font-mono text-xs">-</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-muted-foreground rounded-lg border border-dashed px-3 py-2 text-xs">
                {t.settings.desktopRuntime.restartHint}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-3">
              <Label htmlFor="desktop-port-frontend">{t.settings.desktopRuntime.frontendPortLabel}</Label>
              <Input
                id="desktop-port-frontend"
                type="number"
                min={MIN_PORT}
                max={MAX_PORT}
                value={draft.frontendPort}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, frontendPort: event.target.value }));
                }}
                disabled={loading || saving}
              />
            </div>

            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-3">
              <Label htmlFor="desktop-port-gateway">{t.settings.desktopRuntime.gatewayPortLabel}</Label>
              <Input
                id="desktop-port-gateway"
                type="number"
                min={MIN_PORT}
                max={MAX_PORT}
                value={draft.gatewayPort}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, gatewayPort: event.target.value }));
                }}
                disabled={loading || saving}
              />
            </div>

            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-3">
              <Label htmlFor="desktop-port-langgraph">{t.settings.desktopRuntime.langgraphPortLabel}</Label>
              <Input
                id="desktop-port-langgraph"
                type="number"
                min={MIN_PORT}
                max={MAX_PORT}
                value={draft.langgraphPort}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, langgraphPort: event.target.value }));
                }}
                disabled={loading || saving}
              />
            </div>
          </div>

          <div className="text-muted-foreground text-xs">
            {`Port range: ${MIN_PORT}-${MAX_PORT}`}
          </div>

          {validationMessage ? (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              {validationMessage}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDraft(initialDraft)}
              disabled={!dirty || loading || saving}
            >
              {t.settings.desktopRuntime.reset}
            </Button>
            <Button
              type="button"
              onClick={() => void onSave()}
              disabled={!dirty || loading || saving || Boolean(validationMessage)}
            >
              {saving ? t.settings.desktopRuntime.saving : t.settings.desktopRuntime.save}
            </Button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
