"use client";

import { Clock3Icon, HeartPulseIcon, InfoIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useHeartbeatSettings, useUpdateHeartbeatSettings } from "@/core/agents/settings-hooks";
import type { HeartbeatSettings, TemplateConfig } from "@/core/agents/settings-types";
import { useI18n } from "@/core/i18n/hooks";

interface HeartbeatSettingsProps {
  agentName: string;
}

const GOVERNANCE_TEMPLATE_ID = "memory_governance";
const BASE_INTERVAL_OPTIONS = [1, 2, 3, 6, 12, 24] as const;
const TIMEZONE_OPTIONS = [
  { value: "UTC", label: "UTC" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo" },
  { value: "America/New_York", label: "America/New_York" },
  { value: "Europe/London", label: "Europe/London" },
] as const;

function parseGovernanceIntervalHours(templates: Record<string, TemplateConfig> | undefined): number {
  const cron = templates?.[GOVERNANCE_TEMPLATE_ID]?.cron;
  if (!cron) {
    return 6;
  }
  const match = /^0 \*\/(\d+) \* \* \*$/.exec(cron.trim());
  if (!match) {
    return 6;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6;
}

function ensureGovernanceTemplate(
  templates: Record<string, TemplateConfig>,
  intervalHours: number,
): Record<string, TemplateConfig> {
  const next = { ...templates };
  const existing = next[GOVERNANCE_TEMPLATE_ID];
  next[GOVERNANCE_TEMPLATE_ID] = {
    template_id: GOVERNANCE_TEMPLATE_ID,
    enabled: existing?.enabled ?? true,
    cron: `0 */${intervalHours} * * *`,
    generate_reminder: existing?.generate_reminder ?? false,
    generate_log: existing?.generate_log ?? true,
    auto_execute: existing?.auto_execute ?? true,
  };
  return next;
}

export function HeartbeatSettingsComponent({ agentName }: HeartbeatSettingsProps) {
  const { t } = useI18n();
  const copy = t.agents.settings;
  const heartbeatCopy = copy.heartbeat;
  const { settings, isLoading } = useHeartbeatSettings(agentName);
  const updateMutation = useUpdateHeartbeatSettings(agentName);

  const [formData, setFormData] = useState<HeartbeatSettings | null>(null);

  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

  const governanceIntervalHours = useMemo(
    () => parseGovernanceIntervalHours(formData?.templates),
    [formData?.templates],
  );
  const intervalOptions = useMemo(() => {
    const values = new Set<number>(BASE_INTERVAL_OPTIONS);
    values.add(governanceIntervalHours);
    return Array.from(values).sort((a, b) => a - b);
  }, [governanceIntervalHours]);

  const handleSave = () => {
    if (!formData) return;
    updateMutation.mutate(formData);
  };

  if (isLoading) {
    return <div className="text-muted-foreground text-sm">{copy.loading}</div>;
  }

  if (!formData) {
    return <div className="text-muted-foreground text-sm">{copy.loadFailed}</div>;
  }

  return (
    <div className="space-y-4">
      <Alert>
        <InfoIcon className="size-4" />
        <AlertTitle>{heartbeatCopy.conceptTitle}</AlertTitle>
        <AlertDescription>
          <p>{heartbeatCopy.conceptDescription}</p>
          <p className="mt-1">{heartbeatCopy.conceptHint}</p>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{heartbeatCopy.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between rounded-xl border p-3">
            <div className="space-y-1">
              <Label className="text-sm font-medium">{heartbeatCopy.enabledLabel}</Label>
              <p className="text-muted-foreground text-xs">{heartbeatCopy.enabledDescription}</p>
            </div>
            <Switch
              checked={formData.enabled}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, enabled: checked })
              }
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">{heartbeatCopy.timezoneLabel}</Label>
              <Select
                value={formData.timezone}
                onValueChange={(value) =>
                  setFormData({ ...formData, timezone: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((timezone) => (
                    <SelectItem key={timezone.value} value={timezone.value}>
                      {timezone.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="inline-flex items-center gap-1.5 text-sm font-medium">
                <Clock3Icon className="size-3.5" />
                {heartbeatCopy.governanceIntervalLabel}
              </Label>
              <Select
                value={String(governanceIntervalHours)}
                onValueChange={(value) => {
                  const interval = Number(value);
                  const templates = ensureGovernanceTemplate(formData.templates ?? {}, interval);
                  setFormData({ ...formData, templates });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {intervalOptions.map((hours) => (
                    <SelectItem key={hours} value={String(hours)}>
                      {heartbeatCopy.intervalOption.replace("{value}", String(hours))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">{heartbeatCopy.governanceIntervalHint}</p>
            </div>
          </div>

          <div className="rounded-xl border border-dashed p-3">
            <p className="inline-flex items-center gap-1.5 text-sm font-medium">
              <HeartPulseIcon className="size-4" />
              {heartbeatCopy.scopeTitle}
            </p>
            <p className="text-muted-foreground mt-1 text-xs leading-5">{heartbeatCopy.scopeDescription}</p>
          </div>

          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="w-full"
          >
            {updateMutation.isPending ? copy.saving : heartbeatCopy.saveSettings}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
