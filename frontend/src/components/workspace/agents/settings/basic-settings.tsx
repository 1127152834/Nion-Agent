"use client";

import { ChevronDownIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useAgent,
  useDefaultAgentConfig,
  useUpdateAgent,
  useUpdateDefaultAgentConfig,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import { cn } from "@/lib/utils";

interface BasicSettingsProps {
  agentName: string;
}

const DEFAULT_MODEL_VALUE = "__agent_default_model__";
const LEGACY_MODEL_VALUE_PREFIX = "__agent_legacy_model__:";

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
  const { models, isLoading: isModelsLoading, error: modelsError } = useModels();

  const source = isDefaultAgent ? defaultConfig : agent;
  const isLoading = isDefaultAgent ? defaultLoading : customLoading;
  const error = isDefaultAgent ? defaultError : customError;

  const [description, setDescription] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [model, setModel] = useState("");
  const [toolGroups, setToolGroups] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const modelOptions = useMemo(
    () =>
      models
        .map((item) => ({
          name: item.name.trim(),
          label: item.display_name?.trim() || item.name.trim(),
        }))
        .filter((item) => item.name.length > 0),
    [models],
  );

  const knownModelNames = useMemo(
    () => new Set(modelOptions.map((item) => item.name)),
    [modelOptions],
  );

  useEffect(() => {
    if (!source) {
      return;
    }
    setDescription(source.description ?? "");
    setDisplayName(source.display_name ?? "");
    setModel(source.model ?? "");
    setToolGroups(toolGroupsToText(source.tool_groups));
  }, [source]);

  const normalizedCurrentModel = model.trim();
  const legacyModelName = normalizedCurrentModel && !knownModelNames.has(normalizedCurrentModel)
    ? normalizedCurrentModel
    : null;
  const modelSelectValue = legacyModelName
    ? `${LEGACY_MODEL_VALUE_PREFIX}${legacyModelName}`
    : normalizedCurrentModel || DEFAULT_MODEL_VALUE;

  const hasChanges = useMemo(() => {
    if (!source) {
      return false;
    }
    return (
      description !== (source.description ?? "")
      || displayName !== (source.display_name ?? "")
      || normalizedCurrentModel !== (source.model ?? "")
      || toolGroups !== toolGroupsToText(source.tool_groups)
    );
  }, [
    description,
    displayName,
    normalizedCurrentModel,
    source,
    toolGroups,
  ]);

  async function handleSave() {
    if (!source) {
      return;
    }

    if (legacyModelName) {
      toast.error(basicCopy.modelLegacyUnavailableHint);
      return;
    }

    try {
      const nextModel = normalizedCurrentModel || null;
      if (isDefaultAgent) {
        await updateDefaultAgent.mutateAsync({
          description,
          model: nextModel,
          tool_groups: textToToolGroups(toolGroups) ?? null,
        });
      } else {
        await updateCustomAgent.mutateAsync({
          name: agentName,
          request: {
            display_name: displayName.trim() ? displayName.trim() : null,
            description,
            model: nextModel,
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
    setDisplayName(source.display_name ?? "");
    setModel(source.model ?? "");
    setToolGroups(toolGroupsToText(source.tool_groups));
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
          <Label htmlFor="agent-display-name">{basicCopy.displayNameLabel}</Label>
          <Input
            id="agent-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={basicCopy.displayNamePlaceholder}
            disabled={isDefaultAgent}
          />
          <p className="text-muted-foreground text-xs">{basicCopy.displayNameHint}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="agent-name">{basicCopy.nameLabel}</Label>
          <Input id="agent-name" value={source.name} disabled readOnly />
          <p className="text-muted-foreground text-xs">{basicCopy.nameImmutableHint}</p>
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
          <Label>{basicCopy.modelLabel}</Label>
          <Select
            value={modelSelectValue}
            onValueChange={(value) => {
              if (value === DEFAULT_MODEL_VALUE) {
                setModel("");
                return;
              }
              if (value.startsWith(LEGACY_MODEL_VALUE_PREFIX)) {
                return;
              }
              setModel(value);
            }}
          >
            <SelectTrigger id="agent-model">
              <SelectValue placeholder={basicCopy.modelDefaultOption} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_MODEL_VALUE}>{basicCopy.modelDefaultOption}</SelectItem>
              {modelOptions.map((item) => (
                <SelectItem key={item.name} value={item.name}>
                  {item.label}
                </SelectItem>
              ))}
              {legacyModelName ? (
                <SelectItem
                  value={`${LEGACY_MODEL_VALUE_PREFIX}${legacyModelName}`}
                  disabled
                >
                  {basicCopy.modelLegacyUnavailableOption.replace("{model}", legacyModelName)}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
          {isModelsLoading ? (
            <p className="text-muted-foreground text-xs">{copy.loading}</p>
          ) : null}
          {modelsError ? (
            <p className="text-destructive text-xs">{basicCopy.modelLoadFailed}</p>
          ) : null}
          {!isModelsLoading && !modelsError && modelOptions.length === 0 ? (
            <p className="text-muted-foreground text-xs">{basicCopy.modelEmptyHint}</p>
          ) : null}
          {legacyModelName ? (
            <p className="text-destructive text-xs">{basicCopy.modelLegacyUnavailableHint}</p>
          ) : null}
        </div>
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
            >
              <ChevronDownIcon
                className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")}
              />
              {basicCopy.advancedTitle}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="space-y-2">
              <Label htmlFor="agent-tool-groups">{basicCopy.toolGroupsLabel}</Label>
              <Input
                id="agent-tool-groups"
                value={toolGroups}
                onChange={(event) => setToolGroups(event.target.value)}
                placeholder={basicCopy.toolGroupsPlaceholder}
              />
              <p className="text-muted-foreground text-xs">{basicCopy.toolGroupsHint}</p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
