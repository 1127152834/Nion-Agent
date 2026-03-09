import { FolderIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useWorkspaceLiveSync, useWorkspaceTree } from "@/core/artifacts";
import { useI18n } from "@/core/i18n/hooks";
import { useDesktopRuntime } from "@/core/platform/hooks";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import {
  ArtifactDirectoryTree,
  ArtifactFileDetail,
  useArtifacts,
} from "../artifacts";
import { useThread } from "../messages/context";

const CLOSE_MODE = { chat: 100, artifacts: 0 };
const OPEN_MODE = { chat: 60, artifacts: 40 };

const ChatBox: React.FC<{ children: React.ReactNode; threadId: string }> = ({
  children,
  threadId,
}) => {
  const { t } = useI18n();
  const { thread } = useThread();
  const layoutRef = useRef<GroupImperativeHandle>(null);
  const {
    artifacts,
    open: artifactsOpen,
    setOpen: setArtifactsOpen,
    setArtifacts,
    select: selectArtifact,
    deselect,
    selectedArtifact,
  } = useArtifacts();
  const threadArtifacts = useMemo(
    () => thread.values.artifacts ?? [],
    [thread.values.artifacts],
  );
  const artifactsRef = useRef<string[]>(artifacts);

  const [autoSelectFirstArtifact, setAutoSelectFirstArtifact] = useState(true);
  const supportsWorkspaceView = env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true";
  const artifactPanelOpen = artifactsOpen;
  const { isDesktopRuntime } = useDesktopRuntime();

  const {
    data: workspaceTree,
    isLoading: workspaceTreeLoading,
    isFetching: workspaceTreeFetching,
    error: workspaceTreeError,
  } = useWorkspaceTree(threadId, {
    enabled: artifactPanelOpen && supportsWorkspaceView,
    root: "/mnt/user-data/workspace",
    depth: 6,
    includeHidden: false,
    maxNodes: 5000,
    live: artifactPanelOpen && supportsWorkspaceView && !isDesktopRuntime,
    refetchIntervalMs: 1000,
  });

  useWorkspaceLiveSync(threadId, {
    enabled: artifactPanelOpen && supportsWorkspaceView && isDesktopRuntime,
    root: "/mnt/user-data/workspace",
  });

  useEffect(() => {
    artifactsRef.current = artifacts;
  }, [artifacts]);

  useEffect(() => {
    const mergedArtifacts = [...threadArtifacts];
    for (const path of artifactsRef.current) {
      if (!mergedArtifacts.includes(path)) {
        mergedArtifacts.push(path);
      }
    }
    setArtifacts(mergedArtifacts);
    const hasNoArtifacts = mergedArtifacts.length === 0;
    const selectedMissing =
      selectedArtifact !== null && !mergedArtifacts.includes(selectedArtifact);
    if (hasNoArtifacts || selectedMissing) {
      deselect();
    }
    if (
      env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" &&
      autoSelectFirstArtifact &&
      threadArtifacts.length > 0
    ) {
      setAutoSelectFirstArtifact(false);
      selectArtifact(threadArtifacts[0]!);
    }
  }, [
    autoSelectFirstArtifact,
    deselect,
    selectArtifact,
    selectedArtifact,
    setArtifacts,
    threadArtifacts,
  ]);

  useEffect(() => {
    if (layoutRef.current) {
      layoutRef.current.setLayout(artifactPanelOpen ? OPEN_MODE : CLOSE_MODE);
    }
  }, [artifactPanelOpen]);

  const workspaceFiles = useMemo(
    () => workspaceTree?.files.map((entry) => entry.path) ?? [],
    [workspaceTree?.files],
  );
  const workspaceDirectories = useMemo(
    () => workspaceTree?.directories.map((entry) => entry.path) ?? [],
    [workspaceTree?.directories],
  );
  const panelFiles = supportsWorkspaceView ? workspaceFiles : artifacts;
  const panelDirectories = supportsWorkspaceView ? workspaceDirectories : [];

  useEffect(() => {
    if (!selectedArtifact) {
      return;
    }
    if (supportsWorkspaceView) {
      if (!workspaceTree) {
        return;
      }
      const existingPaths = new Set([...workspaceFiles, ...workspaceDirectories]);
      if (!existingPaths.has(selectedArtifact)) {
        deselect();
      }
      return;
    }
    if (!artifacts.includes(selectedArtifact)) {
      deselect();
    }
  }, [
    artifacts,
    deselect,
    selectedArtifact,
    supportsWorkspaceView,
    workspaceDirectories,
    workspaceFiles,
    workspaceTree,
  ]);

  return (
    <ResizablePanelGroup
      id="workspace-chat-panel-group"
      orientation="horizontal"
      defaultLayout={{ chat: 100, artifacts: 0 }}
      groupRef={layoutRef}
    >
      <ResizablePanel className="relative" defaultSize={100} id="chat">
        {children}
      </ResizablePanel>
      <ResizableHandle
        id="workspace-chat-panel-handle"
        className={cn(
          "opacity-33 hover:opacity-100",
          !artifactPanelOpen && "pointer-events-none opacity-0",
        )}
      />
      <ResizablePanel
        className={cn(
          "transition-all duration-300 ease-in-out",
          !artifactsOpen && "opacity-0",
        )}
        id="artifacts"
      >
        <div
          className={cn(
            "h-full p-4 transition-transform duration-300 ease-in-out",
            artifactPanelOpen ? "translate-x-0" : "translate-x-full",
          )}
        >
          {selectedArtifact ? (
            <ArtifactFileDetail
              className="size-full"
              filepath={selectedArtifact}
              threadId={threadId}
            />
          ) : (
            <div className="flex size-full min-w-0 flex-col rounded-lg border">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <FolderIcon className="text-muted-foreground size-4 shrink-0" />
                  <span className="truncate">{t.common.workingDirectory}</span>
                  {supportsWorkspaceView && workspaceTreeFetching ? (
                    <span className="bg-emerald-500/75 size-1.5 shrink-0 rounded-full" />
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {panelFiles.length}
                    {t.common.filesSuffix}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => {
                      setArtifactsOpen(false);
                    }}
                  >
                    <XIcon className="size-4" />
                  </Button>
                </div>
              </div>
              {supportsWorkspaceView && workspaceTreeLoading && !workspaceTree ? (
                <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                  {t.common.loading}
                </div>
              ) : supportsWorkspaceView && workspaceTreeError ? (
                <div className="text-muted-foreground m-2 rounded-md border border-dashed p-3 text-xs">
                  {workspaceTreeError.message}
                </div>
              ) : (
                <ArtifactDirectoryTree
                  files={panelFiles}
                  directories={panelDirectories}
                  selectedPath={selectedArtifact}
                  onOpenFile={(path) => {
                    if (!artifacts.includes(path)) {
                      setArtifacts([...artifacts, path]);
                    }
                    selectArtifact(path);
                    setArtifactsOpen(true);
                  }}
                />
              )}
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};

export { ChatBox };
