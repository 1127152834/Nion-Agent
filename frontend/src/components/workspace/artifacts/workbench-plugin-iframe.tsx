"use client";

import { AlertTriangleIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef } from "react";

import { useI18n } from "@/core/i18n/hooks";
import type {
  InstalledPlugin,
  WorkbenchContext,
  WorkbenchPackageFile,
} from "@/core/workbench";

type PluginBridgeRequest = {
  __nionWorkbenchBridge: true;
  type: "request";
  requestId: string;
  method: string;
  params?: Record<string, unknown>;
};

type PluginBridgeDispose = {
  __nionWorkbenchBridge: true;
  type: "dispose";
};

type PluginBridgeMessage = PluginBridgeRequest | PluginBridgeDispose;

const RESOURCE_ATTRS = ["src", "href", "poster"] as const;
const HOST_THEME_TOKEN_KEYS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "border",
  "muted",
  "muted-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "accent",
  "accent-foreground",
  "input",
] as const;

type WorkbenchHostThemeSnapshot = {
  mode: "light" | "dark";
  colorScheme: "light" | "dark";
  tokens: Record<string, string>;
};

function collectHostThemeSnapshot(resolvedTheme: string | undefined): WorkbenchHostThemeSnapshot {
  const mode = resolvedTheme === "dark" ? "dark" : "light";
  const tokens: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const computed = window.getComputedStyle(document.documentElement);
    for (const token of HOST_THEME_TOKEN_KEYS) {
      const value = computed.getPropertyValue(`--${token}`).trim();
      if (value) {
        tokens[token] = value;
      }
    }
  }
  return {
    mode,
    colorScheme: mode,
    tokens,
  };
}

function mimeTypeByPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
  if (lower.endsWith(".css")) return "text/css";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  return "text/plain";
}

function encodeTextDataURL(content: string, mimeType: string): string {
  const utf8 = new TextEncoder().encode(content);
  let binary = "";
  for (const byte of utf8) {
    binary += String.fromCharCode(byte);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function decodeBase64ToBytes(content: string): Uint8Array {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeTextContent(file: WorkbenchPackageFile): string {
  if (file.encoding === "text") {
    return file.content;
  }
  const bytes = decodeBase64ToBytes(file.content);
  return new TextDecoder().decode(bytes);
}

function toDataURL(filePath: string, file: WorkbenchPackageFile): string {
  const mimeType = mimeTypeByPath(filePath);
  if (file.encoding === "base64") {
    return `data:${mimeType};base64,${file.content}`;
  }
  return encodeTextDataURL(file.content, mimeType);
}

function normalizeSegments(input: string): string[] {
  const raw = input.replace(/\\/g, "/").split("/");
  const result: string[] = [];
  for (const seg of raw) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      result.pop();
      continue;
    }
    result.push(seg);
  }
  return result;
}

function resolveRelativePath(from: string, relative: string): string {
  const baseSegments = normalizeSegments(from);
  baseSegments.pop();
  const joined = [...baseSegments, ...normalizeSegments(relative)];
  return joined.join("/");
}

function isRelativeResource(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return false;
  if (lower.startsWith("data:") || lower.startsWith("blob:")) return false;
  if (lower.startsWith("/") || lower.startsWith("#")) return false;
  return true;
}

function rewriteCssUrls(cssText: string, filePath: string, fileDataUrls: Map<string, string>): string {
  return cssText.replace(/url\(([^)]+)\)/g, (full, rawUrl) => {
    const candidate = String(rawUrl ?? "").trim().replace(/^['"]|['"]$/g, "");
    if (!isRelativeResource(candidate)) {
      return full;
    }
    const resolved = resolveRelativePath(filePath, candidate);
    const mapped = fileDataUrls.get(resolved);
    if (!mapped) {
      return full;
    }
    return `url("${mapped}")`;
  });
}

function renderPluginEntryHtml(files: Map<string, WorkbenchPackageFile>, entryPath: string): string {
  const entryFile = files.get(entryPath);
  if (!entryFile) {
    return "";
  }
  const entryHtml = decodeTextContent(entryFile);

  const normalizedFileContents = new Map<string, WorkbenchPackageFile>();
  for (const [path, content] of files.entries()) {
    normalizedFileContents.set(path, content);
  }

  const fileDataUrls = new Map<string, string>();
  for (const [path, content] of normalizedFileContents.entries()) {
    fileDataUrls.set(path, toDataURL(path, content));
  }
  for (const [path, content] of normalizedFileContents.entries()) {
    if (!path.toLowerCase().endsWith(".css")) continue;
    const rewritten = rewriteCssUrls(decodeTextContent(content), path, fileDataUrls);
    fileDataUrls.set(path, encodeTextDataURL(rewritten, "text/css"));
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(entryHtml, "text/html");
  const allElements = Array.from(doc.querySelectorAll("*"));
  for (const el of allElements) {
    for (const attr of RESOURCE_ATTRS) {
      const raw = el.getAttribute(attr);
      if (!raw || !isRelativeResource(raw)) continue;
      const resolved = resolveRelativePath(entryPath, raw);
      const mapped = fileDataUrls.get(resolved);
      if (mapped) {
        el.setAttribute(attr, mapped);
      }
    }
    if (el.tagName.toLowerCase() === "style" && el.textContent) {
      el.textContent = rewriteCssUrls(el.textContent, entryPath, fileDataUrls);
    }
  }

  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

function injectBridge(entryHtml: string, payload: {
  pluginId: string;
  threadId: string;
  artifactPath: string;
  files: string[];
  theme?: WorkbenchHostThemeSnapshot;
}) {
  const hostStyle = `
<style id="nion-workbench-slot-host-style">
  html, body {
    background: transparent !important;
  }
</style>
`;
  const bridgeScript = `
<script>
(() => {
  const payload = ${JSON.stringify(payload)};
  const pending = new Map();
  const streamHandlers = new Map();

  function send(message) {
    window.parent.postMessage(message, "*");
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.__nionWorkbenchBridge !== true) return;

    if (data.type === "response") {
      const pendingItem = pending.get(data.requestId);
      if (!pendingItem) return;
      pending.delete(data.requestId);
      if (data.ok) {
        pendingItem.resolve(data.result);
      } else {
        pendingItem.reject(new Error(data.error || "Workbench bridge request failed"));
      }
      return;
    }

    if (data.type === "stream_event") {
      const handler = streamHandlers.get(data.streamId);
      if (handler) {
        handler(data.event, data.payload || {});
      }
    }
  });

  function call(method, params) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      send({
        __nionWorkbenchBridge: true,
        type: "request",
        requestId,
        method,
        params,
      });
    });
  }

  async function startLogStream(sessionId, onEvent) {
    const streamId = crypto.randomUUID();
    streamHandlers.set(streamId, onEvent);
    await call("streamLogs.start", { sessionId, streamId });
    return async () => {
      streamHandlers.delete(streamId);
      await call("streamLogs.stop", { streamId });
    };
  }

  window.NionWorkbench = {
    pluginId: payload.pluginId,
    threadId: payload.threadId,
    artifactPath: payload.artifactPath,
    files: payload.files,
    theme: payload.theme || null,
    call,
    startLogStream,
  };

  send({
    __nionWorkbenchBridge: true,
    type: "ready",
    pluginId: payload.pluginId,
    threadId: payload.threadId,
  });

  window.addEventListener("beforeunload", () => {
    send({
      __nionWorkbenchBridge: true,
      type: "dispose",
    });
  });
})();
</script>
`;

  // Inject bridge as early as possible so plugin scripts can use window.NionWorkbench
  // during initial evaluation (some plugins run bootstrap logic in <head> scripts).
  if (entryHtml.includes("<head>")) {
    return entryHtml.replace("<head>", `<head>\n${hostStyle}\n${bridgeScript}\n`);
  }
  if (entryHtml.includes("<body>")) {
    return entryHtml.replace("<body>", `<body>\n${hostStyle}\n${bridgeScript}\n`);
  }
  if (entryHtml.includes("</body>")) {
    return entryHtml.replace("</body>", `${hostStyle}\n${bridgeScript}\n</body>`);
  }
  return `${hostStyle}\n${bridgeScript}\n${entryHtml}`;
}

export function WorkbenchPluginIframe({
  plugin,
  files,
  context,
}: {
  plugin: InstalledPlugin;
  files: Map<string, WorkbenchPackageFile>;
  context: WorkbenchContext;
}) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const streamDisposersRef = useRef<Map<string, () => void>>(new Map());
  const ownedSessionsRef = useRef<Set<string>>(new Set());
  const hostTheme = useMemo(
    () => collectHostThemeSnapshot(resolvedTheme),
    [resolvedTheme],
  );

  const srcDoc = useMemo(() => {
    const entry = renderPluginEntryHtml(files, plugin.manifest.entry);
    if (!entry) {
      return "";
    }

    const filePayload = Array.from(files.keys());
    return injectBridge(entry, {
      pluginId: plugin.manifest.id,
      threadId: context.threadId,
      artifactPath: context.artifact.path,
      files: filePayload,
      theme: hostTheme,
    });
  }, [
    context.artifact.path,
    context.threadId,
    files,
    hostTheme,
    plugin.manifest.entry,
    plugin.manifest.id,
  ]);

  useEffect(() => {
    const stopOwnedSessions = () => {
      const sessionIds = Array.from(ownedSessionsRef.current);
      ownedSessionsRef.current.clear();
      void Promise.allSettled(sessionIds.map((sid) => context.stopCommand(sid)));
    };

    const stopStreams = () => {
      for (const dispose of streamDisposersRef.current.values()) {
        dispose();
      }
      streamDisposersRef.current.clear();
    };

    const onMessage = (event: MessageEvent<PluginBridgeMessage>) => {
      void (async () => {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (!iframeWindow || event.source !== iframeWindow) {
        return;
      }
      const data = event.data;
      if (data?.__nionWorkbenchBridge !== true) {
        return;
      }

      if (data.type === "dispose") {
        stopStreams();
        stopOwnedSessions();
        return;
      }

      if (data.type !== "request") {
        return;
      }

      const { requestId, method, params = {} } = data;
      const readString = (key: string) => (typeof params[key] === "string" ? params[key] : "");
      const postResponse = (ok: boolean, result?: unknown, error?: string) => {
        iframeWindow.postMessage(
          {
            __nionWorkbenchBridge: true,
            type: "response",
            requestId,
            ok,
            result,
            error,
          },
          "*",
        );
      };

      try {
        if (method === "readFile") {
          postResponse(true, await context.readFile(readString("path")));
          return;
        }
        if (method === "writeFile") {
          await context.writeFile(readString("path"), readString("content"));
          postResponse(true, { success: true });
          return;
        }
        if (method === "readBinaryFile") {
          postResponse(true, await context.readBinaryFile(readString("path")));
          return;
        }
        if (method === "writeBinaryFile") {
          await context.writeBinaryFile(
            readString("path"),
            readString("dataUrl"),
            typeof params.mimeType === "string" ? params.mimeType : undefined,
          );
          postResponse(true, { success: true });
          return;
        }
        if (method === "deleteFile") {
          await context.deleteFile(readString("path"));
          postResponse(true, { success: true });
          return;
        }
        if (method === "listFiles") {
          postResponse(true, await context.listFiles(readString("dir")));
          return;
        }
        if (method === "readDir") {
          postResponse(true, await context.readDir(readString("path")));
          return;
        }
        if (method === "runCommand") {
          const result = await context.runCommand({
            command: readString("command"),
            cwd: typeof params.cwd === "string" ? params.cwd : undefined,
            timeoutSeconds:
              typeof params.timeoutSeconds === "number"
                ? params.timeoutSeconds
                : undefined,
          });
          if (result.sessionId) {
            ownedSessionsRef.current.add(result.sessionId);
          }
          postResponse(true, result);
          return;
        }
        if (method === "stopCommand") {
          const sessionId = readString("sessionId");
          await context.stopCommand(sessionId);
          ownedSessionsRef.current.delete(sessionId);
          postResponse(true, { success: true });
          return;
        }
        if (method === "streamLogs.start") {
          const sessionId = readString("sessionId");
          const streamId = readString("streamId");
          const dispose = context.streamLogs(sessionId, ({ event: eventName, payload }) => {
            iframeWindow.postMessage(
              {
                __nionWorkbenchBridge: true,
                type: "stream_event",
                streamId,
                event: eventName,
                payload,
              },
              "*",
            );
          });
          streamDisposersRef.current.set(streamId, dispose);
          postResponse(true, { success: true });
          return;
        }
        if (method === "streamLogs.stop") {
          const streamId = readString("streamId");
          const dispose = streamDisposersRef.current.get(streamId);
          if (dispose) {
            dispose();
            streamDisposersRef.current.delete(streamId);
          }
          postResponse(true, { success: true });
          return;
        }
        if (method === "toast") {
          const message = readString("message");
          const toastType = params.type === "success" || params.type === "error" || params.type === "info"
            ? params.type
            : "info";
          context.toast(message, toastType);
          postResponse(true, { success: true });
          return;
        }
        if (method === "openPreview") {
          const target = readString("url");
          window.open(target, "_blank", "noopener,noreferrer");
          postResponse(true, { success: true });
          return;
        }
        if (method === "persistState.get") {
          postResponse(true, await context.storage.get(readString("key")));
          return;
        }
        if (method === "persistState.set") {
          await context.storage.set(readString("key"), params.value);
          postResponse(true, { success: true });
          return;
        }
        if (method === "persistState.remove") {
          await context.storage.remove(readString("key"));
          postResponse(true, { success: true });
          return;
        }

        postResponse(false, null, `Unsupported bridge method: ${method}`);
      } catch (error) {
        postResponse(
          false,
          null,
          error instanceof Error ? error.message : "Bridge request failed",
        );
      }
      })();
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      for (const dispose of streamDisposersRef.current.values()) dispose();
      streamDisposersRef.current.clear();
      const sessionIds = Array.from(ownedSessionsRef.current);
      ownedSessionsRef.current.clear();
      void Promise.allSettled(sessionIds.map((sid) => context.stopCommand(sid)));
    };
  }, [context]);

  if (!srcDoc) {
    return (
      <div className="flex h-full w-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <AlertTriangleIcon className="size-4" />
        <span>{t.workspace.artifactPanel.pluginEntryMissing}</span>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      className="size-full border-0"
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-forms"
      title={`workbench-plugin:${plugin.manifest.id}`}
    />
  );
}
