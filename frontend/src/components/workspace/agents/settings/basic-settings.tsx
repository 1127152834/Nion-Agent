"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useAgent,
  useDefaultAgentConfig,
  useUpdateAgent,
  useUpdateDefaultAgentConfig,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

interface BasicSettingsProps {
  agentName: string;
}

function toolGroupsToText(groups: string[] | null | undefined): string {
  if (!groups || groups.length === 0) {
    return "";
  }
  return groups.join(", ");
}

function textToToolGroups(value: string): string[] | undefined {
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

export function BasicSettings({ agentName }: BasicSettingsProps) {
  const { t } = useI18n();
  const copy = t.agents.settings;
  const basicCopy = copy.basic;
  const isDefaultAgent = agentName === "_default";
  const { agent, isLoading: customLoading, error: customError } = useAgent(
    isDefaultAgent ? null : agentName,
  );
  const {
    config: defaultConfig,
    isLoading: defaultLoading,
    error: defaultError,
  } = useDefaultAgentConfig();
  const updateCustomAgent = useUpdateAgent();
  const updateDefaultAgent = useUpdateDefaultAgentConfig();

  const source = isDefaultAgent ? defaultConfig : agent;
  const isLoading = isDefaultAgent ? defaultLoading : customLoading;
  const error = isDefaultAgent ? defaultError : customError;

  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [toolGroups, setToolGroups] = useState("");
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(true);
  const [evolutionEnabled, setEvolutionEnabled] = useState(true);

  useEffect(() => {
    if (!source) {
      return;
    }
    setDescription(source.description ?? "");
    setModel(source.model ?? "");
    setToolGroups(toolGroupsToText(source.tool_groups));
    setHeartbeatEnabled(source.heartbeat_enabled ?? true);
    setEvolutionEnabled(source.evolution_enabled ?? true);
  }, [source]);

  const hasChanges = useMemo(() => {
    if (!source) {
      return false;
    }
    return (
      description !== (source.description ?? "")
      || model !== (source.model ?? "")
      || toolGroups !== toolGroupsToText(source.tool_groups)
      || (isDefaultAgent
        && (heartbeatEnabled !== (source.heartbeat_enabled ?? true)
          || evolutionEnabled !== (source.evolution_enabled ?? true)))
    );
  }, [
    description,
    evolutionEnabled,
    heartbeatEnabled,
    isDefaultAgent,
    model,
    source,
    toolGroups,
  ]);

  async function handleSave() {
    if (!source) {
      return;
    }

    try {
      if (isDefaultAgent) {
        await updateDefaultAgent.mutateAsync({
          description,
          model: model || null,
          tool_groups: textToToolGroups(toolGroups) ?? null,
          heartbeat_enabled: heartbeatEnabled,
          evolution_enabled: evolutionEnabled,
        });
      } else {
        await updateCustomAgent.mutateAsync({
          name: agentName,
          request: {
            description,
            model: model || null,
            tool_groups: textToToolGroups(toolGroups) ?? null,
          },
        });
      }
      toast.success(basicCopy.saved);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : basicCopy.saveFailed);
    }
  }

  function handleReset() {
    if (!source) {
      return;
    }
    setDescription(source.description ?? "");
    setModel(source.model ?? "");
    setToolGroups(toolGroupsToText(source.tool_groups));
    setHeartbeatEnabled(source.heartbeat_enabled ?? true);
    setEvolutionEnabled(source.evolution_enabled ?? true);
  }

  if (isLoading) {
    return (
        <Card>
        <CardContent className="py-8">{copy.loading}</CardContent>
      </Card>
    );
  }

  if (error || !source) {
    return (
      <Card>
        <CardContent className="py-8 text-destructive">
          {copy.loadFailed}
        </CardContent>
      </Card>
    );
  }

  const saving = updateCustomAgent.isPending || updateDefaultAgent.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-base">{basicCopy.title}</CardTitle>
        <div className="flex gap-2">
          {hasChanges ? (
            <>
              <Button variant="outline" size="sm" onClick={handleReset}>
                {copy.cancel}
              </Button>
              <Button size="sm" disabled={saving} onClick={() => void handleSave()}>
                {saving ? copy.saving : copy.save}
              </Button>
            </>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="agent-name">{basicCopy.nameLabel}</Label>
          <Input id="agent-name" value={source.name} disabled readOnly />
          {isDefaultAgent ? (
            <p className="text-muted-foreground text-xs">{basicCopy.nameImmutableHint}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="agent-description">{basicCopy.descriptionLabel}</Label>
          <Input
            id="agent-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={basicCopy.descriptionPlaceholder}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="agent-model">{basicCopy.modelLabel}</Label>
          <Input
            id="agent-model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder={basicCopy.modelPlaceholder}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="agent-tool-groups">{basicCopy.toolGroupsLabel}</Label>
          <Input
            id="agent-tool-groups"
            value={toolGroups}
            onChange={(event) => setToolGroups(event.target.value)}
            placeholder={basicCopy.toolGroupsPlaceholder}
          />
        </div>
        {isDefaultAgent ? (
          <>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">{basicCopy.heartbeatTitle}</p>
                <p className="text-muted-foreground text-xs">{basicCopy.heartbeatDescription}</p>
              </div>
              <Switch checked={heartbeatEnabled} onCheckedChange={setHeartbeatEnabled} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">{basicCopy.evolutionTitle}</p>
                <p className="text-muted-foreground text-xs">{basicCopy.evolutionDescription}</p>
              </div>
              <Switch checked={evolutionEnabled} onCheckedChange={setEvolutionEnabled} />
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
