"use client";

import type { Message } from "@langchain/langgraph-sdk";
import {
  A2UIProvider,
  A2UIRenderer,
  type A2UIMessage,
} from "@a2ui-sdk/react/0.8";
import React, { useMemo } from "react";

import type { A2UIUserAction } from "@/core/a2ui/types";
import { extractA2UISurfacePayload } from "@/core/messages/utils";
import { cn } from "@/lib/utils";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function parseJSONIfString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const text = value.trim();
  if (!text) {
    return value;
  }
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

type DataEntry = {
  key: string;
  valueString?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueMap?: DataEntry[];
};

function objectToDataEntries(value: Record<string, unknown>): DataEntry[] {
  const entries: DataEntry[] = [];
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = coerceString(key);
    if (!normalizedKey) {
      continue;
    }

    if (typeof raw === "string") {
      entries.push({ key: normalizedKey, valueString: raw });
      continue;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      entries.push({ key: normalizedKey, valueNumber: raw });
      continue;
    }
    if (typeof raw === "boolean") {
      entries.push({ key: normalizedKey, valueBoolean: raw });
      continue;
    }
    if (isRecord(raw)) {
      entries.push({ key: normalizedKey, valueMap: objectToDataEntries(raw) });
      continue;
    }
  }
  return entries;
}

function normalizeA2UIMessages(operations: unknown[]): A2UIMessage[] | null {
  const normalized: A2UIMessage[] = [];
  let hasBeginRendering = false;
  let hasSurfaceUpdate = false;

  type SurfaceUpdatePayload = Exclude<A2UIMessage["surfaceUpdate"], undefined>;
  type DataModelUpdatePayload = Exclude<A2UIMessage["dataModelUpdate"], undefined>;

  for (const rawOperation of operations) {
    if (!isRecord(rawOperation)) {
      continue;
    }

    const operation = rawOperation as Record<string, unknown>;

    if (isRecord(operation.beginRendering)) {
      const payload = operation.beginRendering as Record<string, unknown>;
      const surfaceId =
        coerceString(payload.surfaceId) ?? coerceString(payload.surface_id);
      const root = coerceString(payload.root);
      if (!surfaceId || !root) {
        continue;
      }
      const catalogId =
        coerceString(payload.catalogId) ?? coerceString(payload.catalog_id);
      const styles = isRecord(payload.styles) ? payload.styles : undefined;

      normalized.push({
        beginRendering: {
          surfaceId,
          root,
          ...(catalogId ? { catalogId } : {}),
          ...(styles ? { styles: styles as Record<string, unknown> } : {}),
        },
      });
      hasBeginRendering = true;
      continue;
    }

    if (isRecord(operation.surfaceUpdate)) {
      const payload = operation.surfaceUpdate as Record<string, unknown>;
      const surfaceId =
        coerceString(payload.surfaceId) ?? coerceString(payload.surface_id);
      if (!surfaceId) {
        continue;
      }

      const rawComponents = parseJSONIfString(payload.components ?? payload.contents);
      let components: unknown = rawComponents;
      if (isRecord(rawComponents)) {
        // Common model mistake: emit a map keyed by component id.
        components = Object.entries(rawComponents)
          .map(([id, value]) => {
            if (!isRecord(value)) {
              return null;
            }
            if (coerceString(value.id)) {
              return value;
            }
            return { id, ...value };
          })
          .filter(Boolean);
      }

      if (!Array.isArray(components) || components.length === 0) {
        continue;
      }

      normalized.push({
        surfaceUpdate: {
          surfaceId,
          components: components.filter(isRecord) as unknown as SurfaceUpdatePayload["components"],
        },
      });
      hasSurfaceUpdate = true;
      continue;
    }

    if (isRecord(operation.dataModelUpdate)) {
      const payload = operation.dataModelUpdate as Record<string, unknown>;
      const surfaceId =
        coerceString(payload.surfaceId) ?? coerceString(payload.surface_id);
      if (!surfaceId) {
        continue;
      }

      const rawContents = parseJSONIfString(payload.contents ?? payload.content);
      let contents: unknown = rawContents;
      if (isRecord(rawContents)) {
        contents = objectToDataEntries(rawContents);
      }

      if (!Array.isArray(contents)) {
        // IMPORTANT: @a2ui-sdk/react will crash when dataModelUpdate.contents is not an array.
        // Drop this message to keep the chat UI resilient.
        continue;
      }

      normalized.push({
        dataModelUpdate: {
          surfaceId,
          path: coerceString(payload.path) ?? undefined,
          contents: contents.filter(isRecord) as unknown as DataModelUpdatePayload["contents"],
        },
      });
      continue;
    }

    if (isRecord(operation.deleteSurface)) {
      const payload = operation.deleteSurface as Record<string, unknown>;
      const surfaceId =
        coerceString(payload.surfaceId) ?? coerceString(payload.surface_id);
      if (!surfaceId) {
        continue;
      }
      normalized.push({
        deleteSurface: {
          surfaceId,
        },
      });
      continue;
    }
  }

  if (!hasBeginRendering || !hasSurfaceUpdate) {
    return null;
  }
  return normalized;
}

function safeJSONStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

class A2UIRenderErrorBoundary extends React.Component<
  React.PropsWithChildren<{ rawOperations: unknown[]; className?: string }>,
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className={cn(
            "bg-background/60 w-full rounded-xl border p-4",
            this.props.className,
          )}
        >
          <div className="text-sm font-medium">A2UI 渲染失败</div>
          <div className="text-muted-foreground mt-1 text-xs leading-5">
            {this.state.error.message || "Unknown error"}
          </div>
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer select-none text-xs">
              查看 A2UI payload
            </summary>
            <pre className="bg-background mt-2 max-h-72 overflow-auto rounded border p-3 whitespace-pre-wrap">
              {safeJSONStringify(this.props.rawOperations)}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

export function A2UICard({
  className,
  message,
  isLoading,
  onAction,
}: {
  className?: string;
  message: Message;
  isLoading: boolean;
  onAction?: (action: A2UIUserAction) => void;
}) {
  const payload = useMemo(() => extractA2UISurfacePayload(message), [message]);
  const operations = payload?.operations ?? null;
  const errorMessage = useMemo(() => {
    if (!payload) return null;
    const error = typeof payload.error === "string" ? payload.error.trim() : "";
    return error ? error : null;
  }, [payload]);

  const a2uiMessages = useMemo(() => {
    if (!Array.isArray(operations) || operations.length === 0) {
      return null;
    }
    // The backend treats A2UI operations as untrusted JSON; normalize into strict A2UIMessage shapes
    // so the renderer can't crash the whole page on malformed payloads.
    return normalizeA2UIMessages(operations);
  }, [operations]);

  if (!Array.isArray(operations) || operations.length === 0) {
    return (
      <div className={cn("bg-background/60 w-full rounded-xl border p-4", className)}>
        <div className="text-sm font-medium">A2UI payload 缺失</div>
        <div className="text-muted-foreground mt-1 text-xs leading-5">
          后端返回了 A2UI 卡片，但未包含可渲染的 operations。请重试或检查服务端日志。
        </div>
        {errorMessage && (
          <div className="text-destructive mt-2 text-xs leading-5">
            {errorMessage}
          </div>
        )}
      </div>
    );
  }

  return (
    <A2UIRenderErrorBoundary rawOperations={operations} className={className}>
      {a2uiMessages ? (
        <div className={cn("bg-background/60 w-full rounded-xl border p-4", className)}>
          <A2UIProvider messages={a2uiMessages}>
            <A2UIRenderer
              onAction={(action) => {
                if (isLoading) {
                  return;
                }
                onAction?.({ ...action, timestamp: new Date().toISOString() } as A2UIUserAction);
              }}
            />
          </A2UIProvider>
        </div>
      ) : (
        <div className={cn("bg-background/60 w-full rounded-xl border p-4", className)}>
          <div className="text-sm font-medium">A2UI payload 不可渲染</div>
          <div className="text-muted-foreground mt-1 text-xs leading-5">
            A2UI operations 不符合 v0.8 协议（常见原因：dataModelUpdate.contents 不是数组）。
            已降级展示 raw payload，方便排查并让模型重试生成。
          </div>
          {errorMessage && (
            <div className="text-destructive mt-2 text-xs leading-5">
              {errorMessage}
            </div>
          )}
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer select-none text-xs">
              查看 A2UI payload
            </summary>
            <pre className="bg-background mt-2 max-h-72 overflow-auto rounded border p-3 whitespace-pre-wrap">
              {safeJSONStringify(operations)}
            </pre>
          </details>
        </div>
      )}
    </A2UIRenderErrorBoundary>
  );
}
