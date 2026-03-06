"use client";

import { useMemo } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useArtifactContent } from "@/core/artifacts/hooks";
import { useI18n } from "@/core/i18n/hooks";
import { getFileName } from "@/core/utils/files";

import { WorkbenchContainer } from "../artifacts/workbench-container";

export function WorkbenchModal({
  open,
  onOpenChange,
  artifactPath,
  threadId,
  matchedPluginId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifactPath: string | null;
  threadId: string;
  matchedPluginId: string | null;
}) {
  const { t } = useI18n();
  const enabled = open && Boolean(artifactPath);
  const safeArtifactPath = artifactPath ?? "";
  const { content, isLoading, error } = useArtifactContent({
    filepath: safeArtifactPath,
    threadId,
    enabled,
  });

  const artifactName = useMemo(() => {
    if (!artifactPath) {
      return "";
    }
    return getFileName(artifactPath);
  }, [artifactPath]);

  const description = matchedPluginId
    ? `${t.artifactCenter.matchedPluginPrefix}${matchedPluginId}`
    : t.artifactCenter.noMatchedPlugin;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-[1000px] flex-col p-0 sm:max-w-[1000px]">
        <DialogHeader className="border-b px-6 pt-5 pb-4">
          <DialogTitle>{artifactName || t.artifactCenter.workbenchTitle}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 p-0">
          {artifactPath ? (
            <WorkbenchContainer filepath={artifactPath} threadId={threadId}>
              <div className="text-muted-foreground flex h-full items-center justify-center px-6">
                {isLoading ? (
                  <span>{t.artifactCenter.loadingContent}</span>
                ) : error ? (
                  <span>{error instanceof Error ? error.message : String(error)}</span>
                ) : content ? (
                  <pre className="text-foreground h-full w-full overflow-auto whitespace-pre-wrap p-6 text-sm">
                    {content}
                  </pre>
                ) : (
                  <span>{t.artifactCenter.noPreview}</span>
                )}
              </div>
            </WorkbenchContainer>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
