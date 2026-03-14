"use client";

import JSZip from "jszip";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  EyeIcon,
  FileIcon,
  FolderIcon,
  Loader2Icon,
  Maximize2Icon,
  PlusIcon,
  RefreshCwIcon,
  RocketIcon,
  SlidersHorizontalIcon,
  UploadIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { WorkbenchPluginIframe } from "@/components/workspace/artifacts/workbench-plugin-iframe";
import { InputBox } from "@/components/workspace/input-box";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import { getAPIClient } from "@/core/api";
import type { A2UIUserAction } from "@/core/a2ui/types";
import { useI18n } from "@/core/i18n/hooks";
import { findLastRetryableUserMessage } from "@/core/messages/retry";
import { useAppRouter as useRouter } from "@/core/navigation";
import { useLocalSettings } from "@/core/settings";
import type { AgentThreadContext } from "@/core/threads";
import { isThreadNotFoundError, useThreadStream } from "@/core/threads/hooks";
import { pathOfChatsIndex, textOfMessage } from "@/core/threads/utils";
import { isUUID, uuid } from "@/core/utils/uuid";
import {
  compareSemver,
  createPluginStudioSession,
  createWorkbenchContext,
  downloadPluginStudioPackage,
  ensurePluginTestThreadId,
  getInstalledPluginMetadataById,
  getPluginStudioSourcePackage,
  getPluginStudioSession,
  importPluginStudioTestMaterials,
  incrementPatch,
  isSemver,
  listPluginStudioTestMaterials,
  pullPluginStudioWorkspace,
  publishPluginStudioSession,
  seedPluginStudioWorkspace,
  updateInstalledPluginMetadata,
  updatePluginStudioSessionDraft,
  useInstallPlugin,
  useInstalledPluginPackage,
  type InstalledPlugin,
  type PluginStudioMatchRules,
  type PluginStudioSession,
  type PluginStudioSourcePackage,
  type PluginStudioWorkflowState,
} from "@/core/workbench";

import {
  computeWorkflowProgress,
  createDefaultRuleForm,
  createDefaultMatchRules,
  createDefaultWorkflowState,
  deriveFileMatchMode,
  isRuleFormReadyForUpload,
  mapMatchRulesToRuleForm,
  mapRuleFormToMatchRules,
  normalizeMaterialEntryPath,
  normalizeMatchRules,
  normalizeRuleForm,
  normalizeWorkflowState,
  type PluginAssistantRuleForm,
} from "./workflow";

const LAST_SESSION_STORAGE_KEY = "nion.workbench.plugin-assistant.last-session-id";
const LAST_THREAD_STORAGE_KEY = "nion.workbench.plugin-assistant.last-thread-id";
const SPLIT_LAYOUT_STORAGE_KEY = "nion.workbench.plugin-assistant.layout";
const RIGHT_PANE_MODE_STORAGE_KEY = "nion.workbench.plugin-assistant.right-pane-mode";
const DEFAULT_PLUGIN_NAME = "Plugin Assistant Draft";
const DEFAULT_SPLIT_LAYOUT: [number, number] = [40, 60];
const PRESET_FILE_TYPES = ["tsx", "jsx", "ts", "js", "vue", "css", "scss", "html", "json", "md"] as const;
const PRESET_FILE_TYPE_SET = new Set(PRESET_FILE_TYPES);

type AssistantInputContext = Omit<
  AgentThreadContext,
  "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
> & {
  mode: "flash" | "thinking" | "pro" | "ultra" | undefined;
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
};

function buildAssistantThreadId() {
  return uuid();
}

function triggerBrowserDownload(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function parseListValue(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeFileTypeToken(value: string): string {
  const normalized = value.trim().replace(/^\./, "").toLowerCase();
  if (!normalized) {
    return "";
  }
  // Workbench matching uses the last extension segment.
  const parts = normalized.split(".").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) {
    return "/mnt/user-data/workspace";
  }
  return normalized.slice(0, index);
}

function normalizeMaterialPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("/mnt/user-data/workspace")) {
    return normalized;
  }
  const markerIndex = normalized.includes("/test-materials/")
    ? normalized.indexOf("/test-materials/")
    : normalized.indexOf("test-materials/");
  if (markerIndex >= 0) {
    const markerLength = normalized.startsWith("/test-materials/", markerIndex)
      ? "/test-materials/".length
      : "test-materials/".length;
    const tail = normalized.slice(markerIndex + markerLength).replace(/^\/+/, "");
    return tail ? `/mnt/user-data/workspace/${tail}` : "/mnt/user-data/workspace";
  }
  const safeTail = normalized.replace(/^\/+/, "");
  return safeTail ? `/mnt/user-data/workspace/${safeTail}` : "/mnt/user-data/workspace";
}

interface MaterialTreeNode {
  path: string;
  name: string;
  kind: "directory" | "file";
  children: MaterialTreeNode[];
  isMaterial: boolean;
}

function buildMaterialTree(
  materials: Array<{ path: string; kind: "directory" | "file" }>,
): MaterialTreeNode[] {
  const nodes = new Map<string, MaterialTreeNode>();
  const roots: MaterialTreeNode[] = [];

  const ensureNode = (path: string, name: string, kind: "directory" | "file", isMaterial: boolean) => {
    const existing = nodes.get(path);
    if (existing) {
      if (isMaterial) {
        existing.isMaterial = true;
      }
      if (kind === "file") {
        existing.kind = "file";
      }
      return existing;
    }
    const node: MaterialTreeNode = {
      path,
      name,
      kind,
      children: [],
      isMaterial,
    };
    nodes.set(path, node);
    return node;
  };

  const normalizedMaterials = [...materials]
    .map((item) => ({
      kind: item.kind,
      path: normalizeMaterialPath(item.path),
    }))
    .filter((item) => item.path.startsWith("/mnt/user-data/workspace"));

  for (const item of normalizedMaterials) {
    const fullRelative = item.path.replace(/^\/mnt\/user-data\/workspace\/?/, "");
    if (!fullRelative) {
      continue;
    }
    const fullSegments = fullRelative.split("/").filter(Boolean);
    if (fullSegments.length === 0) {
      continue;
    }
    const displaySegments = fullSegments[0] === "fixtures" ? fullSegments.slice(1) : fullSegments.slice();
    if (displaySegments.length === 0) {
      continue;
    }
    const hiddenPrefixCount = fullSegments.length - displaySegments.length;

    let parent: MaterialTreeNode | null = null;
    for (let index = 0; index < displaySegments.length; index += 1) {
      const isLeaf = index === displaySegments.length - 1;
      const nodeKind: "directory" | "file" = isLeaf && item.kind === "file" ? "file" : "directory";
      const fullPrefix = fullSegments.slice(0, hiddenPrefixCount + index + 1);
      const nodePath = `/mnt/user-data/workspace/${fullPrefix.join("/")}`;
      const nodeName = displaySegments[index] ?? "workspace";
      const node = ensureNode(nodePath, nodeName, nodeKind, isLeaf);
      if (parent) {
        if (!parent.children.some((child) => child.path === node.path)) {
          parent.children.push(node);
        }
      } else if (!roots.some((root) => root.path === node.path)) {
        roots.push(node);
      }
      parent = node;
    }
  }

  const sortNodes = (items: MaterialTreeNode[]) => {
    items.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
    for (const node of items) {
      if (node.children.length > 0) {
        sortNodes(node.children);
      }
    }
  };
  sortNodes(roots);
  return roots;
}

function findFirstFilePath(node: MaterialTreeNode): string | null {
  if (node.kind === "file") {
    return node.path;
  }
  for (const child of node.children) {
    const resolved = findFirstFilePath(child);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function normalizeLayout(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    return fallback;
  }
  const first = Number(value[0]);
  const second = Number(value[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second) || first <= 0 || second <= 0) {
    return fallback;
  }
  return [first, second];
}

function createPreviewInstalledPlugin(
  pkg: PluginStudioSourcePackage,
  session: PluginStudioSession | null,
): InstalledPlugin {
  return {
    manifest: pkg.manifest,
    version: pkg.manifest.version,
    path: "/mnt/user-data/workspace/plugin-src",
    enabled: true,
    installedAt: session?.updatedAt ?? new Date().toISOString(),
    verified: false,
    lastTestReport: null,
    pluginStudioSessionId: session?.sessionId,
    releaseNotes: session?.releaseNotes,
    publishedAt: session?.publishedAt,
  };
}

export default function PluginAssistantPage() {
  const searchParams = useSearchParams();
  const searchSessionId = searchParams.get("session_id")?.trim() ?? "";
  const searchFrom = searchParams.get("from")?.trim() ?? "";
  const isDebugEntry = searchFrom === "debug";

  const { t } = useI18n();
  const copy = t.workspace.pluginAssistant;
  const router = useRouter();
  const [settings] = useLocalSettings();
  const [assistantContext, setAssistantContext] = useState<AssistantInputContext>({
    ...settings.context,
    mode: settings.context.mode ?? "pro",
  });

  const [session, setSession] = useState<PluginStudioSession | null>(null);
  const [threadId, setThreadId] = useState<string>("");
  const [threadExists, setThreadExists] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [flowError, setFlowError] = useState<string | null>(null);
  const sessionRef = useRef<PluginStudioSession | null>(null);

  const [downloadAfterPublish, setDownloadAfterPublish] = useState(true);
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [installedVersion, setInstalledVersion] = useState("0.1.0");

  const [previewNonce, setPreviewNonce] = useState(0);
  const [previewThreadId, setPreviewThreadId] = useState("");
  const [previewThreadError, setPreviewThreadError] = useState<string | null>(null);
  const [draftSourcePackage, setDraftSourcePackage] = useState<PluginStudioSourcePackage | null>(null);
  const [draftSourceLoading, setDraftSourceLoading] = useState(false);
  const [draftSourceError, setDraftSourceError] = useState<string | null>(null);
  const [workspaceSeeded, setWorkspaceSeeded] = useState(false);
  const workspaceSeedKeyRef = useRef("");
  const previewHostRef = useRef<HTMLDivElement | null>(null);

  const [splitLayout, setSplitLayout] = useState<[number, number]>(DEFAULT_SPLIT_LAYOUT);
  const [rightPaneMode, setRightPaneMode] = useState<"preview" | "config">("preview");

  const [draftDescription, setDraftDescription] = useState("");
  const [draftVersion, setDraftVersion] = useState("0.1.1");
  const [draftReleaseNotes, setDraftReleaseNotes] = useState("");
  const [matchRules, setMatchRules] = useState<PluginStudioMatchRules>(createDefaultMatchRules());
  const [ruleForm, setRuleForm] = useState<PluginAssistantRuleForm>(createDefaultRuleForm());
  const [customFileTypesInput, setCustomFileTypesInput] = useState("");
  const [workflowState, setWorkflowState] = useState<PluginStudioWorkflowState>(createDefaultWorkflowState());
  const [selectedMaterialPath, setSelectedMaterialPath] = useState("");
  const [expandedMaterialPaths, setExpandedMaterialPaths] = useState<Record<string, boolean>>({});
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [materialUploading, setMaterialUploading] = useState(false);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const installPluginMutation = useInstallPlugin();

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const rawSplit = window.localStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY);
    if (rawSplit) {
      try {
        setSplitLayout(normalizeLayout(JSON.parse(rawSplit) as unknown, DEFAULT_SPLIT_LAYOUT));
      } catch {
        setSplitLayout(DEFAULT_SPLIT_LAYOUT);
      }
    }
    const rawPaneMode = window.localStorage.getItem(RIGHT_PANE_MODE_STORAGE_KEY);
    if (rawPaneMode === "preview" || rawPaneMode === "config") {
      setRightPaneMode(rawPaneMode);
    }
  }, []);

  const persistLastSessionId = useCallback((sessionId: string) => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(LAST_SESSION_STORAGE_KEY, sessionId);
  }, []);

  const resolveLastSessionId = useCallback(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem(LAST_SESSION_STORAGE_KEY);
  }, []);

  const persistLastThreadId = useCallback((value: string) => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(LAST_THREAD_STORAGE_KEY, value);
  }, []);

  const resolveLastThreadId = useCallback(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem(LAST_THREAD_STORAGE_KEY);
  }, []);

  const persistSplitLayout = useCallback((layout: [number, number]) => {
    setSplitLayout(layout);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    }
  }, []);

  const persistRightPaneMode = useCallback((mode: "preview" | "config") => {
    setRightPaneMode(mode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RIGHT_PANE_MODE_STORAGE_KEY, mode);
    }
  }, []);

  const ensurePluginAssistantThreadState = useCallback(
    async (targetThreadId: string, targetSessionId: string) => {
      try {
        await getAPIClient().threads.updateState(targetThreadId, {
          values: {
            workspace_mode: "plugin_assistant",
            thread_visibility: "hidden",
            plugin_studio_session_id: targetSessionId,
          },
        });
      } catch (error) {
        if (!isThreadNotFoundError(error)) {
          console.warn("Failed to mark plugin assistant thread visibility:", error);
        }
      }
    },
    [],
  );

  const checkThreadExists = useCallback(async (candidateThreadId: string) => {
    try {
      await getAPIClient().threads.get(candidateThreadId);
      return true;
    } catch (error) {
      if (isThreadNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }, []);

  const hydrateDraftFromSession = useCallback((nextSession: PluginStudioSession) => {
    setDraftDescription(nextSession.description ?? "");
    setDraftVersion(nextSession.draftVersion ?? incrementPatch(nextSession.currentVersion));
    setDraftReleaseNotes(nextSession.releaseNotes ?? "");
    const normalizedRules = normalizeMatchRules(nextSession.matchRules);
    setMatchRules(normalizedRules);
    const mappedForm = mapMatchRulesToRuleForm(normalizedRules);
    const normalizedForm = normalizeRuleForm(mappedForm);
    setRuleForm(normalizedForm);
    setCustomFileTypesInput("");
    setWorkflowState(normalizeWorkflowState(nextSession.workflowState));
    setSelectedMaterialPath(normalizeMaterialPath(nextSession.selectedTestMaterialPath ?? ""));
  }, []);

  const createBoundSession = useCallback(
    async (nextPluginName: string, nextDescription: string) => {
      const desiredThreadId = buildAssistantThreadId();
      const created = await createPluginStudioSession({
        pluginName: nextPluginName,
        description: nextDescription,
        chatThreadId: desiredThreadId,
      });
      persistLastSessionId(created.sessionId);
      setSession(created);
      hydrateDraftFromSession(created);
      const resolvedThreadId = created.chatThreadId?.trim();
      const nextThreadId = resolvedThreadId && isUUID(resolvedThreadId) ? resolvedThreadId : desiredThreadId;
      setThreadId(nextThreadId);
      persistLastThreadId(nextThreadId);
      setThreadExists(false);
      setFlowError(null);
      return created;
    },
    [hydrateDraftFromSession, persistLastSessionId, persistLastThreadId],
  );

  const bindChatThreadToSession = useCallback(
    async (targetSessionId: string, targetThreadId: string) => {
      const normalizedThreadId = targetThreadId.trim();
      if (!normalizedThreadId) {
        return null;
      }
      try {
        const updated = await updatePluginStudioSessionDraft(targetSessionId, {
          chatThreadId: normalizedThreadId,
        });
        setSession((prev) => {
          if (prev?.sessionId !== updated.sessionId) {
            return prev;
          }
          return updated;
        });
        return updated;
      } catch (error) {
        console.warn("Failed to bind plugin assistant chat thread:", error);
        return null;
      }
    },
    [],
  );

  const reloadDraftSourcePackage = useCallback(async (targetSessionId: string) => {
    setDraftSourceLoading(true);
    setDraftSourceError(null);
    try {
      const pkg = await getPluginStudioSourcePackage(targetSessionId);
      setDraftSourcePackage(pkg);
      return pkg;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDraftSourcePackage(null);
      setDraftSourceError(message);
      return null;
    } finally {
      setDraftSourceLoading(false);
    }
  }, []);

  const syncWorkspaceSourceToSession = useCallback(async () => {
    const activeSession = sessionRef.current;
    const activeThreadId = threadId.trim();
    if (!activeSession || !activeThreadId || !workspaceSeeded) {
      return activeSession;
    }
    const updated = await pullPluginStudioWorkspace(activeSession.sessionId, {
      threadId: activeThreadId,
    });
    setSession(updated);
    hydrateDraftFromSession(updated);
    return updated;
  }, [hydrateDraftFromSession, threadId, workspaceSeeded]);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      setInitializing(true);
      setFlowError(null);
      try {
        let resolvedSession: PluginStudioSession | null = null;
        if (searchSessionId) {
          try {
            resolvedSession = await getPluginStudioSession(searchSessionId);
            persistLastSessionId(resolvedSession.sessionId);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setFlowError(message);
          }
        }
        if (!resolvedSession) {
          const savedSessionId = resolveLastSessionId();
          if (savedSessionId) {
            try {
              resolvedSession = await getPluginStudioSession(savedSessionId);
            } catch {
              resolvedSession = null;
            }
          }
        }
        if (!resolvedSession) {
          resolvedSession = await createPluginStudioSession({
            pluginName: DEFAULT_PLUGIN_NAME,
            description: "",
            chatThreadId: buildAssistantThreadId(),
          });
          persistLastSessionId(resolvedSession.sessionId);
        }
        if (cancelled || !resolvedSession) {
          return;
        }

        const candidateThreadId = resolvedSession.chatThreadId?.trim() ?? "";
        const cachedThreadId = resolveLastThreadId()?.trim() ?? "";
        const ignoreCachedThread = isDebugEntry;
        const boundThreadId = isUUID(candidateThreadId)
          ? candidateThreadId
          : (!ignoreCachedThread && isUUID(cachedThreadId))
            ? cachedThreadId
            : buildAssistantThreadId();
        const exists = isDebugEntry ? false : await checkThreadExists(boundThreadId);
        if (cancelled) {
          return;
        }

        setSession(resolvedSession);
        hydrateDraftFromSession(resolvedSession);
        setThreadId(boundThreadId);
        setThreadExists(exists);
        persistLastThreadId(boundThreadId);
        if (exists) {
          void ensurePluginAssistantThreadState(boundThreadId, resolvedSession.sessionId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled) {
          setFlowError(message);
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [
    checkThreadExists,
    ensurePluginAssistantThreadState,
    hydrateDraftFromSession,
    isDebugEntry,
    persistLastSessionId,
    persistLastThreadId,
    resolveLastSessionId,
    resolveLastThreadId,
    searchSessionId,
  ]);

  useEffect(() => {
    let cancelled = false;
    const loadInstalledVersion = async () => {
      if (!session?.pluginId) {
        setInstalledVersion("0.1.0");
        return;
      }
      const metadata = await getInstalledPluginMetadataById(session.pluginId);
      if (cancelled) {
        return;
      }
      setInstalledVersion(metadata?.version ?? metadata?.manifest.version ?? "0.1.0");
    };
    void loadInstalledVersion().catch(() => {
      if (!cancelled) {
        setInstalledVersion("0.1.0");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session?.pluginId]);

  useEffect(() => {
    if (!session?.sessionId) {
      setDraftSourcePackage(null);
      setDraftSourceError(null);
      setDraftSourceLoading(false);
      return;
    }
    let cancelled = false;
    void reloadDraftSourcePackage(session.sessionId).then((pkg) => {
      if (cancelled || pkg) {
        return;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reloadDraftSourcePackage, session?.sessionId, previewNonce]);

  useEffect(() => {
    const shouldSeedWorkspace = Boolean(session?.sessionId && threadId && (isDebugEntry || session?.sourceMode === "imported"));
    if (!shouldSeedWorkspace || !session) {
      setWorkspaceSeeded(false);
      workspaceSeedKeyRef.current = "";
      return;
    }

    const seedKey = `${session.sessionId}:${threadId}`;
    if (workspaceSeedKeyRef.current === seedKey) {
      return;
    }

    let cancelled = false;
    void seedPluginStudioWorkspace(session.sessionId, {
      threadId,
      includeTestMaterials: true,
    }).then(async () => {
      if (cancelled) {
        return;
      }
      workspaceSeedKeyRef.current = seedKey;
      setWorkspaceSeeded(true);
      if ((session.chatThreadId ?? "").trim() !== threadId.trim()) {
        await bindChatThreadToSession(session.sessionId, threadId);
      }
    }).catch((error) => {
      if (cancelled) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setWorkspaceSeeded(false);
      toast.error(message);
    });

    return () => {
      cancelled = true;
    };
  }, [bindChatThreadToSession, isDebugEntry, session, threadId]);

  const [thread, sendMessage, submitA2UIAction] = useThreadStream({
    threadId: threadExists ? threadId : undefined,
    isNewThread: !threadExists,
    context: assistantContext,
    onStart: (startedThreadId) => {
      setThreadId(startedThreadId);
      setThreadExists(true);
      persistLastThreadId(startedThreadId);
      const currentSessionId = sessionRef.current?.sessionId;
      if (currentSessionId) {
        void ensurePluginAssistantThreadState(startedThreadId, currentSessionId);
        void bindChatThreadToSession(currentSessionId, startedThreadId);
      }
    },
  });

  const pluginAssistantRuntimeContext = useMemo(
    () => session
      ? {
        workspace_mode: "plugin_assistant" as const,
        thread_visibility: "hidden" as const,
        plugin_studio_session_id: session.sessionId,
      }
      : undefined,
    [session],
  );

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      if (!session || !threadId) {
        return;
      }
      void sendMessage(threadId, message, pluginAssistantRuntimeContext);
    },
    [pluginAssistantRuntimeContext, sendMessage, session, threadId],
  );

  const handleClarificationSelect = useCallback(
    (option: string) => {
      void handleSubmit({
        text: option,
        files: [],
      });
    },
    [handleSubmit],
  );

  const handleA2UIAction = useCallback(
    (action: A2UIUserAction) => {
      if (!session || !threadId) {
        return;
      }
      void submitA2UIAction(threadId, action, pluginAssistantRuntimeContext).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to submit UI action: ${message}`);
      });
    },
    [pluginAssistantRuntimeContext, session, submitA2UIAction, threadId],
  );

  const handleRetryLastMessage = useCallback(() => {
    if (!session || !threadId || thread.isLoading) {
      return;
    }
    const retryText = findLastRetryableUserMessage(thread.messages);
    if (!retryText) {
      toast.error(t.workspace.messageList.noRetryableUserMessage);
      return;
    }
    void sendMessage(
      threadId,
      {
        text: retryText,
        files: [],
      },
      pluginAssistantRuntimeContext,
    ).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`${t.workspace.messageList.retryFailedPrefix}${message}`);
    });
  }, [
    pluginAssistantRuntimeContext,
    sendMessage,
    session,
    t.workspace.messageList.noRetryableUserMessage,
    t.workspace.messageList.retryFailedPrefix,
    thread.isLoading,
    thread.messages,
    threadId,
  ]);

  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);

  const readyForChat = Boolean(session && threadId);
  const {
    data: installedPluginPackage,
  } = useInstalledPluginPackage(session?.pluginId ?? "");
  const installedPluginMetadata = installedPluginPackage?.metadata ?? null;
  const installedPluginFiles = installedPluginPackage?.files ?? null;
  const previewPluginMetadata = useMemo(() => {
    if (draftSourcePackage) {
      return createPreviewInstalledPlugin(draftSourcePackage, session);
    }
    return installedPluginMetadata;
  }, [draftSourcePackage, installedPluginMetadata, session]);
  const previewPluginFiles = draftSourcePackage?.files ?? installedPluginFiles;

  useEffect(() => {
    if (!session) {
      setPreviewThreadId("");
      setPreviewThreadError(null);
      return;
    }
    if (session.previewThreadId) {
      setPreviewThreadId(session.previewThreadId);
      setPreviewThreadError(null);
      return;
    }
    if (!isDebugEntry && threadExists && threadId) {
      setPreviewThreadId(threadId);
      setPreviewThreadError(null);
      return;
    }
    setPreviewThreadId("");
  }, [isDebugEntry, session, threadExists, threadId]);

  const retryPreviewThread = useCallback(async (targetSessionId: string) => {
    setPreviewThreadError(null);
    let lastError: string | null = null;

    try {
      const latest = await getPluginStudioSession(targetSessionId);
        if (latest.previewThreadId) {
          setSession((prev) => {
            if (prev?.sessionId !== latest.sessionId) {
              return prev;
            }
            return latest;
          });
          setPreviewThreadId(latest.previewThreadId);
          return latest.previewThreadId;
        }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    try {
      const fallbackThreadId = await ensurePluginTestThreadId();
      setPreviewThreadId(fallbackThreadId);
      return fallbackThreadId;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    setPreviewThreadError(lastError || "创建调试线程失败。");
    return "";
  }, []);

  useEffect(() => {
    if (!session || session.previewThreadId) {
      return;
    }
    let cancelled = false;
    void retryPreviewThread(session.sessionId).then(() => {
      if (cancelled) {
        return;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [retryPreviewThread, session]);

  useEffect(() => {
    if (!session?.sessionId) {
      return;
    }
    let cancelled = false;
    const refreshMaterials = async () => {
      try {
        const result = await listPluginStudioTestMaterials(session.sessionId);
        if (cancelled) {
          return;
        }
        setSession((prev) => {
          if (prev?.sessionId !== session.sessionId) {
            return prev;
          }
          return {
            ...prev,
            testMaterials: result.testMaterials,
            selectedTestMaterialPath: result.selectedTestMaterialPath,
          };
        });
        if (result.selectedTestMaterialPath) {
          setSelectedMaterialPath((prev) => prev ?? normalizeMaterialPath(result.selectedTestMaterialPath ?? ""));
        }
      } catch {
        // ignore silent refresh errors
      }
    };
    void refreshMaterials();
    return () => {
      cancelled = true;
    };
  }, [session?.sessionId]);

  const persistDraft = useCallback(
    async (overrides?: {
      description?: string;
      draftVersion?: string;
      chatThreadId?: string;
      matchRules?: PluginStudioMatchRules;
      workflowState?: PluginStudioWorkflowState;
      selectedTestMaterialPath?: string | null;
    }) => {
      if (!session) {
        return null;
      }
      const nextDescription = overrides?.description ?? draftDescription;
      const nextDraftVersion = overrides?.draftVersion ?? draftVersion;
      const nextRules = normalizeMatchRules(overrides?.matchRules ?? matchRules);
      const nextWorkflowState = normalizeWorkflowState(overrides?.workflowState ?? workflowState);
      const rawSelectedPath = overrides?.selectedTestMaterialPath ?? (selectedMaterialPath || null);
      const nextSelectedPath = rawSelectedPath ? normalizeMaterialPath(rawSelectedPath) : null;
      const nextChatThreadId = overrides?.chatThreadId ?? threadId;

      setMetaSaving(true);
      setMetaError(null);
      try {
        const updated = await updatePluginStudioSessionDraft(session.sessionId, {
          description: nextDescription,
          draftVersion: nextDraftVersion,
          chatThreadId: nextChatThreadId,
          matchRules: nextRules,
          workflowState: {
            ...nextWorkflowState,
            fileMatchMode: deriveFileMatchMode(nextRules),
          },
          selectedTestMaterialPath: nextSelectedPath,
        });
        setSession(updated);
        hydrateDraftFromSession(updated);
        return updated;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setMetaError(message);
        toast.error(message);
        return null;
      } finally {
        setMetaSaving(false);
      }
    },
    [
      draftDescription,
      draftVersion,
      hydrateDraftFromSession,
      matchRules,
      selectedMaterialPath,
      session,
      threadId,
      workflowState,
    ],
  );

  const applyRuleForm = useCallback((nextForm: PluginAssistantRuleForm) => {
    const normalizedForm = normalizeRuleForm(nextForm);
    setRuleForm(normalizedForm);
    setMatchRules(mapRuleFormToMatchRules(normalizedForm));
  }, []);

  useEffect(() => {
    const mode = deriveFileMatchMode(matchRules);
    setWorkflowState((prev) => {
      if (prev.fileMatchMode === mode) {
        return prev;
      }
      return {
        ...prev,
        fileMatchMode: mode,
      };
    });
  }, [matchRules]);

  const collectUserMessages = useMemo(
    () =>
      thread.messages
        .filter((message) => message.type === "human")
        .map((message) => (textOfMessage(message) ?? "").trim())
        .filter(Boolean),
    [thread.messages],
  );

  const showWelcome = collectUserMessages.length === 0;

  const progress = useMemo(
    () => computeWorkflowProgress(workflowState, session?.state === "packaged"),
    [session?.state, workflowState],
  );

  const progressLabels = ["需求描述", "讨论交互", "页面设计", "生成插件"];

  const matchRulesReady = useMemo(() => isRuleFormReadyForUpload(ruleForm), [ruleForm]);
  const requiresDirectoryTarget = !matchRules.allowAll && (matchRules.kind === "directory" || matchRules.kind === "project");
  const requiresFileTarget = !matchRules.allowAll && matchRules.kind === "file";

  const previewMaterials = useMemo(
    () =>
      (session?.testMaterials ?? [])
        .map((item) => ({
          ...item,
          path: normalizeMaterialPath(item.path),
        }))
        .filter((item) => Boolean(item.path)),
    [session?.testMaterials],
  );
  const selectedMaterialItem = useMemo(
    () => previewMaterials.find((item) => item.path === selectedMaterialPath),
    [previewMaterials, selectedMaterialPath],
  );
  const previewTargetKind = useMemo(() => {
    if (requiresDirectoryTarget) {
      return "directory" as const;
    }
    if (requiresFileTarget) {
      return "file" as const;
    }
    return selectedMaterialItem?.kind === "directory" ? "directory" as const : "file" as const;
  }, [requiresDirectoryTarget, requiresFileTarget, selectedMaterialItem?.kind]);

  const materialTree = useMemo(() => buildMaterialTree(previewMaterials), [previewMaterials]);
  useEffect(() => {
    if (selectedMaterialPath || previewMaterials.length === 0) {
      return;
    }
    const preferred = requiresDirectoryTarget
      ? previewMaterials.find((item) => item.kind === "directory") ?? previewMaterials[0]
      : requiresFileTarget
        ? previewMaterials.find((item) => item.kind === "file") ?? previewMaterials[0]
        : previewMaterials[0];
    if (preferred) {
      setSelectedMaterialPath(normalizeMaterialPath(preferred.path));
    }
  }, [previewMaterials, requiresDirectoryTarget, requiresFileTarget, selectedMaterialPath]);

  useEffect(() => {
    if (materialTree.length === 0) {
      return;
    }
    setExpandedMaterialPaths((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const root of materialTree) {
        if (next[root.path] === undefined) {
          next[root.path] = true;
          changed = true;
        }
      }
      if (selectedMaterialPath) {
        const normalized = normalizeMaterialPath(selectedMaterialPath);
        const relative = normalized.replace(/^\/mnt\/user-data\/workspace\/?/, "");
        const segments = relative.split("/").filter(Boolean);
        let current = "/mnt/user-data/workspace";
        for (const segment of segments.slice(0, -1)) {
          current = `${current}/${segment}`;
          if (!next[current]) {
            next[current] = true;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [materialTree, selectedMaterialPath]);

  const handleSelectMaterialNode = useCallback(
    (node: MaterialTreeNode) => {
      let nextPath = node.path;
      if (requiresFileTarget && node.kind === "directory") {
        const firstFilePath = findFirstFilePath(node);
        if (!firstFilePath) {
          toast.error("该目录下还没有可预览文件，请先上传文件。");
          return;
        }
        nextPath = firstFilePath;
      } else if (requiresDirectoryTarget && node.kind === "file") {
        nextPath = dirname(node.path);
      }
      const normalized = normalizeMaterialPath(nextPath);
      setSelectedMaterialPath(normalized);
      void persistDraft({ selectedTestMaterialPath: normalized });
    },
    [persistDraft, requiresDirectoryTarget, requiresFileTarget],
  );

  const toggleMaterialPathExpanded = useCallback((path: string) => {
    setExpandedMaterialPaths((prev) => ({
      ...prev,
      [path]: !(prev[path] ?? true),
    }));
  }, []);

  const previewArtifactPath = useMemo(() => {
    if (selectedMaterialPath) {
      if (requiresDirectoryTarget) {
        if (selectedMaterialItem?.kind === "directory") {
          return selectedMaterialPath;
        }
        return dirname(selectedMaterialPath);
      }
      if (requiresFileTarget && selectedMaterialItem?.kind === "directory") {
        return "/mnt/user-data/workspace";
      }
      return selectedMaterialPath;
    }

    if (previewTargetKind !== "file") {
      return "/mnt/user-data/workspace";
    }

    const fixture = previewPluginMetadata?.manifest.fixtures?.[0];
    if (!fixture) {
      return "/mnt/user-data/workspace";
    }
    if (fixture.startsWith("/mnt/user-data")) {
      return fixture;
    }
    return `/mnt/user-data/workspace/${fixture.replace(/^\/+/, "")}`;
  }, [
    previewTargetKind,
    previewPluginMetadata?.manifest.fixtures,
    requiresDirectoryTarget,
    requiresFileTarget,
    selectedMaterialItem?.kind,
    selectedMaterialPath,
  ]);

  const previewContext = useMemo(() => {
    if (!previewThreadId) {
      return null;
    }
    return createWorkbenchContext(
      {
        path: previewArtifactPath,
        kind: previewTargetKind,
        metadata: {},
      },
      previewThreadId,
    );
  }, [previewArtifactPath, previewTargetKind, previewThreadId]);

  const previewReady = Boolean(previewPluginMetadata && previewPluginFiles && previewContext);
  const previewLoadingState = useMemo(() => {
    if (!session) {
      return {
        step: 0,
        title: "准备环境",
        detail: "正在初始化插件助手上下文...",
      };
    }
    if (previewThreadError) {
      return {
        step: 1,
        title: "预览暂时不可用",
        detail: previewThreadError,
      };
    }
    if (!previewThreadId) {
      return {
        step: 1,
        title: "准备环境",
        detail: "正在创建调试线程...",
      };
    }
    if (draftSourceLoading) {
      return {
        step: 2,
        title: "加载源码",
        detail: "正在加载当前会话的插件草稿源码...",
      };
    }
    if (!previewPluginMetadata || !previewPluginFiles) {
      return {
        step: 2,
        title: "加载插件",
        detail: "当前会话还没有可预览插件，发布后会自动安装并可实时预览。",
      };
    }
    if (!previewContext) {
      return {
        step: 3,
        title: "挂载预览",
        detail: "正在挂载实时预览 iframe...",
      };
    }
    return {
      step: 4,
      title: "预览就绪",
      detail: "插件已加载完成，可以开始调试。",
    };
  }, [draftSourceLoading, previewContext, previewPluginFiles, previewPluginMetadata, previewThreadError, previewThreadId, session]);

  const handleRefreshPreview = useCallback(() => {
    if (!previewThreadId && session?.sessionId) {
      void retryPreviewThread(session.sessionId);
      return;
    }
    void (async () => {
      try {
        if (workspaceSeeded) {
          await syncWorkspaceSourceToSession();
        }
        setPreviewNonce((prev) => prev + 1);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(message);
      }
    })();
  }, [previewThreadId, retryPreviewThread, session?.sessionId, syncWorkspaceSourceToSession, workspaceSeeded]);

  const handleFullscreenPreview = useCallback(() => {
    const target = previewHostRef.current;
    if (!target) {
      return;
    }
    if (document.fullscreenElement === target) {
      void document.exitFullscreen();
      return;
    }
    void target.requestFullscreen();
  }, []);

  const currentVersionBaseline = useMemo(() => {
    if (!session) {
      return "0.1.0";
    }
    return compareSemver(installedVersion, session.currentVersion) >= 0 ? installedVersion : session.currentVersion;
  }, [installedVersion, session]);

  const handleCreateSession = useCallback(() => {
    void createBoundSession(DEFAULT_PLUGIN_NAME, "")
      .then((created) => {
        toast.success(copy.createSessionSuccess.replaceAll("{name}", created.pluginName));
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setFlowError(message);
        toast.error(message);
      });
  }, [copy.createSessionSuccess, createBoundSession]);

  const handleBackToPlugins = useCallback(() => {
    router.push(`${pathOfChatsIndex()}?settings=workbench-plugins`);
  }, [router]);

  const handleUploadTestMaterials = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      event.target.value = "";
      if (!session || !files || files.length === 0) {
        return;
      }
      if (!matchRulesReady) {
        toast.error("请先配置文件匹配规则，再上传测试资料。");
        return;
      }

      const entries: Array<{ path: string; contentBase64: string; source: "upload" | "zip" }> = [];
      setMaterialUploading(true);
      try {
        for (const file of Array.from(files)) {
          const filename = file.name.toLowerCase();
          if (filename.endsWith(".zip")) {
            const zip = await JSZip.loadAsync(file);
            const zipItems = Object.values(zip.files).filter((item) => !item.dir);
            for (const item of zipItems) {
              const safePath = normalizeMaterialEntryPath(item.name);
              const bytes = await item.async("uint8array");
              entries.push({
                path: safePath,
                contentBase64: uint8ToBase64(bytes),
                source: "zip",
              });
            }
            continue;
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          const safePath = normalizeMaterialEntryPath(file.name);
          entries.push({
            path: safePath,
            contentBase64: uint8ToBase64(bytes),
            source: "upload",
          });
        }

        if (entries.length === 0) {
          toast.error("未解析到可导入的测试资料。");
          return;
        }

        const result = await importPluginStudioTestMaterials(session.sessionId, {
          entries,
          selectedPath: entries[0]?.path,
        });
        setSession((prev) => {
          if (prev?.sessionId !== session.sessionId) {
            return prev;
          }
          return {
            ...prev,
            testMaterials: result.testMaterials,
            selectedTestMaterialPath: result.selectedTestMaterialPath,
          };
        });
        if (result.selectedTestMaterialPath) {
          setSelectedMaterialPath(normalizeMaterialPath(result.selectedTestMaterialPath));
        }
        toast.success("测试资料已导入，可在预览中切换查看。");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(message);
      } finally {
        setMaterialUploading(false);
      }
    },
    [matchRulesReady, session],
  );

  const collectPublishBlockingIssues = useCallback(() => {
    const issues: string[] = [];
    if (!session) {
      issues.push("当前会话尚未就绪。");
      return issues;
    }
    if (!draftDescription.trim()) {
      issues.push("请先补充插件描述。");
    }
    if (!isSemver(draftVersion)) {
      issues.push("请填写正确的版本号，格式为 x.y.z。");
    } else if (compareSemver(draftVersion, currentVersionBaseline) <= 0) {
      issues.push(`版本号必须高于 ${currentVersionBaseline}。`);
    }
    if (!matchRulesReady) {
      issues.push("请先补充这个插件可打开的文件类型。");
    }
    if (previewMaterials.length === 0) {
      issues.push("请先上传测试资料。");
    }
    if (!selectedMaterialPath) {
      issues.push("请先在目录树中选择默认预览目标。");
    }
    return issues;
  }, [
    currentVersionBaseline,
    draftDescription,
    draftVersion,
    matchRulesReady,
    previewMaterials.length,
    selectedMaterialPath,
    session,
  ]);

  useEffect(() => {
    if (!publishError?.startsWith("发布前还需要补充")) {
      return;
    }
    const pendingIssues = collectPublishBlockingIssues();
    if (pendingIssues.length === 0) {
      setPublishError(null);
    }
  }, [collectPublishBlockingIssues, publishError]);

  const handlePublish = useCallback(async () => {
    if (!session) {
      return;
    }
    const blockingIssues = collectPublishBlockingIssues();
    if (blockingIssues.length > 0) {
      const message = `发布前还需要补充：\n${blockingIssues.map((item, index) => `${index + 1}. ${item}`).join("\n")}`;
      setPublishError(message);
      persistRightPaneMode("config");
      toast.error(blockingIssues[0] ?? "请先补充发布必填信息。");
      return;
    }

    if (workspaceSeeded) {
      try {
        await syncWorkspaceSourceToSession();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setPublishError(message);
        toast.error(message);
        return;
      }
    }

    const persisted = await persistDraft({
      description: draftDescription,
      draftVersion,
      matchRules,
      workflowState,
      selectedTestMaterialPath: selectedMaterialPath || null,
    });
    if (!persisted) {
      return;
    }

    const conversationSnapshot = thread.messages
      .slice(-40)
      .map((message) => {
        const content = (textOfMessage(message) ?? "").trim();
        if (!content) {
          return "";
        }
        const role = message.type === "human" ? "用户" : message.type === "ai" ? "助手" : message.type;
        return `${role}：${content}`;
      })
      .filter(Boolean)
      .join("\n\n");

    const releaseNotes = draftReleaseNotes.trim() || `发布 ${draftVersion}：根据当前对话完成插件更新。`;

    try {
      setPublishLoading(true);
      setPublishError(null);
      const publishResult = await publishPluginStudioSession(session.sessionId, {
        version: draftVersion,
        releaseNotes,
        description: draftDescription.trim(),
        conversationSnapshot,
        autoDownload: downloadAfterPublish,
      });

      const artifact = await downloadPluginStudioPackage(session.sessionId, session.pluginId);
      await installPluginMutation.mutateAsync({ file: artifact });
      await updateInstalledPluginMetadata(publishResult.pluginId, {
        version: publishResult.version,
        pluginStudioSessionId: publishResult.session.sessionId,
        releaseNotes,
        publishedAt: publishResult.packagedAt,
      });

      if (downloadAfterPublish) {
        triggerBrowserDownload(artifact);
      }

      setSession(publishResult.session);
      hydrateDraftFromSession(publishResult.session);
      setInstalledVersion(publishResult.version);
      setPreviewNonce((prev) => prev + 1);
      toast.success(copy.publishSuccess.replaceAll("{version}", publishResult.version));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPublishError(message);
      toast.error(message);
    } finally {
      setPublishLoading(false);
    }
  }, [
    copy.publishSuccess,
    collectPublishBlockingIssues,
    downloadAfterPublish,
    draftDescription,
    draftReleaseNotes,
    draftVersion,
    hydrateDraftFromSession,
    installPluginMutation,
    matchRules,
    persistDraft,
    persistRightPaneMode,
    selectedMaterialPath,
    session,
    syncWorkspaceSourceToSession,
    thread.messages,
    workspaceSeeded,
    workflowState,
  ]);

  const handleRuleScopeChange = useCallback(
    (scope: PluginAssistantRuleForm["scope"]) => {
      applyRuleForm({
        ...ruleForm,
        scope,
      });
    },
    [applyRuleForm, ruleForm],
  );

  const handleTogglePresetFileType = useCallback(
    (extension: string) => {
      const selected = new Set(ruleForm.fileTypes);
      if (selected.has(extension)) {
        selected.delete(extension);
      } else {
        selected.add(extension);
      }
      applyRuleForm({
        ...ruleForm,
        scope: "file",
        fileTypes: Array.from(selected),
      });
    },
    [applyRuleForm, ruleForm],
  );

  const handleCustomFileTypesChange = useCallback(
    (value: string) => {
      setCustomFileTypesInput(value);
    },
    [],
  );

  const customFileTypes = useMemo(
    () => ruleForm.fileTypes.filter((item) => !PRESET_FILE_TYPE_SET.has(item as (typeof PRESET_FILE_TYPES)[number])),
    [ruleForm.fileTypes],
  );

  const handleAddCustomFileType = useCallback(
    (raw: string) => {
      const tokens = parseListValue(raw).map((item) => normalizeFileTypeToken(item)).filter(Boolean);
      if (tokens.length === 0) {
        return;
      }
      const presetTypes = ruleForm.fileTypes.filter((item) =>
        PRESET_FILE_TYPE_SET.has(item as (typeof PRESET_FILE_TYPES)[number]));
      const existingCustomTypes = ruleForm.fileTypes.filter((item) => !PRESET_FILE_TYPE_SET.has(item as (typeof PRESET_FILE_TYPES)[number]));
      const merged = Array.from(new Set([...presetTypes, ...existingCustomTypes, ...tokens]));
      applyRuleForm({
        ...ruleForm,
        scope: "file",
        fileTypes: merged,
      });
      setCustomFileTypesInput("");
    },
    [applyRuleForm, ruleForm],
  );

  const handleRemoveCustomFileType = useCallback(
    (extension: string) => {
      const presetTypes = ruleForm.fileTypes.filter((item) =>
        PRESET_FILE_TYPE_SET.has(item as (typeof PRESET_FILE_TYPES)[number]));
      const nextCustomTypes = ruleForm.fileTypes
        .filter((item) => !PRESET_FILE_TYPE_SET.has(item as (typeof PRESET_FILE_TYPES)[number]))
        .filter((item) => item !== extension);
      applyRuleForm({
        ...ruleForm,
        scope: "file",
        fileTypes: [...presetTypes, ...nextCustomTypes],
      });
    },
    [applyRuleForm, ruleForm],
  );

  const handleCustomFileTypesKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" || event.key === ",") {
        event.preventDefault();
        handleAddCustomFileType(customFileTypesInput);
        return;
      }
      if (event.key === "Backspace" && customFileTypesInput.trim().length === 0) {
        const lastCustomType = customFileTypes[customFileTypes.length - 1];
        if (!lastCustomType) {
          return;
        }
        event.preventDefault();
        handleRemoveCustomFileType(lastCustomType);
      }
    },
    [customFileTypes, customFileTypesInput, handleAddCustomFileType, handleRemoveCustomFileType],
  );

  const renderMaterialTree = (nodes: MaterialTreeNode[], depth = 0) => {
    return (
      <div className={depth === 0 ? "space-y-1" : "space-y-0.5"}>
        {nodes.map((node) => {
          const hasChildren = node.children.length > 0;
          const expanded = expandedMaterialPaths[node.path] ?? true;
          const selected = selectedMaterialPath === node.path;
          return (
            <div key={node.path}>
              <div
                className={`flex items-center gap-1 rounded-md px-1 py-1 text-xs ${
                  selected ? "bg-sky-100 text-sky-800" : "hover:bg-muted/60"
                }`}
              >
                <button
                  type="button"
                  className="flex size-5 items-center justify-center rounded hover:bg-muted"
                  onClick={() => {
                    if (hasChildren) {
                      toggleMaterialPathExpanded(node.path);
                    }
                  }}
                >
                  {hasChildren ? (
                    <ChevronRightIcon className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
                  ) : (
                    <span className="size-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                  onClick={() => handleSelectMaterialNode(node)}
                >
                  {node.kind === "directory" ? (
                    <FolderIcon className="size-3.5 shrink-0 text-amber-500" />
                  ) : (
                    <FileIcon className="size-3.5 shrink-0 text-sky-600" />
                  )}
                  <span className="truncate">{node.name}</span>
                </button>
              </div>
              {hasChildren && expanded ? (
                <div className="ml-5 border-l pl-1.5">
                  {renderMaterialTree(node.children, depth + 1)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <ThreadContext.Provider value={{ thread }}>
      <div className="flex size-full min-h-0 flex-col">
        <header className="border-b px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-sm font-semibold">{copy.title}</h1>
              <p className="text-muted-foreground mt-1 text-xs">{copy.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleBackToPlugins}>
                <ArrowLeftIcon className="size-4" />
                返回插件列表
              </Button>
              <Button size="sm" variant="outline" onClick={handleCreateSession} disabled={initializing || publishLoading}>
                <PlusIcon className="size-4" />
                {copy.newSession}
              </Button>
              <Button size="sm" onClick={() => void handlePublish()} disabled={!session || initializing || publishLoading}>
                <RocketIcon className="size-4" />
                {copy.publish}
              </Button>
            </div>
          </div>

          {!isDebugEntry ? (
            <>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
                {progressLabels.map((label, index) => {
                  const done = progress.flags[index] ?? false;
                  const active = !done && progress.activeIndex === index;
                  return (
                    <div
                      key={label}
                      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                        done
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : active
                            ? "border-blue-200 bg-blue-50 text-blue-700"
                            : "border-border text-muted-foreground"
                      }`}
                    >
                      {done ? (
                        <CheckCircle2Icon className="size-3.5 shrink-0" />
                      ) : active ? (
                        <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
                      ) : (
                        <CircleIcon className="size-3.5 shrink-0" />
                      )}
                      <span className="truncate">{label}</span>
                    </div>
                  );
                })}
              </div>

              <div className="text-muted-foreground mt-2 text-[11px]">
                {copy.progressHint.replaceAll("{version}", currentVersionBaseline)}
              </div>
              {(searchFrom === "test" || session?.sourceMode === "imported") ? (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                  {copy.importedSourceHint}
                </div>
              ) : null}
            </>
          ) : null}
          {flowError ? (
            <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
              {flowError}
            </div>
          ) : null}
          {publishError ? (
            <div className="mt-2 whitespace-pre-line rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              {publishError}
            </div>
          ) : null}
        </header>

        {initializing ? (
          <div className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center gap-2 text-sm">
            <Loader2Icon className="size-4 animate-spin" />
            {copy.restoring}
          </div>
        ) : (
          <ResizablePanelGroup
            className="min-h-0 flex-1"
            onLayoutChanged={(layout) => {
              if (layout.length !== 2) {
                return;
              }
              persistSplitLayout([layout[0] ?? 40, layout[1] ?? 60]);
            }}
          >
            <ResizablePanel minSize={25} defaultSize={splitLayout[0]}>
              <section className="flex size-full min-w-0 flex-col">
                {showWelcome ? (
                  <div className="text-muted-foreground mx-4 mt-4 rounded-md border border-dashed px-3 py-2 text-xs">
                    你好，告诉我你现在想优化这个插件的哪一部分，我会直接帮你调整。
                  </div>
                ) : null}
                <div className="min-h-0 flex-1">
                  <MessageList
                    className="size-full pt-4"
                    threadId={threadId || "plugin-assistant"}
                    thread={thread}
                    paddingBottom={224}
                    onClarificationSelect={handleClarificationSelect}
                    onRetryLastMessage={handleRetryLastMessage}
                    onA2UIAction={handleA2UIAction}
                  />
                </div>
                <div className="border-t px-4 py-3">
                  {readyForChat ? (
                    <InputBox
                      threadId={threadId}
                      context={assistantContext}
                      isNewThread={!threadExists}
                      status={thread.isLoading ? "streaming" : "ready"}
                      disabled={!readyForChat}
                      onContextChange={setAssistantContext}
                      onSubmit={handleSubmit}
                      onStop={handleStop}
                    />
                  ) : (
                    <div className="text-muted-foreground py-4 text-center text-sm">
                      {copy.sessionNotReady}
                    </div>
                  )}
                </div>
              </section>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel minSize={35} defaultSize={splitLayout[1]}>
              <section className="bg-background flex size-full min-w-0 flex-col border-l">
                <header className="flex items-center justify-between border-b px-3 py-2">
                  <div>
                    <div className="text-sm font-semibold">{rightPaneMode === "preview" ? "实时插件预览" : "插件配置"}</div>
                    <div className="text-muted-foreground text-[11px]">
                      {rightPaneMode === "preview"
                        ? "右侧展示真实插件场景，可随时刷新和全屏调试"
                        : "按向导配置匹配范围与测试资料，完成后点击保存信息"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {rightPaneMode === "preview" ? (
                      <>
                        <Button size="icon-sm" variant="ghost" onClick={handleRefreshPreview}>
                          <RefreshCwIcon className="size-4" />
                        </Button>
                        <Button size="icon-sm" variant="ghost" onClick={handleFullscreenPreview}>
                          <Maximize2Icon className="size-4" />
                        </Button>
                      </>
                    ) : null}
                    <div className="flex items-center gap-1 rounded-md border p-1">
                      <Button
                        size="sm"
                        variant={rightPaneMode === "preview" ? "secondary" : "ghost"}
                        className="h-7 px-2 text-xs"
                        onClick={() => persistRightPaneMode("preview")}
                      >
                        <EyeIcon className="size-3.5" />
                        预览
                      </Button>
                      <Button
                        size="sm"
                        variant={rightPaneMode === "config" ? "secondary" : "ghost"}
                        className="h-7 px-2 text-xs"
                        onClick={() => persistRightPaneMode("config")}
                      >
                        <SlidersHorizontalIcon className="size-3.5" />
                        配置
                      </Button>
                    </div>
                  </div>
                </header>

                <div className="min-h-0 flex-1">
                  {rightPaneMode === "preview" ? (
                    <div ref={previewHostRef} className="bg-muted/20 relative size-full overflow-hidden">
                      {previewReady && previewPluginMetadata && previewPluginFiles && previewContext ? (
                        <WorkbenchPluginIframe
                          key={`${session?.sessionId ?? "na"}:${previewNonce}:${previewThreadId}:${previewArtifactPath}`}
                          plugin={previewPluginMetadata}
                          files={previewPluginFiles}
                          context={previewContext}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center p-6">
                          <div className="bg-background w-full max-w-sm rounded-xl border p-4 text-center shadow-sm">
                            <div className="text-sm font-semibold">{previewLoadingState.title}</div>
                            <div className="text-muted-foreground mt-1 text-xs leading-5">{previewLoadingState.detail}</div>
                            <div className="bg-muted mt-3 h-1.5 w-full overflow-hidden rounded-full">
                              <div
                                className="h-full rounded-full bg-sky-500 transition-all duration-300"
                                style={{ width: `${Math.min(100, (previewLoadingState.step / 4) * 100)}%` }}
                              />
                            </div>
                            <div className="text-muted-foreground mt-2 text-[11px]">
                              {previewThreadError
                                ? "调试线程准备失败，点击下方按钮重试。"
                                : draftSourceError && !installedPluginMetadata
                                  ? draftSourceError
                                  : "正在耐心等待中，请稍候..."}
                            </div>
                            {previewThreadError ? (
                              <Button className="mt-3" size="sm" variant="outline" onClick={handleRefreshPreview}>
                                <RefreshCwIcon className="size-4" />
                                重新准备
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <aside className="bg-background flex h-full flex-col">
                      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                        <section className="bg-muted/20 space-y-3 rounded-xl border p-3">
                          <div className="text-sm font-medium">基础信息</div>
                          <label className="block space-y-1">
                            <span className="text-xs font-medium">描述</span>
                            <Textarea
                              value={draftDescription}
                              onChange={(event) => setDraftDescription(event.target.value)}
                              rows={3}
                              placeholder="一句话描述这个插件能帮用户做什么"
                            />
                          </label>

                          <label className="block space-y-1">
                            <span className="text-xs font-medium">版本号</span>
                            <Input
                              value={draftVersion}
                              onChange={(event) => setDraftVersion(event.target.value)}
                              placeholder="0.1.1"
                            />
                          </label>

                          <label className="block space-y-1">
                            <span className="text-xs font-medium">发布说明</span>
                            <Textarea
                              value={draftReleaseNotes}
                              onChange={(event) => setDraftReleaseNotes(event.target.value)}
                              rows={2}
                              placeholder="可选，不填将自动生成简要发布说明"
                            />
                          </label>

                          <div className="flex items-center justify-between rounded-md border px-2.5 py-2">
                            <div>
                              <div className="text-xs font-medium">发布后自动下载插件包</div>
                              <div className="text-muted-foreground text-[11px]">开启后会自动下载 `.nwp`，便于迁移和备份。</div>
                            </div>
                            <Switch
                              checked={downloadAfterPublish}
                              onCheckedChange={setDownloadAfterPublish}
                              disabled={publishLoading}
                            />
                          </div>
                        </section>

                        <section className="bg-muted/20 space-y-3 rounded-xl border p-3">
                          <div className="space-y-1">
                            <div className="text-sm font-medium">适用对象</div>
                            <p className="text-muted-foreground text-[11px]">这会决定用户右键文件或目录时，菜单里会不会出现这个插件。</p>
                          </div>

                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <button
                              type="button"
                              className={`rounded-md border px-2 py-2 text-xs ${
                                ruleForm.scope === "all_files"
                                  ? "border-sky-300 bg-sky-50 text-sky-700"
                                  : "hover:bg-muted/50"
                              }`}
                              onClick={() => handleRuleScopeChange("all_files")}
                            >
                              全部内容
                            </button>
                            <button
                              type="button"
                              className={`rounded-md border px-2 py-2 text-xs ${
                                ruleForm.scope === "file"
                                  ? "border-sky-300 bg-sky-50 text-sky-700"
                                  : "hover:bg-muted/50"
                              }`}
                              onClick={() => handleRuleScopeChange("file")}
                            >
                              打开文件
                            </button>
                            <button
                              type="button"
                              className={`rounded-md border px-2 py-2 text-xs ${
                                ruleForm.scope === "directory"
                                  ? "border-sky-300 bg-sky-50 text-sky-700"
                                  : "hover:bg-muted/50"
                              }`}
                              onClick={() => handleRuleScopeChange("directory")}
                            >
                              打开目录
                            </button>
                          </div>

                          {ruleForm.scope === "all_files" ? (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-[11px] text-emerald-800">
                              不限制类型。右键任意文件或目录时，这个插件都可以进入候选列表。
                            </div>
                          ) : null}

                          {ruleForm.scope === "file" ? (
                            <div className="space-y-2">
                              <div className="space-y-1">
                                <div className="text-xs font-medium">这个插件能打开哪些文件</div>
                                <p className="text-muted-foreground text-[11px]">只要文件后缀命中这些类型，右键菜单里就会出现这个插件。</p>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {PRESET_FILE_TYPES.map((extension) => {
                                  const active = ruleForm.fileTypes.includes(extension);
                                  return (
                                    <button
                                      key={extension}
                                      type="button"
                                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                                        active
                                          ? "border-sky-300 bg-sky-50 text-sky-700"
                                          : "hover:bg-muted/50"
                                      }`}
                                      onClick={() => handleTogglePresetFileType(extension)}
                                    >
                                      .{extension}
                                    </button>
                                  );
                                })}
                              </div>
                              <label className="block space-y-1">
                                <span className="text-xs font-medium">其他后缀</span>
                                <div className="text-muted-foreground text-[11px]">
                                  回车添加一个后缀，会自动生成 tag（也支持逗号分隔）。
                                </div>
                                <div
                                  className="border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] flex min-h-11 w-full flex-wrap items-center gap-2 rounded-xl border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow]"
                                  onMouseDown={(event) => {
                                    if (event.target === event.currentTarget) {
                                      event.preventDefault();
                                      event.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
                                    }
                                  }}
                                >
                                  {customFileTypes.map((ext) => (
                                    <button
                                      key={`custom-ext:${ext}`}
                                      type="button"
                                      className="inline-flex min-h-8 items-center gap-2 rounded-full border border-border/80 bg-background px-3 py-1.5 text-sm font-medium leading-none shadow-sm transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
                                      aria-label={`删除 .${ext}`}
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                      }}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        handleRemoveCustomFileType(ext);
                                      }}
                                    >
                                      <span>.{ext}</span>
                                      <span className="text-muted-foreground text-base leading-none">×</span>
                                    </button>
                                  ))}
                                  <input
                                    className="placeholder:text-muted-foreground min-w-[12ch] flex-1 bg-transparent px-1 py-1.5 text-base outline-none md:text-sm"
                                    value={customFileTypesInput}
                                    onChange={(event) => handleCustomFileTypesChange(event.target.value)}
                                    onKeyDown={handleCustomFileTypesKeyDown}
                                    placeholder={
                                      customFileTypes.length > 0
                                        ? "继续输入后缀..."
                                        : "例如 txt 然后回车"
                                    }
                                  />
                                </div>
                              </label>
                            </div>
                          ) : null}

                          {ruleForm.scope === "directory" ? (
                            <div className="space-y-2">
                              <div className="space-y-1">
                                <div className="text-xs font-medium">这个插件能打开任何目录</div>
                                <p className="text-muted-foreground text-[11px]">
                                  不做额外限制。右键任意目录时，这个插件都可以进入候选列表。
                                </p>
                              </div>
                            </div>
                          ) : null}
                        </section>

                        <section className="bg-muted/20 space-y-2 rounded-xl border p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium">测试资料</div>
                              <div className="text-muted-foreground text-[11px]">点击目录树里的节点后，切到“预览”页就会按这个目标打开插件。</div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => uploadRef.current?.click()}
                              disabled={!matchRulesReady || materialUploading}
                            >
                              {materialUploading ? <Loader2Icon className="size-4 animate-spin" /> : <UploadIcon className="size-4" />}
                              上传
                            </Button>
                          </div>
                          {!matchRulesReady ? (
                            <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
                              请先完成适用对象配置后再上传测试资料。
                            </div>
                          ) : null}
                          <input
                            ref={uploadRef}
                            type="file"
                            multiple
                            accept=".zip,*/*"
                            className="hidden"
                            onChange={handleUploadTestMaterials}
                          />
                          <div className="bg-background h-[360px] min-h-0 overflow-y-auto rounded-lg border p-2">
                            {materialTree.length > 0 ? (
                              renderMaterialTree(materialTree)
                            ) : (
                              <div className="text-muted-foreground px-1 py-2 text-[11px]">
                                暂无测试资料。先上传一个文件或 ZIP 来开始调试。
                              </div>
                            )}
                          </div>
                        </section>

                        <Button
                          className="w-full"
                          size="sm"
                          onClick={() => {
                            void persistDraft();
                          }}
                          disabled={metaSaving}
                        >
                          {metaSaving ? <Loader2Icon className="size-4 animate-spin" /> : null}
                          保存信息
                        </Button>
                        {metaError ? (
                          <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
                            {metaError}
                          </div>
                        ) : null}
                      </div>
                    </aside>
                  )}
                </div>
              </section>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
    </ThreadContext.Provider>
  );
}
