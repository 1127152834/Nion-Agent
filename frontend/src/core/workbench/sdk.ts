import { toast } from "sonner";

import { getBackendBaseURL } from "@/core/config";

import type {
  Artifact,
  DialogOptions,
  WorkbenchAction,
  WorkbenchContext,
} from "./types";

function normalizeVirtualPath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/");
  const withPrefix = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withPrefix.startsWith("/mnt/user-data")) {
    return withPrefix;
  }
  // Keep backward compatibility: if caller passes relative path, assume outputs.
  return `/mnt/user-data/outputs/${withPrefix.replace(/^\/+/, "")}`;
}

function normalizeDirPath(path: string): string {
  const normalized = normalizeVirtualPath(path);
  return normalized.replace(/\/+$/, "") || "/mnt/user-data";
}

function pathDepth(path: string): number {
  return path.replace(/\/+$/, "").split("/").filter(Boolean).length;
}

function normalizeTimeoutSeconds(timeoutSeconds?: number): number {
  // Keep client-side bounds aligned with backend validation (1..1800).
  if (!Number.isFinite(timeoutSeconds)) {
    return 600;
  }
  const value = Math.trunc(timeoutSeconds as number);
  if (value < 1) return 1;
  if (value > 1800) return 1800;
  return value;
}

function artifactApiURL(threadId: string, path: string): string {
  const normalized = normalizeVirtualPath(path).replace(/^\/+/, "");
  return `${getBackendBaseURL()}/api/threads/${threadId}/artifacts/${normalized}`;
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to convert blob to data URL"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Create a workbench context for a plugin
 */
export function createWorkbenchContext(
  artifact: Artifact,
  threadId: string,
): WorkbenchContext {
  return {
    artifact,
    threadId,

    async readFile(path: string): Promise<string> {
      const response = await fetch(artifactApiURL(threadId, path));
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Failed to read file: ${response.statusText}`);
      }
      return response.text();
    },

    async writeFile(path: string, content: string): Promise<void> {
      const response = await fetch(artifactApiURL(threadId, path), {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: content,
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Failed to write file: ${response.statusText}`);
      }
    },

    async readBinaryFile(path: string): Promise<{ dataUrl: string; mimeType: string }> {
      const response = await fetch(artifactApiURL(threadId, path));
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Failed to read binary file: ${response.statusText}`);
      }
      const blob = await response.blob();
      return {
        dataUrl: await blobToDataURL(blob),
        mimeType: blob.type || "application/octet-stream",
      };
    },

    async writeBinaryFile(path: string, dataUrl: string, mimeType?: string): Promise<void> {
      const binaryResponse = await fetch(dataUrl);
      if (!binaryResponse.ok) {
        throw new Error("Failed to decode binary payload from data URL");
      }
      const blob = await binaryResponse.blob();
      const contentType = mimeType || blob.type || "application/octet-stream";
      const response = await fetch(artifactApiURL(threadId, path), {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: blob,
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Failed to write binary file: ${response.statusText}`);
      }
    },

    async deleteFile(path: string): Promise<void> {
      const response = await fetch(artifactApiURL(threadId, path), {
        method: "DELETE",
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Failed to delete file: ${response.statusText}`);
      }
    },

    async listFiles(dir: string): Promise<string[]> {
      const normalizedDir = normalizeVirtualPath(dir);
      const response = await fetch(
        `${getBackendBaseURL()}/api/threads/${threadId}/artifacts?dir=${encodeURIComponent(normalizedDir)}`,
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Failed to list files: ${response.statusText}`);
      }
      const data = (await response.json()) as { files?: string[] };
      return data.files ?? [];
    },

    async readDir(path: string): Promise<string[]> {
      const normalizedPath = normalizeDirPath(path);
      const response = await fetch(
        `${getBackendBaseURL()}/api/threads/${threadId}/workspace/tree?root=${encodeURIComponent(normalizedPath)}&depth=1`,
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Failed to read directory: ${response.statusText}`);
      }
      const payload = (await response.json()) as {
        directories?: Array<{ path: string }>;
        files?: Array<{ path: string }>;
      };
      const rootPrefix = `${normalizedPath}/`;
      const expectedDepth = pathDepth(normalizedPath) + 1;
      const isDirectChild = (candidate: string) => {
        if (!candidate.startsWith(rootPrefix)) {
          return false;
        }
        return pathDepth(candidate) === expectedDepth;
      };

      const entries = new Set<string>();
      for (const dir of payload.directories ?? []) {
        if (isDirectChild(dir.path)) {
          entries.add(`${dir.path}/`);
        }
      }
      for (const file of payload.files ?? []) {
        if (isDirectChild(file.path)) {
          entries.add(file.path);
        }
      }
      return Array.from(entries).sort((a, b) => a.localeCompare(b));
    },

    async runCommand(args: {
      command: string;
      cwd?: string;
      timeoutSeconds?: number;
    }): Promise<{ sessionId: string }> {
      const response = await fetch(
        `${getBackendBaseURL()}/api/threads/${threadId}/workbench/sessions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: args.command,
            cwd: args.cwd ?? "/mnt/user-data/workspace",
            timeout_seconds: normalizeTimeoutSeconds(args.timeoutSeconds),
          }),
        },
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Failed to run command: ${response.statusText}`);
      }
      const data = (await response.json()) as { session_id: string };
      return { sessionId: data.session_id };
    },

    async stopCommand(sessionId: string): Promise<void> {
      const response = await fetch(
        `${getBackendBaseURL()}/api/threads/${threadId}/workbench/sessions/${sessionId}/stop`,
        {
          method: "POST",
        },
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Failed to stop command: ${response.statusText}`);
      }
    },

    streamLogs(
      sessionId: string,
      onEvent: (event: { event: string; payload: Record<string, unknown> }) => void,
    ): () => void {
      const source = new EventSource(
        `${getBackendBaseURL()}/api/threads/${threadId}/workbench/sessions/${sessionId}/stream`,
      );
      const handler = (eventName: string) => (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data) as Record<string, unknown>;
          onEvent({ event: eventName, payload });
        } catch {
          onEvent({ event: eventName, payload: { raw: event.data } });
        }
      };

      source.addEventListener("ready", handler("ready"));
      source.addEventListener("stdout", handler("stdout"));
      source.addEventListener("stderr", handler("stderr"));
      source.addEventListener("exit", handler("exit"));
      source.addEventListener("heartbeat", handler("heartbeat"));
      source.onerror = () => {
        onEvent({ event: "error", payload: { message: "log stream disconnected" } });
      };

      return () => {
        source.close();
      };
    },

    fetch: window.fetch.bind(window),

    toast(message: string, type: "success" | "error" | "info" = "info"): void {
      if (type === "success") {
        toast.success(message);
      } else if (type === "error") {
        toast.error(message);
      } else {
        toast(message);
      }
    },

    async dialog(options: DialogOptions): Promise<boolean> {
      return new Promise((resolve) => {
        const confirmed = window.confirm(
          `${options.title}\n\n${options.message}`,
        );
        resolve(confirmed);
      });
    },

    addAction(action: WorkbenchAction): void {
      console.log("Add action:", action);
    },

    storage: {
      async get(key: string): Promise<unknown> {
        const value = localStorage.getItem(`workbench:${key}`);
        return value ? JSON.parse(value) : null;
      },

      async set(key: string, value: unknown): Promise<void> {
        localStorage.setItem(`workbench:${key}`, JSON.stringify(value));
      },

      async remove(key: string): Promise<void> {
        localStorage.removeItem(`workbench:${key}`);
      },
    },
  };
}
