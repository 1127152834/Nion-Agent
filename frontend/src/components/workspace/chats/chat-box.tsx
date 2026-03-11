import { Code2Icon, FileTextIcon, FolderIcon, Loader2Icon, XIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
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
import {
  getWorkbenchRegistry,
  parseWorkbenchSlotRouteState,
  useInstalledPluginPackage,
} from "@/core/workbench";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import {
  ArtifactDirectoryTree,
  ArtifactFileDetail,
  WorkbenchSlotShell,
  useArtifacts,
} from "../artifacts";
import { WorkbenchContainer } from "../artifacts/workbench-container";
import { useThread } from "../messages/context";

const CLOSE_MODE = { chat: 100, artifacts: 0 };
const OPEN_MODE = { chat: 60, artifacts: 40 };
const FRONTEND_WORKBENCH_PLUGIN_ID = "frontend-workbench";
const DEFAULT_WORKBENCH_PATH = "/mnt/user-data/workspace";
type ArtifactPanelMode = "directory" | "preview" | "plugin";

const ChatBox: React.FC<{ children: React.ReactNode; threadId: string }> = ({
  children,
  threadId,
}) => {
  const { t } = useI18n();
  const copy = t.workspace.artifactPanel;
  const searchParams = useSearchParams();
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
  const [artifactPanelMode, setArtifactPanelMode] = useState<ArtifactPanelMode>("directory");
  const [pluginSlotState, setPluginSlotState] = useState<{
    pluginId: string;
    artifactPath: string;
    targetKind: "file" | "directory" | "project";
  }>({
    pluginId: FRONTEND_WORKBENCH_PLUGIN_ID,
    artifactPath: DEFAULT_WORKBENCH_PATH,
    targetKind: "directory",
  });
  const appliedSlotRouteKeyRef = useRef<string | null>(null);
  const supportsWorkspaceView = env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true";
  const artifactPanelOpen = artifactsOpen;
  const { isDesktopRuntime } = useDesktopRuntime();
  const slotRouteState = useMemo(
    () => parseWorkbenchSlotRouteState(searchParams),
    [searchParams],
  );
  const {
    data: activePluginPackage,
    isLoading: activePluginLoading,
    refetch: refetchActivePlugin,
  } = useInstalledPluginPackage(pluginSlotState.pluginId);

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
  const activePluginEnabled = Boolean(activePluginPackage?.metadata?.enabled);
  const activePluginSupportsSidebarSlot = activePluginPackage?.metadata?.manifest.ui?.surface
    ? activePluginPackage.metadata.manifest.ui.surface === "sidebar-slot"
    : true;
  const activePluginName = activePluginPackage?.metadata?.manifest.name ?? pluginSlotState.pluginId;

  const resolvePluginIdForTarget = (path: string, kind: "file" | "directory" | "project") => {
    const registry = getWorkbenchRegistry();
    const plugin = registry.findBestMatch({
      path,
      kind,
      metadata: {},
    });
    return plugin?.id ?? FRONTEND_WORKBENCH_PLUGIN_ID;
  };

  const openPluginSlot = ({
    pluginId,
    artifactPath,
    targetKind,
  }: {
    pluginId?: string;
    artifactPath: string;
    targetKind: "file" | "directory" | "project";
  }) => {
    setPluginSlotState({
      pluginId: pluginId ?? resolvePluginIdForTarget(artifactPath, targetKind),
      artifactPath,
      targetKind,
    });
    setArtifactPanelMode("plugin");
    setArtifactsOpen(true);
  };

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

  useEffect(() => {
    if (artifactPanelMode === "plugin") {
      return;
    }
    if (selectedArtifact) {
      setArtifactPanelMode("preview");
      return;
    }
    setArtifactPanelMode("directory");
  }, [artifactPanelMode, selectedArtifact]);

  useEffect(() => {
    if (!slotRouteState) {
      return;
    }
    const routeKey = `${slotRouteState.pluginId}:${slotRouteState.artifactPath}:${slotRouteState.targetKind}:${slotRouteState.nonce ?? ""}`;
    if (appliedSlotRouteKeyRef.current === routeKey) {
      return;
    }
    appliedSlotRouteKeyRef.current = routeKey;

    openPluginSlot({
      pluginId: slotRouteState.pluginId,
      artifactPath: slotRouteState.artifactPath,
      targetKind: slotRouteState.targetKind,
    });
    if (slotRouteState.targetKind === "file") {
      if (!artifacts.includes(slotRouteState.artifactPath)) {
        setArtifacts([...artifacts, slotRouteState.artifactPath]);
      }
      selectArtifact(slotRouteState.artifactPath);
    } else {
      deselect();
    }
  }, [artifacts, deselect, selectArtifact, setArtifacts, slotRouteState]);

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
          <div className="flex size-full min-w-0 flex-col rounded-lg border">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <FolderIcon className="text-muted-foreground size-4 shrink-0" />
                <span className="truncate">
                  {artifactPanelMode === "plugin"
                    ? copy.plugin
                    : artifactPanelMode === "preview"
                      ? copy.filePreview
                      : t.common.workingDirectory}
                </span>
                {artifactPanelMode === "directory" && supportsWorkspaceView && workspaceTreeFetching ? (
                  <span className="bg-emerald-500/75 size-1.5 shrink-0 rounded-full" />
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {artifactPanelMode !== "plugin" ? (
                  <span className="text-muted-foreground">
                    {panelFiles.length}
                    {t.common.filesSuffix}
                  </span>
                ) : null}
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

            <div className="border-b px-2 py-2">
              <div className="inline-flex items-center gap-1 rounded-md border p-0.5">
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  variant={artifactPanelMode === "directory" ? "secondary" : "ghost"}
                  onClick={() => setArtifactPanelMode("directory")}
                >
                  <FolderIcon className="size-3.5" />
                  {copy.tabDirectory}
                </Button>
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  variant={artifactPanelMode === "preview" ? "secondary" : "ghost"}
                  onClick={() => setArtifactPanelMode("preview")}
                  disabled={!selectedArtifact}
                >
                  <FileTextIcon className="size-3.5" />
                  {copy.tabPreview}
                </Button>
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  variant={artifactPanelMode === "plugin" ? "secondary" : "ghost"}
                  onClick={() => {
                    const artifactPath = selectedArtifact ?? DEFAULT_WORKBENCH_PATH;
                    const targetKind = selectedArtifact ? "file" : "directory";
                    openPluginSlot({
                      artifactPath,
                      targetKind,
                    });
                  }}
                >
                  <Code2Icon className="size-3.5" />
                  {copy.tabPlugin}
                </Button>
              </div>
            </div>

            <div className="min-h-0 grow">
              {artifactPanelMode === "plugin" ? (
                <WorkbenchSlotShell
                  title={activePluginName}
                  subtitle={`${copy.targetPrefix}: ${pluginSlotState.artifactPath}`}
                >
                  {activePluginEnabled && activePluginSupportsSidebarSlot ? (
                    <WorkbenchContainer
                      filepath={pluginSlotState.artifactPath}
                      threadId={threadId}
                      targetKind={pluginSlotState.targetKind}
                      pluginId={pluginSlotState.pluginId}
                    >
                      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                        {copy.pluginLoading}
                      </div>
                    </WorkbenchContainer>
                  ) : (
                    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-6 text-sm">
                      {activePluginLoading ? (
                        <div className="flex items-center gap-2">
                          <Loader2Icon className="size-4 animate-spin" />
                          {copy.pluginResolving}
                        </div>
                      ) : (
                        <>
                          <div>
                            {activePluginSupportsSidebarSlot
                              ? copy.pluginMissingOrDisabled
                              : copy.pluginUnsupportedSurface}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void refetchActivePlugin();
                            }}
                          >
                            {copy.retryLoad}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </WorkbenchSlotShell>
              ) : artifactPanelMode === "preview" ? (
                selectedArtifact ? (
                  <ArtifactFileDetail
                    className="size-full"
                    filepath={selectedArtifact}
                    threadId={threadId}
                    disableWorkbench
                  />
                ) : (
                  <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                    {copy.selectFileHint}
                  </div>
                )
              ) : supportsWorkspaceView && workspaceTreeLoading && !workspaceTree ? (
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
                    setArtifactPanelMode("preview");
                    setArtifactsOpen(true);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};

export { ChatBox };
