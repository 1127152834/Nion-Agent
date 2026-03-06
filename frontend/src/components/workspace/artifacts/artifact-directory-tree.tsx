import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/core/i18n/hooks";
import { getFileIcon, getFileName } from "@/core/utils/files";
import { cn } from "@/lib/utils";

type DirectoryTreeNode =
  | {
      type: "directory";
      name: string;
      key: string;
      children: DirectoryTreeNode[];
    }
  | {
      type: "file";
      name: string;
      key: string;
      artifactPath: string;
    };

const USER_DATA_PREFIX = "/mnt/user-data/";

function normalizeArtifactPath(filepath: string): string {
  if (!filepath.startsWith("write-file:")) {
    return filepath;
  }
  try {
    const url = new URL(filepath);
    return decodeURIComponent(url.pathname);
  } catch {
    return filepath;
  }
}

function toDisplayPath(filepath: string): string {
  const normalizedPath = normalizeArtifactPath(filepath).replace(/\\/g, "/");
  if (normalizedPath.startsWith(USER_DATA_PREFIX)) {
    return normalizedPath.slice(USER_DATA_PREFIX.length);
  }
  return normalizedPath.replace(/^\/+/, "");
}

function buildDirectoryTree(files: string[]): DirectoryTreeNode[] {
  const roots: DirectoryTreeNode[] = [];

  const upsertDirectory = (
    children: DirectoryTreeNode[],
    key: string,
    name: string,
  ) => {
    const existing = children.find(
      (node): node is Extract<DirectoryTreeNode, { type: "directory" }> =>
        node.type === "directory" && node.key === key,
    );
    if (existing) {
      return existing;
    }
    const next: Extract<DirectoryTreeNode, { type: "directory" }> = {
      type: "directory",
      name,
      key,
      children: [],
    };
    children.push(next);
    return next;
  };

  const sortNodes = (nodes: DirectoryTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
    for (const node of nodes) {
      if (node.type === "directory") {
        sortNodes(node.children);
      }
    }
  };

  for (const originalPath of files) {
    const normalizedOriginalPath = normalizeArtifactPath(originalPath);
    const displayPath = toDisplayPath(originalPath);
    const parts =
      displayPath.split("/").filter(Boolean).length > 0
        ? displayPath.split("/").filter(Boolean)
        : [getFileName(normalizedOriginalPath)];

    let currentChildren = roots;
    let currentKey = "";

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      const nextKey = currentKey ? `${currentKey}/${part}` : part;
      const isLeaf = index === parts.length - 1;

      if (isLeaf) {
        const exists = currentChildren.some(
          (node) => node.type === "file" && node.key === nextKey,
        );
        if (!exists) {
          currentChildren.push({
            type: "file",
            key: nextKey,
            name: part,
            artifactPath: originalPath,
          });
        }
        break;
      }

      const directory = upsertDirectory(currentChildren, nextKey, part);
      currentChildren = directory.children;
      currentKey = nextKey;
    }
  }

  sortNodes(roots);
  return roots;
}

function collectInitialExpandedDirs(
  nodes: DirectoryTreeNode[],
  maxDepth: number,
  depth = 0,
  expanded: Record<string, boolean> = {},
): Record<string, boolean> {
  for (const node of nodes) {
    if (node.type !== "directory") {
      continue;
    }
    if (depth <= maxDepth) {
      expanded[node.key] = true;
    }
    if (depth < maxDepth) {
      collectInitialExpandedDirs(node.children, maxDepth, depth + 1, expanded);
    }
  }
  return expanded;
}

function DirectoryNodeItem({
  node,
  depth,
  expandedDirs,
  selectedPath,
  onToggleDirectory,
  onOpenFile,
}: {
  node: DirectoryTreeNode;
  depth: number;
  expandedDirs: Record<string, boolean>;
  selectedPath: string | null;
  onToggleDirectory: (key: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const indentStyle = { paddingLeft: `${depth * 14 + 6}px` };

  if (node.type === "directory") {
    const isOpen = !!expandedDirs[node.key];
    return (
      <div>
        <button
          className="hover:bg-accent flex w-full items-center gap-1 rounded-sm py-1 text-left text-sm"
          style={indentStyle}
          type="button"
          onClick={() => onToggleDirectory(node.key)}
        >
          {isOpen ? (
            <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
          ) : (
            <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
          )}
          {isOpen ? (
            <FolderOpenIcon className="text-muted-foreground size-4 shrink-0" />
          ) : (
            <FolderIcon className="text-muted-foreground size-4 shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen &&
          node.children.map((child) => (
            <DirectoryNodeItem
              key={child.key}
              node={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              selectedPath={selectedPath}
              onToggleDirectory={onToggleDirectory}
              onOpenFile={onOpenFile}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      className={cn(
        "hover:bg-accent flex w-full items-center gap-1 rounded-sm py-1 text-left text-sm",
        selectedPath === node.artifactPath && "bg-accent",
      )}
      style={indentStyle}
      type="button"
      onClick={() => onOpenFile(node.artifactPath)}
    >
      <span className="text-muted-foreground inline-flex size-4 shrink-0 items-center justify-center">
        {getFileIcon(node.artifactPath, "size-4")}
      </span>
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function ArtifactDirectoryTree({
  className,
  files,
  selectedPath,
  onOpenFile,
}: {
  className?: string;
  files: string[];
  selectedPath: string | null;
  onOpenFile: (path: string) => void;
}) {
  const { t } = useI18n();
  const tree = useMemo(() => buildDirectoryTree(files), [files]);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>(
    {},
  );

  useEffect(() => {
    setExpandedDirs(collectInitialExpandedDirs(tree, 1));
  }, [tree]);

  return (
    <ScrollArea className={cn("min-h-0 grow", className)}>
      <div className="p-2">
        {tree.length > 0 ? (
          tree.map((node) => (
            <DirectoryNodeItem
              key={node.key}
              node={node}
              depth={0}
              expandedDirs={expandedDirs}
              selectedPath={selectedPath}
              onToggleDirectory={(key) => {
                setExpandedDirs((previous) => ({
                  ...previous,
                  [key]: !previous[key],
                }));
              }}
              onOpenFile={onOpenFile}
            />
          ))
        ) : (
          <div className="text-muted-foreground rounded-md border border-dashed px-2 py-6 text-center text-xs">
            {t.common.noFilesInDirectory}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
