import type { AIMessage, Message } from "@langchain/langgraph-sdk";
import type { ThreadsClient } from "@langchain/langgraph-sdk/client";
import { useStream } from "@langchain/langgraph-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

import type { A2UIUserAction } from "../a2ui/types";
import { getAPIClient } from "../api";
import { useI18n } from "../i18n/hooks";
import type { FileInMessage } from "../messages/utils";
import type { LocalSettings } from "../settings";
import { useUpdateSubtask } from "../tasks/context";
import type { UploadedFileInfo } from "../uploads";
import { uploadFiles } from "../uploads";

import type { AgentThread, AgentThreadState } from "./types";

export type ToolEndEvent = {
  name: string;
  data: unknown;
};

const A2UI_CLIENT_CAPABILITIES = {
  a2ui_version: "0.8",
  catalog_id: "standard",
  components: [
    // Display
    "Text",
    "Image",
    "Icon",
    "Video",
    "AudioPlayer",
    "Divider",
    // Product-specific visualization
    "TempRangeChart",
    // Layout
    "Row",
    "Column",
    "List",
    "Card",
    "Tabs",
    "Modal",
    // Interactive
    "Button",
    "CheckBox",
    "TextField",
    "DateTimeInput",
    "MultipleChoice",
    "Slider",
  ],
} as const;

function normalizeErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error.trim();
  }
  if (error instanceof Error) {
    return error.message.trim();
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message.trim();
    }
  }
  return "";
}

export function isThreadNotFoundError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (status === 404 || status === 422) {
      return true;
    }
  }

  const normalized = normalizeErrorMessage(error).toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    (normalized.includes("thread") && normalized.includes("not found"))
    || normalized.includes("thread with id")
    || normalized.includes("http 404")
    || normalized.includes("status code 404")
    || normalized.includes("http 422")
    || normalized.includes("status code 422")
    || normalized.includes("invalid thread id")
    || normalized.includes("must be a uuid")
  );
}

function pruneThreadList(data: unknown, threadId: string) {
  if (!Array.isArray(data)) {
    return data;
  }
  return data.filter((thread) => thread?.thread_id !== threadId);
}

export function pruneThreadFromCache(queryClient: QueryClient, threadId: string) {
  queryClient.setQueriesData(
    {
      queryKey: ["threads", "search"],
      exact: false,
    },
    (oldData) => pruneThreadList(oldData, threadId),
  );
}

export type ThreadStreamOptions = {
  threadId?: string | null | undefined;
  context: LocalSettings["context"];
  isMock?: boolean;
  /** If true, will not attempt to reconnect to existing thread on mount */
  isNewThread?: boolean;
  onStart?: (threadId: string) => void;
  onFinish?: (state: AgentThreadState) => void;
  onToolEnd?: (event: ToolEndEvent) => void;
};

function toFileInMessage(info: UploadedFileInfo): FileInMessage {
  return {
    filename: info.filename,
    size: info.size,
    path: info.virtual_path,
    virtual_path: info.virtual_path,
    markdown_file: info.markdown_file,
    markdown_path: info.markdown_path,
    markdown_virtual_path: info.markdown_virtual_path,
    markdown_artifact_url: info.markdown_artifact_url,
    status: "uploaded",
  };
}

export function useThreadStream({
  threadId,
  context,
  isMock,
  isNewThread,
  onStart,
  onFinish,
  onToolEnd,
}: ThreadStreamOptions) {
  const { t } = useI18n();
  const [_threadId, setThreadId] = useState<string | null>(threadId ?? null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (_threadId && _threadId !== threadId) {
      setThreadId(threadId ?? null);
      startedRef.current = false; // Reset for new thread
    }
  }, [threadId, _threadId]);

  const queryClient = useQueryClient();
  const updateSubtask = useUpdateSubtask();
  const previousLoadingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const thread = useStream<AgentThreadState>({
    client: getAPIClient(isMock),
    assistantId: "lead_agent",
    threadId: _threadId,
    reconnectOnMount: !isNewThread,
    // LangGraph history endpoint may fail when no checkpointer is configured.
    // Keep reconnect behavior but skip history fetch to prevent startup crashes.
    fetchStateHistory: false,
    // New-thread failures should surface immediately to avoid silently
    // accumulating ghost sessions with inconsistent thread state.
    onError: isNewThread
      ? (error) => {
          throw error;
        }
      : undefined,
    onCreated(meta) {
      setThreadId(meta.thread_id);
      if (!startedRef.current) {
        onStart?.(meta.thread_id);
        startedRef.current = true;
      }
      // Refresh sidebar/history as soon as a thread is actually created,
      // instead of waiting for the whole run to finish.
      void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
    },
    onLangChainEvent(event) {
      if (event.event === "on_tool_end") {
        onToolEnd?.({
          name: event.name,
          data: event.data,
        });
      }
    },
    onCustomEvent(event: unknown) {
      if (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "task_running"
      ) {
        const e = event as {
          type: "task_running";
          task_id: string;
          message: AIMessage;
        };
        updateSubtask({ id: e.task_id, latestMessage: e.message });
      }
    },
  });

  useEffect(() => {
    const wasLoading = previousLoadingRef.current;
    if (wasLoading && !thread.isLoading) {
      void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
      if (!stopRequestedRef.current && !thread.error) {
        onFinish?.(thread.values);
      }
      stopRequestedRef.current = false;
    }
    previousLoadingRef.current = thread.isLoading;
  }, [onFinish, queryClient, thread.error, thread.isLoading, thread.values]);

  // Optimistic messages shown before the server stream responds
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  // Track message count before sending so we know when server has responded
  const prevMsgCountRef = useRef(thread.messages.length);

  // Clear optimistic when server messages arrive (count increases)
  useEffect(() => {
    if (
      optimisticMessages.length > 0 &&
      thread.messages.length > prevMsgCountRef.current
    ) {
      setOptimisticMessages([]);
    }
  }, [thread.messages.length, optimisticMessages.length]);

  const sendMessage = useCallback(
    async (
      threadId: string,
      message: PromptInputMessage,
      extraContext?: Record<string, unknown>,
    ) => {
      const text = message.text.trim();
      const implicitMentions =
        message.implicitMentions?.filter(
          (item): item is NonNullable<PromptInputMessage["implicitMentions"]>[number] =>
            Boolean(item?.mention && item?.kind && item?.value),
        ) ?? [];
      const requestedSkills = Array.from(
        new Set(
          implicitMentions
            .filter((item) => item.kind === "skill")
            .map((item) => item.value.trim())
            .filter(Boolean),
        ),
      );

      // Capture current count before showing optimistic messages
      prevMsgCountRef.current = thread.messages.length;
      stopRequestedRef.current = false;

      // Build optimistic files list with uploading status
      const optimisticFiles: FileInMessage[] = (message.files ?? []).map(
        (f) => ({
          filename: f.filename ?? "",
          size: 0,
          status: "uploading" as const,
        }),
      );

      // Create optimistic human message (shown immediately)
      const optimisticAdditionalKwargs: Record<string, unknown> = {};
      if (optimisticFiles.length > 0) {
        optimisticAdditionalKwargs.files = optimisticFiles;
      }
      if (implicitMentions.length > 0) {
        optimisticAdditionalKwargs.implicit_mentions = implicitMentions;
      }
      const optimisticHumanMsg: Message = {
        type: "human",
        id: `opt-human-${Date.now()}`,
        content: text ? [{ type: "text", text }] : "",
        additional_kwargs: optimisticAdditionalKwargs,
      };

      const newOptimistic: Message[] = [optimisticHumanMsg];
      if (optimisticFiles.length > 0) {
        // Mock AI message while files are being uploaded
        newOptimistic.push({
          type: "ai",
          id: `opt-ai-${Date.now()}`,
          content: t.uploads.uploadingFiles,
          additional_kwargs: { element: "task" },
        });
      }
      setOptimisticMessages(newOptimistic);

      queryClient.setQueriesData(
        {
          queryKey: ["threads", "search"],
          exact: false,
        },
        (oldData: Array<AgentThread> | undefined) => {
          if (!Array.isArray(oldData)) {
            return oldData;
          }
          return oldData.map((threadItem) => {
            if (
              threadItem.thread_id !== threadId ||
              threadItem.values?.clarification?.status !== "awaiting_user"
            ) {
              return threadItem;
            }
            return {
              ...threadItem,
              values: {
                ...threadItem.values,
                clarification: {
                  ...threadItem.values.clarification,
                  status: "resolved",
                  resolved_at: new Date().toISOString(),
                  resolved_by_message_id: null,
                },
              },
            };
          });
        },
      );

      let uploadedFileInfo: UploadedFileInfo[] = [];

      try {
        // Upload files first if any
        if (message.files && message.files.length > 0) {
          try {
            // Convert FileUIPart to File objects by fetching blob URLs
            const filePromises = message.files.map(async (fileUIPart) => {
              if (fileUIPart.url && fileUIPart.filename) {
                try {
                  // Fetch the blob URL to get the file data
                  const response = await fetch(fileUIPart.url);
                  const blob = await response.blob();

                  // Create a File object from the blob
                  return new File([blob], fileUIPart.filename, {
                    type: fileUIPart.mediaType || blob.type,
                  });
                } catch (error) {
                  console.error(
                    `Failed to fetch file ${fileUIPart.filename}:`,
                    error,
                  );
                  return null;
                }
              }
              return null;
            });

            const conversionResults = await Promise.all(filePromises);
            const files = conversionResults.filter(
              (file): file is File => file !== null,
            );
            const failedConversions = conversionResults.length - files.length;

            if (failedConversions > 0) {
              throw new Error(
                `Failed to prepare ${failedConversions} attachment(s) for upload. Please retry.`,
              );
            }

            if (!threadId) {
              throw new Error("Thread is not ready for file upload.");
            }

            if (files.length > 0) {
              const uploadResponse = await uploadFiles(threadId, files);
              uploadedFileInfo = uploadResponse.files;

              // Update optimistic human message with uploaded status + paths
              const uploadedFiles: FileInMessage[] = uploadedFileInfo.map(
                (info) => toFileInMessage(info),
              );
              setOptimisticMessages((messages) => {
                if (messages.length > 1 && messages[0]) {
                  const humanMessage: Message = messages[0];
                  return [
                    {
                      ...humanMessage,
                      additional_kwargs: {
                        ...(humanMessage.additional_kwargs as Record<string, unknown>),
                        files: uploadedFiles,
                      },
                    },
                    ...messages.slice(1),
                  ];
                }
                return messages;
              });
            }
          } catch (error) {
            console.error("Failed to upload files:", error);
            const errorMessage =
              error instanceof Error
                ? error.message
                : "Failed to upload files.";
            toast.error(errorMessage);
            setOptimisticMessages([]);
            throw error;
          }
        }

        // Build files metadata for submission (included in additional_kwargs)
        const filesForSubmit: FileInMessage[] = uploadedFileInfo.map(
          (info) => toFileInMessage(info),
        );

        const runtimeContext: Record<string, unknown> = {
          ...extraContext,
          ...context,
          thinking_enabled: context.mode !== "flash",
          is_plan_mode: context.mode === "pro" || context.mode === "ultra",
          subagent_enabled: context.mode === "ultra",
          user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          thread_id: threadId,
          ...(requestedSkills.length > 0 ? { requested_skills: requestedSkills } : {}),
        };

        const messageAdditionalKwargs: Record<string, unknown> = {};
        if (filesForSubmit.length > 0) {
          messageAdditionalKwargs.files = filesForSubmit;
        }
        if (implicitMentions.length > 0) {
          messageAdditionalKwargs.implicit_mentions = implicitMentions;
        }

        await thread.submit(
          {
            messages: [
              {
                type: "human",
                content: [
                  {
                    type: "text",
                    text,
                  },
                ],
                additional_kwargs: messageAdditionalKwargs,
              },
            ],
          },
          {
            threadId: threadId,
            streamSubgraphs: true,
            streamResumable: true,
            streamMode: ["values", "messages-tuple", "custom"],
            config: {
              recursion_limit: 1000,
            },
            context: runtimeContext,
          },
        );
      } catch (error) {
        setOptimisticMessages([]);
        throw error;
      }
    },
    [thread, t.uploads.uploadingFiles, context, queryClient],
  );

  const submitA2UIAction = useCallback(
    async (
      threadId: string,
      action: A2UIUserAction,
      extraContext?: Record<string, unknown>,
    ) => {
      const runtimeContext: Record<string, unknown> = {
        ...context,
        thinking_enabled: context.mode !== "flash",
        is_plan_mode: context.mode === "pro" || context.mode === "ultra",
        subagent_enabled: context.mode === "ultra",
        user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        thread_id: threadId,
        a2ui_action: {
          user_action: action,
          client_capabilities: A2UI_CLIENT_CAPABILITIES,
          // Best-effort snapshot: the A2UI renderer already resolves action.context against the
          // latest client-side data model, so this is a compact and reliable signal for the model.
          data_model_snapshot: action.context,
        },
        ...(extraContext ?? {}),
      };

      await thread.submit(
        {
          messages: [],
        },
        {
          threadId: threadId,
          streamSubgraphs: true,
          streamResumable: true,
          streamMode: ["values", "messages-tuple", "custom"],
          config: {
            recursion_limit: 1000,
          },
          context: runtimeContext,
        },
      );
    },
    [context, thread],
  );

  // Wrap stream with a safe adapter:
  // 1) merge optimistic messages
  // 2) guard lazy getters (`history` / `experimental_branchTree`) when
  //    fetchStateHistory is disabled in SDK options.
  const safeThread = useMemo<typeof thread>(() => {
    return new Proxy(thread, {
      get(target, prop, receiver) {
        if (prop === "messages") {
          if (optimisticMessages.length === 0) {
            return target.messages;
          }
          return [...target.messages, ...optimisticMessages];
        }
        if (prop === "history") {
          return [];
        }
        if (prop === "experimental_branchTree") {
          return null;
        }
        if (prop === "stop") {
          return async () => {
            stopRequestedRef.current = true;
            return target.stop();
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }, [optimisticMessages, thread]);

  return [safeThread, sendMessage, submitA2UIAction] as const;
}

export function useThreads(
  params: Parameters<ThreadsClient["search"]>[0] = {
    limit: 50,
    sortBy: "updated_at",
    sortOrder: "desc",
    select: ["thread_id", "created_at", "updated_at", "status", "values"],
  },
) {
  const apiClient = getAPIClient();
  return useQuery<AgentThread[]>({
    queryKey: ["threads", "search", params],
    queryFn: async () => {
      const maxResults = params.limit;
      const initialOffset = params.offset ?? 0;
      const defaultPageSize = 50;

      // Keep previous behavior for explicit non-positive limits.
      if (maxResults !== undefined && maxResults <= 0) {
        const response = await apiClient.threads.search<AgentThreadState>(params);
        return response as AgentThread[];
      }

      const pageSize =
        typeof maxResults === "number" && maxResults > 0
          ? Math.min(defaultPageSize, maxResults)
          : defaultPageSize;

      const allThreads: AgentThread[] = [];
      let offset = initialOffset;

      while (true) {
        if (typeof maxResults === "number" && allThreads.length >= maxResults) {
          break;
        }

        const currentLimit =
          typeof maxResults === "number"
            ? Math.min(pageSize, maxResults - allThreads.length)
            : pageSize;

        if (typeof maxResults === "number" && currentLimit <= 0) {
          break;
        }

        const response = (await apiClient.threads.search<AgentThreadState>({
          ...params,
          limit: currentLimit,
          offset,
        })) as AgentThread[];

        allThreads.push(...response);

        if (response.length < currentLimit) {
          break;
        }

        offset += response.length;
      }

      return allThreads;
    },
    refetchOnWindowFocus: false,
  });
}

export function useDeleteThread() {
  const queryClient = useQueryClient();
  const apiClient = getAPIClient();
  return useMutation({
    mutationFn: async ({ threadId }: { threadId: string }) => {
      try {
        await apiClient.threads.delete(threadId);
      } catch (error) {
        // Deletion is idempotent from frontend perspective.
        if (!isThreadNotFoundError(error)) {
          throw error;
        }
      }
    },
    onSuccess(_, { threadId }) {
      pruneThreadFromCache(queryClient, threadId);
    },
  });
}

export function useRenameThread() {
  const queryClient = useQueryClient();
  const apiClient = getAPIClient();
  return useMutation({
    mutationFn: async ({
      threadId,
      title,
    }: {
      threadId: string;
      title: string;
    }) => {
      await apiClient.threads.updateState(threadId, {
        values: { title },
      });
    },
    onSuccess(_, { threadId, title }) {
      queryClient.setQueriesData(
        {
          queryKey: ["threads", "search"],
          exact: false,
        },
        (oldData: Array<AgentThread>) => {
          return oldData.map((t) => {
            if (t.thread_id === threadId) {
              return {
                ...t,
                values: {
                  ...t.values,
                  title,
                },
              };
            }
            return t;
          });
        },
      );
    },
  });
}
