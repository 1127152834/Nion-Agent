"use client";

import { useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";
import { useEvolutionSettings, useUpdateEvolutionSettings } from "@/core/agents/settings-hooks";
import type { EvolutionSettings } from "@/core/agents/settings-types";

interface EvolutionSettingsProps {
  agentName: string;
}

export function EvolutionSettingsComponent({ agentName }: EvolutionSettingsProps) {
  const { t } = useI18n();
  const copy = t.agents.settings;
  const evolutionCopy = copy.evolution;
  const { settings, isLoading } = useEvolutionSettings(agentName);
  const updateMutation = useUpdateEvolutionSettings(agentName);

  const [formData, setFormData] = useState<EvolutionSettings | null>(null);

  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{evolutionCopy.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Enable Switch */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">{evolutionCopy.enabledLabel}</label>
            <Switch
              checked={formData.enabled}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, enabled: checked })
              }
            />
          </div>

          {/* Interval Hours Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{evolutionCopy.intervalHoursLabel}</label>
            <Input
              type="number"
              min="1"
              value={formData.interval_hours}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  interval_hours: parseInt(e.target.value, 10) || 24,
                })
              }
            />
          </div>

          {/* Auto Trigger Switch */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">{evolutionCopy.autoTriggerLabel}</label>
            <Switch
              checked={formData.auto_trigger}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, auto_trigger: checked })
              }
            />
          </div>

          {/* Save Button */}
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="w-full"
          >
            {updateMutation.isPending ? copy.saving : evolutionCopy.saveSettings}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
