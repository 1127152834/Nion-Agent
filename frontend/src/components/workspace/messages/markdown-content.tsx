"use client";

import { useMemo, type HTMLAttributes, type ReactNode } from "react";
import type { BundledLanguage } from "shiki";

import { CodeBlock } from "@/components/ai-elements/code-block";
import {
  MessageResponse,
  type MessageResponseProps,
} from "@/components/ai-elements/message";
import { streamdownPlugins } from "@/core/streamdown";

import { CitationLink } from "../citations/citation-link";
import { CopyButton } from "../copy-button";

export type MarkdownContentProps = {
  content: string;
  isLoading: boolean;
  rehypePlugins: MessageResponseProps["rehypePlugins"];
  className?: string;
  remarkPlugins?: MessageResponseProps["remarkPlugins"];
  components?: MessageResponseProps["components"];
};

const CODE_LANGUAGE_ALIASES: Record<string, BundledLanguage> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
  text: "log",
  txt: "log",
};

const SAFE_LANGUAGES = new Set<BundledLanguage>([
  "javascript",
  "jsx",
  "typescript",
  "tsx",
  "python",
  "bash",
  "json",
  "html",
  "css",
  "markdown",
  "yaml",
  "xml",
  "sql",
  "log",
]);

function extractCodeText(children: ReactNode): string {
  if (children == null) {
    return "";
  }
  if (typeof children === "string") {
    return children;
  }
  if (Array.isArray(children)) {
    return children.map((item) => extractCodeText(item)).join("");
  }
  if (typeof children === "object" && "props" in children) {
    return extractCodeText((children as { props?: { children?: ReactNode } }).props?.children ?? "");
  }
  return "";
}

function normalizeLanguage(rawClassName: string | undefined): {
  language: BundledLanguage;
  label: string;
} {
  if (!rawClassName) {
    return { language: "log", label: "TEXT" };
  }

  const match = /language-([A-Za-z0-9_-]+)/.exec(rawClassName);
  const raw = match?.[1]?.toLowerCase() ?? "";
  if (!raw) {
    return { language: "log", label: "TEXT" };
  }

  const alias = CODE_LANGUAGE_ALIASES[raw] ?? raw;
  const language = SAFE_LANGUAGES.has(alias as BundledLanguage)
    ? (alias as BundledLanguage)
    : "log";
  return { language, label: raw.toUpperCase() };
}

/** Renders markdown content. */
export function MarkdownContent({
  content,
  rehypePlugins,
  className,
  remarkPlugins = streamdownPlugins.remarkPlugins,
  components: componentsFromProps,
}: MarkdownContentProps) {
  const components = useMemo(() => {
    return {
      a: (props: HTMLAttributes<HTMLAnchorElement>) => {
        if (typeof props.children === "string") {
          const match = /^citation:(.+)$/.exec(props.children);
          if (match) {
            const [, text] = match;
            return <CitationLink {...props}>{text}</CitationLink>;
          }
        }
        return <a {...props} />;
      },
      pre: (
        props: HTMLAttributes<HTMLPreElement> & {
          children?: ReactNode;
        },
      ) => {
        const codeElement = Array.isArray(props.children)
          ? props.children[0]
          : props.children;
        const className =
          typeof codeElement === "object" &&
          codeElement !== null &&
          "props" in codeElement
            ? ((codeElement as { props?: { className?: string } }).props?.className ?? "")
            : "";
        const { language, label } = normalizeLanguage(className);
        const code =
          typeof codeElement === "object" && codeElement !== null && "props" in codeElement
            ? extractCodeText(
                (codeElement as { props?: { children?: ReactNode } }).props?.children ?? "",
              )
            : extractCodeText(props.children);

        return (
          <div className="my-3 overflow-hidden rounded-md border">
            <div className="bg-muted/70 flex items-center justify-between border-b px-3 py-1.5">
              <span className="text-muted-foreground text-[10px] font-semibold tracking-wider">
                {label}
              </span>
              <CopyButton className="size-7" clipboardData={code} />
            </div>
            <CodeBlock
              className="rounded-none border-0"
              code={code}
              language={language}
              showLineNumbers={false}
            />
          </div>
        );
      },
      ...componentsFromProps,
    };
  }, [componentsFromProps]);

  if (!content) return null;

  return (
    <MessageResponse
      className={className}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {content}
    </MessageResponse>
  );
}
