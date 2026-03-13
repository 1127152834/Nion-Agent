"use client";

import { Clock3Icon, GitBranchPlusIcon, InfoIcon, PlayIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  useEvolutionSettings,
  useRunEvolution,
  useUpdateEvolutionSettings,
} from "@/core/agents/settings-hooks";
import type { EvolutionSettings } from "@/core/agents/settings-types";
import { useI18n } from "@/core/i18n/hooks";

interface EvolutionSettingsProps {
  agentName: string;
}

const BASE_INTERVAL_OPTIONS = [6, 12, 24, 48, 72, 168] as const;

export function EvolutionSettingsComponent({ agentName }: EvolutionSettingsProps) {
  const { t } = useI18n();
  const copy = t.agents.settings;
  const evolutionCopy = copy.evolution;
  const { settings, isLoading } = useEvolutionSettings(agentName);
  const updateMutation = useUpdateEvolutionSettings(agentName);
  const runMutation = useRunEvolution(agentName);

  const [formData, setFormData] = useState<EvolutionSettings | null>(null);

  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

  const intervalHours = useMemo(() => {
    if (!formData) {
      return 24;
    }
    const value = Number(formData.interval_hours);
    if (!Number.isFinite(value) || value <= 0) {
      return 24;
    }
    return Math.floor(value);
  }, [formData]);
  const intervalOptions = useMemo(() => {
    const values = new Set<number>(BASE_INTERVAL_OPTIONS);
    values.add(intervalHours);
    return Array.from(values).sort((a, b) => a - b);
  }, [intervalHours]);

  const handleSave = () => {
    if (!formData) return;
    updateMutation.mutate(formData);
  };
  const handleRunNow = () => {
    runMutation.mutate();
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
        <AlertTitle>{evolutionCopy.conceptTitle}</AlertTitle>
        <AlertDescription>
          <p>{evolutionCopy.conceptDescription}</p>
          <p className="mt-1">{evolutionCopy.conceptHint}</p>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{evolutionCopy.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between rounded-xl border p-3">
            <div className="space-y-1">
              <Label className="text-sm font-medium">{evolutionCopy.enabledLabel}</Label>
              <p className="text-muted-foreground text-xs">{evolutionCopy.enabledDescription}</p>
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
              <Label className="inline-flex items-center gap-1.5 text-sm font-medium">
                <Clock3Icon className="size-3.5" />
                {evolutionCopy.intervalHoursLabel}
              </Label>
              <Select
                value={String(intervalHours)}
                onValueChange={(value) => {
                  setFormData({
                    ...formData,
                    interval_hours: Number(value),
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {intervalOptions.map((hours) => (
                    <SelectItem key={hours} value={String(hours)}>
                      {evolutionCopy.intervalOption.replace("{value}", String(hours))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">{evolutionCopy.intervalHoursHint}</p>
            </div>

            <div className="flex items-center justify-between rounded-xl border p-3">
              <div className="space-y-1">
                <Label className="text-sm font-medium">{evolutionCopy.autoTriggerLabel}</Label>
                <p className="text-muted-foreground text-xs">{evolutionCopy.autoTriggerDescription}</p>
              </div>
              <Switch
                checked={formData.auto_trigger}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, auto_trigger: checked })
                }
              />
            </div>
          </div>

          <div className="rounded-xl border border-dashed p-3">
            <p className="inline-flex items-center gap-1.5 text-sm font-medium">
              <GitBranchPlusIcon className="size-4" />
              {evolutionCopy.scopeTitle}
            </p>
            <p className="text-muted-foreground mt-1 text-xs leading-5">{evolutionCopy.scopeDescription}</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={handleRunNow}
              disabled={runMutation.isPending || !formData.enabled}
              className="w-full"
            >
              <PlayIcon className="mr-1.5 size-4" />
              {runMutation.isPending ? evolutionCopy.runningNow : evolutionCopy.runNow}
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="w-full"
            >
              {updateMutation.isPending ? copy.saving : evolutionCopy.saveSettings}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">{evolutionCopy.runNowHint}</p>
        </CardContent>
      </Card>
    </div>
  );
}
