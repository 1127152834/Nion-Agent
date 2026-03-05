import { toast } from "sonner";

import type {
  Artifact,
  DialogOptions,
  WorkbenchAction,
  WorkbenchContext,
} from "./types";

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

    // File operations
    async readFile(path: string): Promise<string> {
      const response = await fetch(`/api/threads/${threadId}/artifacts/${path}`);
      if (!response.ok) {
        throw new Error(`Failed to read file: ${response.statusText}`);
      }
      return response.text();
    },

    async writeFile(path: string, content: string): Promise<void> {
      const response = await fetch(`/api/threads/${threadId}/artifacts/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: content,
      });
      if (!response.ok) {
        throw new Error(`Failed to write file: ${response.statusText}`);
      }
    },

    async deleteFile(path: string): Promise<void> {
      const response = await fetch(`/api/threads/${threadId}/artifacts/${path}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Failed to delete file: ${response.statusText}`);
      }
    },

    async listFiles(dir: string): Promise<string[]> {
      const response = await fetch(
        `/api/threads/${threadId}/artifacts?dir=${encodeURIComponent(dir)}`,
      );
      if (!response.ok) {
        throw new Error(`Failed to list files: ${response.statusText}`);
      }
      const data = await response.json();
      return data.files || [];
    },

    // Network
    fetch: window.fetch.bind(window),

    // UI operations
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
      // This will be implemented by the workbench UI component
      // For now, just log it
      console.log("Add action:", action);
    },

    // Storage
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
