import { DownloadIcon, EyeIcon, FileTextIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";

import { Button } from "@/components/ui/button";
import { streamdownPlugins } from "@/core/streamdown";
import type { WorkbenchContext, WorkbenchPlugin } from "@/core/workbench";

const DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "csv",
]);

function getExtension(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function toArtifactUrl(threadId: string, path: string): string {
  const normalized = path.replace(/^\/+/, "");
  return `/api/threads/${threadId}/artifacts/${normalized}`;
}

function parseCsvPreview(raw: string): string[][] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 101);
  return lines.map((line) => line.split(",").map((cell) => cell.trim()));
}

function DocumentPreviewPanel({ context }: { context: WorkbenchContext }) {
  const artifactPath = context.artifact.path;
  const ext = useMemo(() => getExtension(artifactPath), [artifactPath]);
  const artifactUrl = useMemo(
    () => toArtifactUrl(context.threadId, artifactPath),
    [artifactPath, context.threadId],
  );
  const [mode, setMode] = useState<"loading" | "markdown" | "csv" | "fallback">("loading");
  const [markdownContent, setMarkdownContent] = useState("");
  const [csvRows, setCsvRows] = useState<string[][]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setMode("loading");
      setMarkdownContent("");
      setCsvRows([]);

      const markdownCandidate = artifactPath.replace(/\.[^./]+$/, ".md");
      if (markdownCandidate !== artifactPath) {
        try {
          const markdown = await context.readFile(markdownCandidate);
          if (!cancelled && markdown.trim()) {
            setMarkdownContent(markdown);
            setMode("markdown");
            return;
          }
        } catch {
          // fall through
        }
      }

      if (ext === "csv") {
        try {
          const csv = await context.readFile(artifactPath);
          if (!cancelled && csv.trim()) {
            setCsvRows(parseCsvPreview(csv));
            setMode("csv");
            return;
          }
        } catch {
          // fall through
        }
      }

      if (!cancelled) {
        setMode("fallback");
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [artifactPath, context, ext]);

  return (
    <div className="flex size-full min-h-0 flex-col">
      <div className="bg-background/80 flex items-center justify-between border-b px-3 py-2">
        <div className="text-muted-foreground inline-flex items-center gap-1 text-xs">
          <FileTextIcon className="size-3.5" />
          <span>{artifactPath}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" asChild>
            <a href={artifactUrl} target="_blank" rel="noopener noreferrer">
              <SquareArrowOutUpRightIcon className="size-3.5" />
            </a>
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={`${artifactUrl}?download=true`} target="_blank" rel="noopener noreferrer">
              <DownloadIcon className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "loading" ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
            <EyeIcon className="size-4 animate-pulse" />
            <span>Loading preview...</span>
          </div>
        ) : null}

        {mode === "markdown" ? (
          <div className="size-full px-4 py-3">
            <Streamdown className="size-full" {...streamdownPlugins}>
              {markdownContent}
            </Streamdown>
          </div>
        ) : null}

        {mode === "csv" ? (
          <div className="p-3">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {csvRows.map((row, rowIndex) => (
                  <tr key={`row-${rowIndex}`} className="border-b">
                    {row.map((cell, cellIndex) => (
                      <td key={`row-${rowIndex}-cell-${cellIndex}`} className="px-2 py-1 align-top">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {mode === "fallback" ? (
          <iframe className="size-full" src={artifactUrl} />
        ) : null}
      </div>
    </div>
  );
}

const DocumentPreviewPlugin: WorkbenchPlugin = {
  id: "builtin-document-preview",
  name: "Document Preview",
  description: "Preview PDF/Office/CSV artifacts with markdown-first fallback.",
  icon: FileTextIcon,
  canHandle(artifact) {
    const extension = getExtension(artifact.path);
    if (!DOCUMENT_EXTENSIONS.has(extension)) {
      return false;
    }
    return 90;
  },
  render(context) {
    return <DocumentPreviewPanel context={context} />;
  },
};

export default DocumentPreviewPlugin;
