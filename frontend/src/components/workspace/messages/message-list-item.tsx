import type { Message } from "@langchain/langgraph-sdk";
import { DownloadIcon, FileIcon, Loader2Icon, SquareArrowOutUpRightIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { Fragment, memo, useMemo, useState, type ImgHTMLAttributes } from "react";
import rehypeKatex from "rehype-katex";

import { Loader } from "@/components/ai-elements/loader";
import {
  Message as AIElementMessage,
  MessageContent as AIElementMessageContent,
  MessageResponse as AIElementMessageResponse,
  MessageToolbar,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Task, TaskTrigger } from "@/components/ai-elements/task";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { resolveArtifactURL } from "@/core/artifacts/utils";
import { useI18n } from "@/core/i18n/hooks";
import {
  extractContentFromMessage,
  extractReasoningContentFromMessage,
  isImplicitMention,
  type ImplicitMention,
  parseUploadedFiles,
  stripImplicitMentionSuffix,
  stripUploadedFilesTag,
  summarizeImplicitMentions,
  type FileInMessage,
} from "@/core/messages/utils";
import { useRehypeSplitWordsIntoSpans } from "@/core/rehype";
import { humanMessagePlugins } from "@/core/streamdown";
import { cn } from "@/lib/utils";

import { CopyButton } from "../copy-button";

import { MarkdownContent } from "./markdown-content";

export function MessageListItem({
  className,
  message,
  isLoading,
}: {
  className?: string;
  message: Message;
  isLoading?: boolean;
}) {
  const isHuman = message.type === "human";
  const clipboardData = useMemo(() => {
    const content = extractContentFromMessage(message);
    const reasoning = extractReasoningContentFromMessage(message);
    const baseText = content.trim() ? content : (reasoning ?? "");
    if (!isHuman) {
      return baseText;
    }

    const rawMentions = message.additional_kwargs?.implicit_mentions;
    const implicitMentions = Array.isArray(rawMentions)
      ? rawMentions.filter(isImplicitMention)
      : ([] as ImplicitMention[]);

    const stripped = baseText ? stripUploadedFilesTag(baseText) : "";
    return stripImplicitMentionSuffix(stripped, implicitMentions);
  }, [isHuman, message]);

  return (
    <AIElementMessage
      className={cn("group/conversation-message relative w-full", className)}
      from={isHuman ? "user" : "assistant"}
    >
      <MessageContent
        className={isHuman ? "w-fit" : "w-full"}
        message={message}
        isLoading={isLoading}
      />
      {!isLoading && (
        <MessageToolbar
          className={cn(
            isHuman ? "-bottom-9 justify-end" : "-bottom-8",
            "absolute right-0 left-0 z-20 opacity-0 transition-opacity delay-200 duration-300 group-hover/conversation-message:opacity-100",
          )}
        >
          <div className="flex gap-1">
            <CopyButton
              clipboardData={
                clipboardData
              }
            />
          </div>
        </MessageToolbar>
      )}
    </AIElementMessage>
  );
}

/**
 * Custom image component that handles artifact URLs
 */
function MessageImage({
  src,
  alt,
  threadId,
  maxWidth = "90%",
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  threadId: string;
  maxWidth?: string;
}) {
  const { t } = useI18n();
  const [previewOpen, setPreviewOpen] = useState(false);
  if (!src) return null;

  const imgClassName = cn("overflow-hidden rounded-lg");
  const imageStyle = { maxWidth };

  if (typeof src !== "string") {
    return <img className={imgClassName} style={imageStyle} src={src} alt={alt} {...props} />;
  }

  const url = src.startsWith("/mnt/") ? resolveArtifactURL(src, threadId) : src;

  return (
    <>
      <button
        type="button"
        className="group/image relative cursor-zoom-in"
        onClick={() => setPreviewOpen(true)}
      >
        <img className={imgClassName} style={imageStyle} src={url} alt={alt} {...props} />
      </button>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden p-3">
          <div className="mb-2 flex justify-end gap-2">
            <Button size="sm" variant="secondary" asChild>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <SquareArrowOutUpRightIcon className="size-3.5" />
                {t.common.openInNewWindow}
              </a>
            </Button>
            <Button size="sm" variant="secondary" asChild>
              <a href={url} download>
                <DownloadIcon className="size-3.5" />
                {t.common.download}
              </a>
            </Button>
          </div>
          <div className="flex max-h-[76vh] items-center justify-center overflow-auto">
            <img
              className="h-auto max-h-[74vh] max-w-full object-contain"
              src={url}
              alt={alt}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MessageContent_({
  className,
  message,
  isLoading = false,
}: {
  className?: string;
  message: Message;
  isLoading?: boolean;
}) {
  const { t } = useI18n();
  const rehypePlugins = useRehypeSplitWordsIntoSpans(isLoading);
  const isHuman = message.type === "human";
  const { thread_id } = useParams<{ thread_id: string }>();
  const components = useMemo(
    () => ({
      img: (props: ImgHTMLAttributes<HTMLImageElement>) => (
        <MessageImage {...props} threadId={thread_id} maxWidth="90%" />
      ),
    }),
    [thread_id],
  );

  const rawContent = extractContentFromMessage(message);
  const reasoningContent = extractReasoningContentFromMessage(message);
  const implicitMentions = useMemo(() => {
    const rawMentions = message.additional_kwargs?.implicit_mentions;
    if (!Array.isArray(rawMentions)) {
      return [] as ImplicitMention[];
    }
    return rawMentions.filter(isImplicitMention);
  }, [message.additional_kwargs?.implicit_mentions]);

  const files = useMemo(() => {
    const files = message.additional_kwargs?.files;
    if (!Array.isArray(files) || files.length === 0) {
      if (rawContent.includes("<uploaded_files>")) {
        // If the content contains the <uploaded_files> tag, we return the parsed files from the content for backward compatibility.
        return parseUploadedFiles(rawContent);
      }
      return null;
    }
    return files as FileInMessage[];
  }, [message.additional_kwargs?.files, rawContent]);

  const contentToDisplay = useMemo(() => {
    if (isHuman) {
      const stripped = rawContent ? stripUploadedFilesTag(rawContent) : "";
      return stripImplicitMentionSuffix(stripped, implicitMentions);
    }
    return rawContent ?? "";
  }, [implicitMentions, rawContent, isHuman]);

  const filesList =
    files && files.length > 0 && thread_id ? (
      <RichFilesList files={files} threadId={thread_id} />
    ) : null;

  const implicitMentionCounts = (() => {
    if (!isHuman || implicitMentions.length === 0) {
      return null;
    }

    const summary = summarizeImplicitMentions(implicitMentions);
    const segments: Array<{ id: string; label: string; count: number }> = [];
    if (summary.context > 0) {
      segments.push({
        id: "context",
        label: t.inputBox.contextLabel,
        count: summary.context,
      });
    }
    if (summary.skill > 0) {
      segments.push({
        id: "skill",
        label: t.inputBox.skillLabel,
        count: summary.skill,
      });
    }
    if (summary.mcp > 0) {
      segments.push({
        id: "mcp",
        label: t.inputBox.mcpLabel,
        count: summary.mcp,
      });
    }
    if (summary.cli > 0) {
      segments.push({
        id: "cli",
        label: t.inputBox.cliLabel ?? "CLI",
        count: summary.cli,
      });
    }

    if (segments.length === 0) {
      return null;
    }

    return (
      <div className="text-muted-foreground flex flex-wrap justify-end text-[11px]">
        {segments.map((segment, index) => (
          <Fragment key={segment.id}>
            {index > 0 ? (
              <span className="text-muted-foreground/70 mx-1">|</span>
            ) : null}
            <span className="whitespace-nowrap">
              {segment.label}×{segment.count}
            </span>
          </Fragment>
        ))}
      </div>
    );
  })();

  // Uploading state: mock AI message shown while files upload
  if (message.additional_kwargs?.element === "task") {
    return (
      <AIElementMessageContent className={className}>
        <Task defaultOpen={false}>
          <TaskTrigger title="">
            <div className="text-muted-foreground flex w-full cursor-default items-center gap-2 text-sm select-none">
              <Loader className="size-4" />
              <span>{contentToDisplay}</span>
            </div>
          </TaskTrigger>
        </Task>
      </AIElementMessageContent>
    );
  }

  // Reasoning-only AI message (no main response content yet)
  if (!isHuman && reasoningContent && !rawContent) {
    return (
      <AIElementMessageContent className={className}>
        <Reasoning isStreaming={isLoading}>
          <ReasoningTrigger />
          <ReasoningContent>{reasoningContent}</ReasoningContent>
        </Reasoning>
      </AIElementMessageContent>
    );
  }

  if (isHuman) {
    const messageResponse = contentToDisplay ? (
      <AIElementMessageResponse
        remarkPlugins={humanMessagePlugins.remarkPlugins}
        rehypePlugins={humanMessagePlugins.rehypePlugins}
        components={components}
      >
        {contentToDisplay}
      </AIElementMessageResponse>
    ) : null;
    return (
      <div className={cn("ml-auto flex flex-col gap-2", className)}>
        {filesList}
        {messageResponse && (
          <AIElementMessageContent className="w-fit">
            {messageResponse}
          </AIElementMessageContent>
        )}
        {implicitMentionCounts}
      </div>
    );
  }

  return (
    <AIElementMessageContent className={className}>
      {filesList}
      <MarkdownContent
        content={contentToDisplay}
        isLoading={isLoading}
        rehypePlugins={[...rehypePlugins, [rehypeKatex, { output: "html" }]]}
        className="my-3"
        components={components}
      />
    </AIElementMessageContent>
  );
}

/**
 * Get file extension and check helpers
 */
const getFileExt = (filename: string) =>
  filename.split(".").pop()?.toLowerCase() ?? "";

const FILE_TYPE_MAP: Record<string, string> = {
  json: "JSON",
  csv: "CSV",
  txt: "TXT",
  md: "Markdown",
  py: "Python",
  js: "JavaScript",
  ts: "TypeScript",
  tsx: "TSX",
  jsx: "JSX",
  html: "HTML",
  css: "CSS",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  pdf: "PDF",
  png: "PNG",
  jpg: "JPG",
  jpeg: "JPEG",
  gif: "GIF",
  svg: "SVG",
  zip: "ZIP",
  tar: "TAR",
  gz: "GZ",
};

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

function getFileTypeLabel(filename: string): string {
  const ext = getFileExt(filename);
  return FILE_TYPE_MAP[ext] ?? (ext.toUpperCase() || "FILE");
}

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.includes(getFileExt(filename));
}

/**
 * Format bytes to human-readable size string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "—";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * List of files from additional_kwargs.files (with optional upload status)
 */
function RichFilesList({
  files,
  threadId,
}: {
  files: FileInMessage[];
  threadId: string;
}) {
  if (files.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap justify-end gap-2">
      {files.map((file, index) => (
        <RichFileCard
          key={`${file.filename}-${index}`}
          file={file}
          threadId={threadId}
        />
      ))}
    </div>
  );
}

/**
 * Single file card that handles FileInMessage (supports uploading state)
 */
function RichFileCard({
  file,
  threadId,
}: {
  file: FileInMessage;
  threadId: string;
}) {
  const { t } = useI18n();
  const isUploading = file.status === "uploading";
  const isImage = isImageFile(file.filename);

  if (isUploading) {
    return (
      <div className="bg-background border-border/40 flex max-w-50 min-w-30 flex-col gap-1 rounded-lg border p-3 opacity-60 shadow-sm">
        <div className="flex items-start gap-2">
          <Loader2Icon className="text-muted-foreground mt-0.5 size-4 shrink-0 animate-spin" />
          <span
            className="text-foreground truncate text-sm font-medium"
            title={file.filename}
          >
            {file.filename}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Badge
            variant="secondary"
            className="rounded px-1.5 py-0.5 text-[10px] font-normal"
          >
            {getFileTypeLabel(file.filename)}
          </Badge>
          <span className="text-muted-foreground text-[10px]">
            {t.uploads.uploading}
          </span>
        </div>
      </div>
    );
  }

  if (!file.path) return null;

  const fileUrl = resolveArtifactURL(file.path, threadId);
  const previewPath = file.markdown_virtual_path ?? file.path;
  const previewUrl = resolveArtifactURL(previewPath, threadId);

  if (isImage) {
    return (
      <div className="group border-border/40 relative block overflow-hidden rounded-lg border">
        <a href={fileUrl} target="_blank" rel="noopener noreferrer">
          <img
            src={fileUrl}
            alt={file.filename}
            className="h-32 w-auto max-w-60 object-cover transition-transform group-hover:scale-105"
          />
        </a>
        <a
          href={fileUrl}
          download
          className="bg-background/85 absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100"
        >
          <DownloadIcon className="size-3.5" />
        </a>
      </div>
    );
  }

  return (
    <a href={previewUrl} target="_blank" rel="noopener noreferrer">
      <div className="bg-background border-border/40 hover:border-border flex max-w-50 min-w-30 flex-col gap-1 rounded-lg border p-3 shadow-sm transition-colors">
        <div className="flex items-start gap-2">
          <FileIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <span
            className="text-foreground truncate text-sm font-medium"
            title={file.filename}
          >
            {file.filename}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Badge
              variant="secondary"
              className="rounded px-1.5 py-0.5 text-[10px] font-normal"
            >
              {getFileTypeLabel(file.filename)}
            </Badge>
            {file.markdown_virtual_path ? (
              <Badge
                variant="outline"
                className="rounded px-1.5 py-0.5 text-[10px] font-normal"
              >
                MD
              </Badge>
            ) : null}
          </div>
          <span className="text-muted-foreground text-[10px]">
            {formatBytes(file.size)}
          </span>
        </div>
      </div>
    </a>
  );
}

const MessageContent = memo(MessageContent_);
