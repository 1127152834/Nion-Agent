import { Code2Icon, FileTextIcon, FolderIcon, Loader2Icon, XIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
type WorkingDirectoryMode = "directory" | "preview";
type WorkbenchTargetKind = "file" | "directory" | "project";

type WorkbenchPickerState = {
  artifactPath: string;
  targetKind: "file" | "directory";
  candidates: Array<{
    id: string;
    name: string;
  }>;
};

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
    panelType,
    setPanelType,
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
  const [workingDirectoryMode, setWorkingDirectoryMode] = useState<WorkingDirectoryMode>("directory");
  const [pluginSlotState, setPluginSlotState] = useState<{
    pluginId: string;
    artifactPath: string;
    targetKind: WorkbenchTargetKind;
  }>({
    pluginId: FRONTEND_WORKBENCH_PLUGIN_ID,
    artifactPath: DEFAULT_WORKBENCH_PATH,
    targetKind: "directory",
  });
  const [manualPluginSelection, setManualPluginSelection] = useState<{
    pluginId: string;
    artifactPath: string;
    targetKind: WorkbenchTargetKind;
  } | null>(null);
  const [workbenchPickerState, setWorkbenchPickerState] = useState<WorkbenchPickerState | null>(
    null,
  );
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
    enabled: artifactPanelOpen && supportsWorkspaceView && panelType === "working-directory",
    root: "/mnt/user-data/workspace",
    depth: 6,
    includeHidden: false,
    maxNodes: 5000,
    live: artifactPanelOpen && supportsWorkspaceView && panelType === "working-directory" && !isDesktopRuntime,
    refetchIntervalMs: 1000,
  });

  useWorkspaceLiveSync(threadId, {
    enabled: artifactPanelOpen && supportsWorkspaceView && panelType === "working-directory" && isDesktopRuntime,
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

  const directoryRootFileMap = useMemo(() => {
    const map = new Map<string, string[]>();

    const ensureDirectory = (path: string) => {
      if (!map.has(path)) {
        map.set(path, []);
      }
    };
    ensureDirectory(DEFAULT_WORKBENCH_PATH);
    for (const directoryPath of workspaceDirectories) {
      ensureDirectory(directoryPath);
    }
    for (const filePath of workspaceFiles) {
      const normalizedPath = filePath.replace(/\\/g, "/");
      const slashIndex = normalizedPath.lastIndexOf("/");
      if (slashIndex < 0) {
        continue;
      }
      const parentPath = normalizedPath.slice(0, slashIndex) || DEFAULT_WORKBENCH_PATH;
      const fileName = normalizedPath.slice(slashIndex + 1).trim();
      if (!fileName) {
        continue;
      }
      const rootFiles = map.get(parentPath) ?? [];
      if (!rootFiles.includes(fileName)) {
        rootFiles.push(fileName);
      }
      map.set(parentPath, rootFiles);
    }
    return map;
  }, [workspaceDirectories, workspaceFiles]);

  const buildArtifactForTarget = useCallback((path: string, kind: WorkbenchTargetKind) => {
    const metadata: Record<string, unknown> = {};
    if (kind === "directory" || kind === "project") {
      const rootFiles = directoryRootFileMap.get(path);
      if (rootFiles) {
        metadata.directoryRootFiles = rootFiles;
      }
    }
    return {
      path,
      kind,
      metadata,
    };
  }, [directoryRootFileMap]);

  const resolvePluginMatchesForTarget = useCallback(
    (path: string, kind: WorkbenchTargetKind) => {
      const registry = getWorkbenchRegistry();
      return registry.findAllMatches(buildArtifactForTarget(path, kind));
    },
    [buildArtifactForTarget],
  );

  const resolvePluginIdForTarget = useCallback(
    (
      path: string,
      kind: WorkbenchTargetKind,
      opts?: {
        strict?: boolean;
      },
    ) => {
      const plugin = resolvePluginMatchesForTarget(path, kind)[0];
      if (plugin) {
        return plugin.id;
      }
      return opts?.strict ? null : FRONTEND_WORKBENCH_PLUGIN_ID;
    },
    [resolvePluginMatchesForTarget],
  );

  const openPluginSlot = useCallback(({
    pluginId,
    artifactPath,
    targetKind,
    lockSelection,
  }: {
    pluginId?: string;
    artifactPath: string;
    targetKind: WorkbenchTargetKind;
    lockSelection?: boolean;
  }) => {
    const nextPluginId = pluginId ?? resolvePluginIdForTarget(artifactPath, targetKind);
    if (!nextPluginId) {
      return;
    }
    setPluginSlotState({
      pluginId: nextPluginId,
      artifactPath,
      targetKind,
    });
    if (lockSelection) {
      setManualPluginSelection({
        pluginId: nextPluginId,
        artifactPath,
        targetKind,
      });
    } else {
      setManualPluginSelection(null);
    }
    setPanelType("workbench");
    setArtifactsOpen(true);
  }, [resolvePluginIdForTarget, setArtifactsOpen, setPanelType]);

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
    if (panelType !== "working-directory") {
      return;
    }
    if (selectedArtifact) {
      setWorkingDirectoryMode("preview");
      return;
    }
    setWorkingDirectoryMode("directory");
  }, [panelType, selectedArtifact]);

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
      lockSelection: true,
    });
    if (slotRouteState.targetKind === "file") {
      if (!artifacts.includes(slotRouteState.artifactPath)) {
        setArtifacts([...artifacts, slotRouteState.artifactPath]);
      }
      selectArtifact(slotRouteState.artifactPath);
      setPanelType("workbench");
    } else {
      deselect();
    }
  }, [artifacts, deselect, openPluginSlot, selectArtifact, setArtifacts, setPanelType, slotRouteState]);

  useEffect(() => {
    if (panelType !== "workbench" || slotRouteState) {
      return;
    }
    const artifactPath = selectedArtifact ?? DEFAULT_WORKBENCH_PATH;
    const targetKind: WorkbenchTargetKind = selectedArtifact ? "file" : "directory";
    if (manualPluginSelection) {
      if (
        manualPluginSelection.artifactPath === artifactPath
        && manualPluginSelection.targetKind === targetKind
      ) {
        return;
      }
      setManualPluginSelection(null);
    }
    const pluginId = resolvePluginIdForTarget(artifactPath, targetKind);
    if (!pluginId) {
      return;
    }
    const slotUnchanged = pluginSlotState.pluginId === pluginId
      && pluginSlotState.artifactPath === artifactPath
      && pluginSlotState.targetKind === targetKind;
    if (slotUnchanged) {
      return;
    }
    setPluginSlotState({
      pluginId,
      artifactPath,
      targetKind,
    });
  }, [
    manualPluginSelection,
    panelType,
    pluginSlotState,
    resolvePluginIdForTarget,
    selectedArtifact,
    slotRouteState,
  ]);

  const openWorkbenchForTarget = useCallback(
    ({
      pluginId,
      artifactPath,
      targetKind,
    }: {
      pluginId: string;
      artifactPath: string;
      targetKind: "file" | "directory";
    }) => {
      if (targetKind === "file") {
        if (!artifacts.includes(artifactPath)) {
          setArtifacts([...artifacts, artifactPath]);
        }
        selectArtifact(artifactPath);
      } else {
        deselect();
      }

      openPluginSlot({
        pluginId,
        artifactPath,
        targetKind,
        lockSelection: true,
      });
    },
    [artifacts, deselect, openPluginSlot, selectArtifact, setArtifacts],
  );

  const canOpenWithWorkbench = useCallback(
    (path: string, targetKind: "file" | "directory") => {
      return resolvePluginIdForTarget(path, targetKind, { strict: true }) !== null;
    },
    [resolvePluginIdForTarget],
  );

  const handleOpenWithWorkbench = useCallback(
    (path: string, targetKind: "file" | "directory") => {
      const matches = resolvePluginMatchesForTarget(path, targetKind);
      if (matches.length === 0) {
        return;
      }
      if (matches.length === 1) {
        openWorkbenchForTarget({
          pluginId: matches[0]!.id,
          artifactPath: path,
          targetKind,
        });
        return;
      }

      const registry = getWorkbenchRegistry();
      const candidates = matches.map((plugin) => {
        const installed = registry.getInstalled(plugin.id);
        return {
          id: plugin.id,
          name: installed?.manifest.name ?? plugin.name ?? plugin.id,
        };
      });
      setWorkbenchPickerState({
        artifactPath: path,
        targetKind,
        candidates,
      });
    },
    [openWorkbenchForTarget, resolvePluginMatchesForTarget],
  );

  return (
    <>
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
                {panelType === "workbench" ? (
                  <Code2Icon className="text-muted-foreground size-4 shrink-0" />
                ) : (
                  <FolderIcon className="text-muted-foreground size-4 shrink-0" />
                )}
                <span className="truncate">
                  {panelType === "workbench"
                    ? copy.plugin
                    : workingDirectoryMode === "preview"
                      ? copy.filePreview
                      : t.common.workingDirectory}
                </span>
                {panelType === "working-directory" && workingDirectoryMode === "directory" && supportsWorkspaceView && workspaceTreeFetching ? (
                  <span className="bg-emerald-500/75 size-1.5 shrink-0 rounded-full" />
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {panelType === "working-directory" ? (
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

            {panelType === "working-directory" ? (
              <div className="border-b px-2 py-2">
                <div className="inline-flex items-center gap-1 rounded-md border p-0.5">
                  <Button
                    size="sm"
                    className="h-7 px-2 text-xs"
                    variant={workingDirectoryMode === "directory" ? "secondary" : "ghost"}
                    onClick={() => setWorkingDirectoryMode("directory")}
                  >
                    <FolderIcon className="size-3.5" />
                    {copy.tabDirectory}
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 px-2 text-xs"
                    variant={workingDirectoryMode === "preview" ? "secondary" : "ghost"}
                    onClick={() => setWorkingDirectoryMode("preview")}
                    disabled={!selectedArtifact}
                  >
                    <FileTextIcon className="size-3.5" />
                    {copy.tabPreview}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="min-h-0 grow">
              {panelType === "workbench" ? (
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
              ) : workingDirectoryMode === "preview" ? (
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
                  canOpenWithWorkbench={canOpenWithWorkbench}
                  onOpenWithWorkbench={handleOpenWithWorkbench}
                  onOpenFile={(path) => {
                    if (!artifacts.includes(path)) {
                      setArtifacts([...artifacts, path]);
                    }
                    selectArtifact(path);
                    setWorkingDirectoryMode("preview");
                    setPanelType("working-directory");
                    setArtifactsOpen(true);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>

      <Dialog
        open={Boolean(workbenchPickerState)}
        onOpenChange={(open) => {
          if (!open) {
            setWorkbenchPickerState(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.chooseWorkbenchTitle}</DialogTitle>
            <DialogDescription>{copy.chooseWorkbenchDescription}</DialogDescription>
          </DialogHeader>

          <div className="max-h-[40vh] space-y-2 overflow-y-auto py-1">
            {workbenchPickerState?.candidates.map((candidate) => (
              <button
                key={candidate.id}
                className="hover:bg-accent hover:text-accent-foreground w-full rounded-md border px-3 py-2 text-left"
                type="button"
                onClick={() => {
                  if (!workbenchPickerState) {
                    return;
                  }
                  openWorkbenchForTarget({
                    pluginId: candidate.id,
                    artifactPath: workbenchPickerState.artifactPath,
                    targetKind: workbenchPickerState.targetKind,
                  });
                  setWorkbenchPickerState(null);
                }}
              >
                <div className="text-sm font-medium">{candidate.name}</div>
                <div className="text-muted-foreground mt-0.5 text-xs">{candidate.id}</div>
              </button>
            ))}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setWorkbenchPickerState(null);
              }}
            >
              {t.common.cancel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export { ChatBox };
