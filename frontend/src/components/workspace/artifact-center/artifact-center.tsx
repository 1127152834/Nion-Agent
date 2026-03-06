"use client";

import { LayersIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ArtifactFileList } from "@/components/workspace/artifacts/artifact-file-list";
import { useThread } from "@/components/workspace/messages/context";
import { Tooltip } from "@/components/workspace/tooltip";
import { useI18n } from "@/core/i18n/hooks";

import { WorkbenchModal } from "./workbench-modal";

export function ArtifactCenter({ threadId }: { threadId: string }) {
  const { t } = useI18n();
  const { thread } = useThread();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);

  const artifacts = useMemo(() => thread.values.artifacts ?? [], [thread.values.artifacts]);

  const handleOpenArtifact = useCallback((artifactPath: string) => {
    setSelectedArtifact(artifactPath);
    setWorkbenchOpen(true);
  }, []);

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const shouldToggle = (event.metaKey || event.ctrlKey) && event.shiftKey && key === "a";
      if (!shouldToggle) {
        return;
      }
      event.preventDefault();
      setSheetOpen((previous) => !previous);
    };

    window.addEventListener("keydown", onKeydown);
    return () => {
      window.removeEventListener("keydown", onKeydown);
    };
  }, []);

  return (
    <>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <Tooltip content={t.artifactCenter.triggerTooltip}>
            <Button className="text-muted-foreground hover:text-foreground" variant="ghost">
              <LayersIcon className="size-4" />
              {t.artifactCenter.trigger}
              {artifacts.length > 0 ? ` (${artifacts.length})` : ""}
            </Button>
          </Tooltip>
        </SheetTrigger>
        <SheetContent className="w-[92vw] sm:max-w-[540px]">
          <SheetHeader>
            <SheetTitle>{t.artifactCenter.title}</SheetTitle>
            <SheetDescription>
              {t.artifactCenter.description} {t.artifactCenter.shortcut}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 h-[calc(100vh-140px)] overflow-y-auto pr-2">
            {artifacts.length === 0 ? (
              <div className="text-muted-foreground flex h-full min-h-36 items-center justify-center rounded-md border border-dashed px-4 text-sm">
                {t.artifactCenter.empty}
              </div>
            ) : (
              <ArtifactFileList
                className="gap-3"
                files={artifacts}
                threadId={threadId}
                onOpenFile={handleOpenArtifact}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
      <WorkbenchModal
        open={workbenchOpen}
        onOpenChange={setWorkbenchOpen}
        artifactPath={selectedArtifact}
        threadId={threadId}
      />
    </>
  );
}
