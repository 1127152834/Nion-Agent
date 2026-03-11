"use client";

import { useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";
import { useHeartbeatSettings, useUpdateHeartbeatSettings } from "@/core/agents/settings-hooks";
import type { HeartbeatSettings } from "@/core/agents/settings-types";

interface HeartbeatSettingsProps {
  agentName: string;
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
          <CardTitle>{heartbeatCopy.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Enable Switch */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">{heartbeatCopy.enabledLabel}</label>
            <Switch
              checked={formData.enabled}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, enabled: checked })
              }
            />
          </div>

          {/* Timezone Select */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{heartbeatCopy.timezoneLabel}</label>
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
                <SelectItem value="UTC">UTC</SelectItem>
                <SelectItem value="Asia/Shanghai">Asia/Shanghai</SelectItem>
                <SelectItem value="America/New_York">America/New_York</SelectItem>
                <SelectItem value="Europe/London">Europe/London</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Templates Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{heartbeatCopy.templatesLabel}</label>
            <div className="text-muted-foreground text-xs">
              {heartbeatCopy.templatesComingSoon}
            </div>
          </div>

          {/* Save Button */}
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
