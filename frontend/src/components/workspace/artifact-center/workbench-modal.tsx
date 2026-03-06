"use client";

import { LoaderIcon } from "lucide-react";
import { useMemo } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CodeEditor } from "@/components/workspace/code-editor";
import { useThread } from "@/components/workspace/messages/context";
import { useArtifactContent } from "@/core/artifacts/hooks";
import { urlOfArtifact } from "@/core/artifacts/utils";
import { useI18n } from "@/core/i18n/hooks";
import { checkCodeFile, getFileName } from "@/core/utils/files";

import { ArtifactFilePreview } from "../artifacts/artifact-file-detail";
import { WorkbenchContainer } from "../artifacts/workbench-container";

function resolvePath(path: string) {
  if (!path.startsWith("write-file:")) {
    return path;
  }
  const url = new URL(path);
  return decodeURIComponent(url.pathname);
}

export function WorkbenchModal({
  open,
  onOpenChange,
  artifactPath,
  threadId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifactPath: string | null;
  threadId: string;
}) {
  const { t } = useI18n();
  const currentArtifactPath = artifactPath ?? "";
  const displayPath = useMemo(
    () => resolvePath(currentArtifactPath),
    [currentArtifactPath],
  );
  const isWriteFile = currentArtifactPath.startsWith("write-file:");
  const fileInfo = useMemo(() => {
    if (isWriteFile) {
      const language = checkCodeFile(displayPath).language ?? "text";
      return { isCodeFile: true, language };
    }
    return checkCodeFile(displayPath);
  }, [displayPath, isWriteFile]);

  const { content, isLoading } = useArtifactContent({
    filepath: currentArtifactPath,
    threadId,
    enabled: Boolean(artifactPath) && fileInfo.isCodeFile && !isWriteFile,
  });

  if (!artifactPath) {
    return null;
  }

  const modalTitle = `${t.artifactCenter.workbenchTitle} · ${getFileName(displayPath)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[82vh] max-w-[90vw] p-0 sm:max-w-[1100px]">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="truncate">{modalTitle}</DialogTitle>
          <DialogDescription className="truncate">
            {displayPath}
          </DialogDescription>
        </DialogHeader>
        <div className="h-[calc(82vh-72px)] overflow-hidden">
          <WorkbenchContainer filepath={displayPath} threadId={threadId}>
            <DefaultArtifactView
              path={displayPath}
              rawPath={currentArtifactPath}
              threadId={threadId}
              isCodeFile={fileInfo.isCodeFile}
              language={fileInfo.language}
              content={content ?? ""}
              isLoading={isLoading}
            />
          </WorkbenchContainer>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DefaultArtifactView({
  path,
  rawPath,
  threadId,
  isCodeFile,
  language,
  content,
  isLoading,
}: {
  path: string;
  rawPath: string;
  threadId: string;
  isCodeFile: boolean;
  language: string | null;
  content: string;
  isLoading: boolean;
}) {
  const { t } = useI18n();
  const { isMock } = useThread();

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
        <LoaderIcon className="size-4 animate-spin" />
        {t.common.loading}
      </div>
    );
  }

  if (!isCodeFile) {
    return (
      <iframe
        className="size-full"
        src={urlOfArtifact({ filepath: path, threadId, isMock })}
      />
    );
  }

  if (!rawPath.startsWith("write-file:") && (language === "markdown" || language === "html")) {
    return (
      <ArtifactFilePreview
        filepath={path}
        threadId={threadId}
        content={content}
        language={language}
      />
    );
  }

  return (
    <CodeEditor
      className="size-full resize-none rounded-none border-none"
      readonly
      value={content}
    />
  );
}
