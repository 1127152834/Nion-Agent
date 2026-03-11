"use client";

import { Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { InputBox } from "@/components/workspace/input-box";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import {
  PluginAssistantFlowPanel,
  type PluginAssistantFlowAction,
} from "@/components/workspace/plugins/plugin-assistant-flow-panel";
import { getAPIClient } from "@/core/api";
import { useI18n } from "@/core/i18n/hooks";
import { findLastRetryableUserMessage } from "@/core/messages/retry";
import { useLocalSettings } from "@/core/settings";
import type { AgentThreadContext } from "@/core/threads";
import { isThreadNotFoundError, useThreadStream } from "@/core/threads/hooks";
import { isUUID, uuid } from "@/core/utils/uuid";
import {
  autoVerifyPluginStudioSession,
  createPluginStudioSession,
  downloadPluginStudioPackage,
  generatePluginStudioSession,
  getPluginStudioSession,
  manualVerifyPluginStudioSession,
  packagePluginStudioSession,
  type PluginStudioSession,
} from "@/core/workbench";

const LAST_SESSION_STORAGE_KEY = "nion.workbench.plugin-assistant.last-session-id";
const LAST_THREAD_STORAGE_KEY = "nion.workbench.plugin-assistant.last-thread-id";
const DEFAULT_PLUGIN_NAME = "Plugin Assistant Draft";
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

export default function PluginAssistantPage() {
  const { t } = useI18n();
  const copy = t.workspace.pluginAssistant;
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
  const [activeAction, setActiveAction] = useState<PluginAssistantFlowAction>(null);
  const [pluginName, setPluginName] = useState(DEFAULT_PLUGIN_NAME);
  const [description, setDescription] = useState("");
  const [manualNote, setManualNote] = useState("");
  const sessionRef = useRef<PluginStudioSession | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

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
        // Thread might not exist yet; state will be written after the first message creates it.
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
      const resolvedThreadId = created.chatThreadId?.trim();
      const nextThreadId = resolvedThreadId && isUUID(resolvedThreadId) ? resolvedThreadId : desiredThreadId;
      setThreadId(nextThreadId);
      persistLastThreadId(nextThreadId);
      setThreadExists(false);
      setPluginName(created.pluginName || nextPluginName);
      setDescription(created.description || nextDescription);
      setManualNote("");
      return created;
    },
    [persistLastSessionId, persistLastThreadId],
  );

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      setInitializing(true);
      setFlowError(null);
      try {
        const savedSessionId = resolveLastSessionId();
        let resolvedSession: PluginStudioSession | null = null;
        if (savedSessionId) {
          try {
            resolvedSession = await getPluginStudioSession(savedSessionId);
          } catch {
            resolvedSession = null;
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
        if (cancelled) {
          return;
        }

        const candidateThreadId = resolvedSession.chatThreadId?.trim() ?? "";
        const cachedThreadId = resolveLastThreadId()?.trim() ?? "";
        const boundThreadId = isUUID(candidateThreadId)
          ? candidateThreadId
          : isUUID(cachedThreadId)
            ? cachedThreadId
            : buildAssistantThreadId();
        const exists = await checkThreadExists(boundThreadId);
        if (cancelled) {
          return;
        }

        setSession(resolvedSession);
        setThreadId(boundThreadId);
        setThreadExists(exists);
        persistLastThreadId(boundThreadId);
        setPluginName(resolvedSession.pluginName || DEFAULT_PLUGIN_NAME);
        setDescription(resolvedSession.description || "");
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
    persistLastSessionId,
    persistLastThreadId,
    resolveLastSessionId,
    resolveLastThreadId,
  ]);

  const [thread, sendMessage] = useThreadStream({
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
      }
    },
  });

  const runFlowAction = useCallback(
    async (action: Exclude<PluginAssistantFlowAction, null>, runner: () => Promise<void>) => {
      setActiveAction(action);
      setFlowError(null);
      try {
        await runner();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFlowError(message);
        toast.error(message);
      } finally {
        setActiveAction(null);
      }
    },
    [],
  );

  const refreshSession = useCallback(async (sessionId: string) => {
    const refreshed = await getPluginStudioSession(sessionId);
    setSession(refreshed);
    setPluginName(refreshed.pluginName || DEFAULT_PLUGIN_NAME);
    setDescription(refreshed.description || "");
    return refreshed;
  }, []);

  const handleCreateSession = useCallback(() => {
    void runFlowAction("create", async () => {
      const normalizedName = pluginName.trim() || DEFAULT_PLUGIN_NAME;
      const normalizedDescription = description.trim();
      await createBoundSession(normalizedName, normalizedDescription);
      toast.success(copy.createSessionSuccess);
    });
  }, [copy.createSessionSuccess, createBoundSession, description, pluginName, runFlowAction]);

  const handleGenerate = useCallback(() => {
    if (!session) {
      return;
    }
    void runFlowAction("generate", async () => {
      const updated = await generatePluginStudioSession(session.sessionId, {
        description: description.trim(),
      });
      setSession(updated);
      setDescription(updated.description || description);
      toast.success(copy.generateSuccess);
    });
  }, [copy.generateSuccess, description, runFlowAction, session]);

  const handleAutoVerify = useCallback(() => {
    if (!session) {
      return;
    }
    void runFlowAction("auto-verify", async () => {
      const report = await autoVerifyPluginStudioSession(session.sessionId);
      await refreshSession(session.sessionId);
      if (report.passed) {
        toast.success(copy.autoVerifyPassed);
      } else {
        toast.error(report.summary);
      }
    });
  }, [copy.autoVerifyPassed, refreshSession, runFlowAction, session]);

  const handleManualVerify = useCallback(
    (passed: boolean) => {
      if (!session) {
        return;
      }
      const action: Exclude<PluginAssistantFlowAction, null> = passed ? "manual-pass" : "manual-fail";
      void runFlowAction(action, async () => {
        const updated = await manualVerifyPluginStudioSession(session.sessionId, {
          passed,
          note: manualNote.trim() || undefined,
        });
        setSession(updated);
        toast.success(passed ? copy.manualVerifyPassed : copy.manualVerifyFailed);
      });
    },
    [copy.manualVerifyFailed, copy.manualVerifyPassed, manualNote, runFlowAction, session],
  );

  const handlePackage = useCallback(() => {
    if (!session) {
      return;
    }
    void runFlowAction("package", async () => {
      await packagePluginStudioSession(session.sessionId);
      await refreshSession(session.sessionId);
      toast.success(copy.packageSuccess);
    });
  }, [copy.packageSuccess, refreshSession, runFlowAction, session]);

  const handleDownload = useCallback(() => {
    if (!session) {
      return;
    }
    void runFlowAction("download", async () => {
      const artifact = await downloadPluginStudioPackage(session.sessionId, session.pluginId);
      const url = URL.createObjectURL(artifact);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = artifact.name;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }, [runFlowAction, session]);

  const pluginAssistantRuntimeContext = session
    ? {
      workspace_mode: "plugin_assistant" as const,
      thread_visibility: "hidden" as const,
      plugin_studio_session_id: session.sessionId,
    }
    : undefined;

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
  }, [pluginAssistantRuntimeContext, sendMessage, session, t.workspace.messageList.noRetryableUserMessage, t.workspace.messageList.retryFailedPrefix, thread.isLoading, thread.messages, threadId]);

  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);

  const readyForChat = Boolean(session && threadId);

  return (
    <ThreadContext.Provider value={{ thread }}>
      <div className="flex size-full min-h-0">
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="border-b px-4 py-3">
            <h1 className="text-sm font-semibold">{copy.title}</h1>
            <p className="text-muted-foreground mt-1 text-xs">
              {copy.description}
            </p>
          </header>

          {initializing ? (
            <div className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center gap-2 text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              {copy.restoring}
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1">
                <MessageList
                  className="size-full pt-10"
                  threadId={threadId || "plugin-assistant"}
                  thread={thread}
                  paddingBottom={224}
                  onClarificationSelect={handleClarificationSelect}
                  onRetryLastMessage={handleRetryLastMessage}
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
            </>
          )}
        </section>

        <div className="w-[360px] max-w-[42vw] min-w-[320px]">
          <PluginAssistantFlowPanel
            session={session}
            pluginName={pluginName}
            description={description}
            manualNote={manualNote}
            activeAction={activeAction}
            errorMessage={flowError}
            onPluginNameChange={setPluginName}
            onDescriptionChange={setDescription}
            onManualNoteChange={setManualNote}
            onCreateSession={handleCreateSession}
            onGenerate={handleGenerate}
            onAutoVerify={handleAutoVerify}
            onManualVerify={handleManualVerify}
            onPackage={handlePackage}
            onDownload={handleDownload}
          />
        </div>
      </div>
    </ThreadContext.Provider>
  );
}
