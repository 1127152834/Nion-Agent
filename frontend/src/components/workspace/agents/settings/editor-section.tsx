"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeEditor } from "@/components/workspace/code-editor";
import {
  useAgentIdentity,
  useAgentSoul,
  useUpdateAgentIdentity,
  useUpdateAgentSoul,
} from "@/core/agents/editor-hooks";
import { useI18n } from "@/core/i18n/hooks";

interface EditorSectionProps {
  agentName: string;
}

export function SoulEditor({ agentName }: EditorSectionProps) {
  const { t } = useI18n();
  const copy = t.agents.settings;
  const editorCopy = copy.editor;
  const { data: content, isLoading, error } = useAgentSoul(agentName);
  const updateMutation = useUpdateAgentSoul(agentName);
  const [localContent, setLocalContent] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (content !== undefined) {
      setLocalContent(content);
    }
  }, [content]);

  const handleSave = () => {
    updateMutation.mutate(localContent);
    setHasChanges(false);
  };

  const handleCancel = () => {
    setLocalContent(content ?? "");
    setHasChanges(false);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">{copy.loading}</CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-destructive">{editorCopy.loadSoulFailed}</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-base">{editorCopy.soulTitle}</CardTitle>
        <div className="flex gap-2">
          {hasChanges && (
            <>
              <Button variant="outline" size="sm" onClick={handleCancel}>
                {copy.cancel}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? copy.saving : copy.save}
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <CodeEditor
          value={localContent}
          onChange={(value) => {
            setLocalContent(value);
            setHasChanges(value !== content);
          }}
          className="min-h-[400px]"
        />
      </CardContent>
    </Card>
  );
}

export function IdentityEditor({ agentName }: EditorSectionProps) {
  const { t } = useI18n();
  const copy = t.agents.settings;
  const editorCopy = copy.editor;
  const { data: content, isLoading, error } = useAgentIdentity(agentName);
  const updateMutation = useUpdateAgentIdentity(agentName);
  const [localContent, setLocalContent] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (content !== undefined) {
      setLocalContent(content);
    }
  }, [content]);

  const handleSave = () => {
    updateMutation.mutate(localContent);
    setHasChanges(false);
  };

  const handleCancel = () => {
    setLocalContent(content ?? "");
    setHasChanges(false);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">{copy.loading}</CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-destructive">{editorCopy.loadIdentityFailed}</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-base">{editorCopy.identityTitle}</CardTitle>
        <div className="flex gap-2">
          {hasChanges && (
            <>
              <Button variant="outline" size="sm" onClick={handleCancel}>
                {copy.cancel}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? copy.saving : copy.save}
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <CodeEditor
          value={localContent}
          onChange={(value) => {
            setLocalContent(value);
            setHasChanges(value !== content);
          }}
          className="min-h-[300px]"
        />
      </CardContent>
    </Card>
  );
}
