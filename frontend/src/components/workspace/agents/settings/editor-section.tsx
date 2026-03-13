"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeEditor } from "@/components/workspace/code-editor";
import { MarkdownContent } from "@/components/workspace/messages/markdown-content";
import {
  useAgentIdentity,
  useAgentSoul,
  useUpdateAgentIdentity,
  useUpdateAgentSoul,
} from "@/core/agents/editor-hooks";
import { useI18n } from "@/core/i18n/hooks";
import { streamdownPlugins } from "@/core/streamdown";

interface EditorSectionProps {
  agentName: string;
}

interface MarkdownAssetEditorProps {
  title: string;
  content: string;
  onChange: (value: string) => void;
  hasChanges: boolean;
  onCancel: () => void;
  onSave: () => void;
  isSaving: boolean;
}

function MarkdownAssetEditor({
  title,
  content,
  onChange,
  hasChanges,
  onCancel,
  onSave,
  isSaving,
}: MarkdownAssetEditorProps) {
  const { t } = useI18n();
  const copy = t.agents.settings;
  const editorCopy = copy.editor;
  const [mode, setMode] = useState<"edit" | "preview">("preview");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <div className="space-y-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <Tabs value={mode} onValueChange={(value) => setMode(value as "edit" | "preview")}>
            <TabsList className="h-8">
              <TabsTrigger value="edit" className="text-xs">
                {editorCopy.editMode}
              </TabsTrigger>
              <TabsTrigger value="preview" className="text-xs">
                {editorCopy.previewMode}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex gap-2">
          {hasChanges && (
            <>
              <Button variant="outline" size="sm" onClick={onCancel}>
                {copy.cancel}
              </Button>
              <Button size="sm" onClick={onSave} disabled={isSaving}>
                {isSaving ? copy.saving : copy.save}
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {mode === "edit" ? (
          <CodeEditor
            value={content}
            onChange={onChange}
            className="min-h-[420px]"
          />
        ) : (
          <div className="min-h-[420px] rounded-xl border bg-muted/20 p-4">
            <MarkdownContent
              content={content.trim() ? content : editorCopy.previewEmpty}
              isLoading={false}
              remarkPlugins={streamdownPlugins.remarkPlugins}
              rehypePlugins={streamdownPlugins.rehypePlugins}
              className="max-w-none"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
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
    <MarkdownAssetEditor
      title={editorCopy.soulTitle}
      content={localContent}
      onChange={(value) => {
        setLocalContent(value);
        setHasChanges(value !== content);
      }}
      hasChanges={hasChanges}
      onCancel={handleCancel}
      onSave={handleSave}
      isSaving={updateMutation.isPending}
    />
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
    <MarkdownAssetEditor
      title={editorCopy.identityTitle}
      content={localContent}
      onChange={(value) => {
        setLocalContent(value);
        setHasChanges(value !== content);
      }}
      hasChanges={hasChanges}
      onCancel={handleCancel}
      onSave={handleSave}
      isSaving={updateMutation.isPending}
    />
  );
}
