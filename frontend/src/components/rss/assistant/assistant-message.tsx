"use client";

import { Check, Copy, FileIcon, Loader2Icon } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useState, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import type { FileInMessage } from "@/core/messages/utils";
import { cn } from "@/lib/utils";

import { messageVariants } from "./animations";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface AssistantMessageProps {
  message: Message;
  implicitMentions?: Array<{
    kind: "context" | "skill" | "mcp";
    value: string;
    mention: string;
  }>;
  files?: FileInMessage[];
  isTaskMessage?: boolean;
}

function formatMentionLabel(item: {
  kind: "context" | "skill" | "mcp";
  value: string;
  mention: string;
}) {
  if (item.kind === "skill") {
    return `/${item.value}`;
  }
  if (item.kind === "mcp") {
    return `@${item.value}`;
  }
  const normalized = item.value.replace(/\/$/, "");
  const parts = normalized.split("/").filter(Boolean);
  const basename = parts[parts.length - 1] ?? normalized;
  return `@${basename || item.value}`;
}

function formatFileSize(size: number) {
  if (!size || size <= 0) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function AssistantMessage({
  message,
  implicitMentions = [],
  files = [],
  isTaskMessage = false,
}: AssistantMessageProps) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      toast.success("已复制到剪贴板");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制失败");
    }
  }, [message.content]);

  return (
    <motion.div
      variants={messageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className={cn("group flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "relative flex max-w-[88%] flex-col gap-2 rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "border border-border bg-muted text-foreground",
        )}
      >
        {files.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {files.map((file, index) => (
              <div
                key={`${file.filename}-${index}`}
                className={cn(
                  "inline-flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                  isUser
                    ? "border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground"
                    : "border-border bg-card text-foreground",
                )}
              >
                {file.status === "uploading" ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <FileIcon className="size-3.5" />
                )}
                <span className="truncate">{file.filename}</span>
                {formatFileSize(file.size) && (
                  <span
                    className={cn(
                      "shrink-0 text-[11px]",
                      isUser ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    {formatFileSize(file.size)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {implicitMentions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {implicitMentions.map((item, index) => (
              <span
                key={`${item.kind}:${item.value}:${index}`}
                className={cn(
                  "inline-flex max-w-[11rem] items-center truncate rounded-full px-2 py-0.5 text-[11px]",
                  isUser
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-accent text-accent-foreground",
                )}
                title={item.mention}
              >
                {formatMentionLabel(item)}
              </span>
            ))}
          </div>
        )}

        {message.content && (
          <>
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <div className="prose prose-sm max-w-none prose-p:leading-relaxed">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ node: _node, className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className ?? "");
                      const inline = !match;

                      if (!inline && match) {
                        return (
                          <div className="relative">
                            <button
                              type="button"
                              onClick={handleCopy}
                              className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-xs text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                              title="复制代码"
                            >
                              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                              {copied ? "已复制" : "复制"}
                            </button>
                            <SyntaxHighlighter
                              style={oneDark as Record<string, CSSProperties>}
                              language={match[1]}
                              PreTag="div"
                              customStyle={{
                                margin: 0,
                                borderRadius: "0.75rem",
                                fontSize: "0.875rem",
                              }}
                            >
                              {String(children as string).replace(/\n$/, "")}
                            </SyntaxHighlighter>
                          </div>
                        );
                      }

                      return (
                        <code
                          className="rounded-md bg-black/10 px-1.5 py-0.5 text-[0.85em] dark:bg-white/10"
                          {...props}
                        >
                          {children}
                        </code>
                      );
                    },
                    a({ href, children }) {
                      return (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline underline-offset-2 hover:no-underline"
                        >
                          {children}
                        </a>
                      );
                    },
                    ul({ children }) {
                      return <ul className="list-disc pl-4">{children}</ul>;
                    },
                    ol({ children }) {
                      return <ol className="list-decimal pl-4">{children}</ol>;
                    },
                    blockquote({ children }) {
                      return (
                        <blockquote className="border-l-4 border-primary pl-4 italic text-muted-foreground">
                          {children}
                        </blockquote>
                      );
                    },
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
          </>
        )}

        {isTaskMessage && (
          <div
            className={cn(
              "text-xs",
              isUser ? "text-primary-foreground/80" : "text-muted-foreground",
            )}
          >
            文件处理中...
          </div>
        )}

        {/* Copy button for AI messages */}
        {!isUser && message.content && (
          <button
            type="button"
            onClick={handleCopy}
            className="absolute -left-10 top-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
            title="复制消息"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </button>
        )}
      </div>
    </motion.div>
  );
}
