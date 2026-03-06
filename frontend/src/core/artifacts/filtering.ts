import { checkCodeFile, getFileExtension, getFileName } from "@/core/utils/files";

export type ArtifactFilterType =
  | "all"
  | "document"
  | "image"
  | "media"
  | "code"
  | "skill"
  | "other";

export type ArtifactSortMode = "recent" | "name-asc" | "name-desc";

const DOCUMENT_EXTENSIONS = new Set([
  "txt",
  "md",
  "mdx",
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "csv",
]);
const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "bmp",
  "tiff",
  "ico",
  "webp",
  "svg",
  "heic",
]);
const MEDIA_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "ogg",
  "aac",
  "m4a",
  "flac",
  "wma",
  "aiff",
  "ape",
  "mp4",
  "mov",
  "m4v",
  "avi",
  "mkv",
  "webm",
]);

export function getArtifactFilterType(filepath: string): ArtifactFilterType {
  const extension = getFileExtension(filepath);
  if (extension === "skill") {
    return "skill";
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (MEDIA_EXTENSIONS.has(extension)) {
    return "media";
  }
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return "document";
  }
  if (checkCodeFile(filepath).isCodeFile) {
    return "code";
  }
  return "other";
}

function matchesQuery(filepath: string, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return (
    filepath.toLowerCase().includes(normalized) ||
    getFileName(filepath).toLowerCase().includes(normalized)
  );
}

function sortArtifacts(files: string[], sortMode: ArtifactSortMode): string[] {
  if (sortMode === "recent") {
    return [...files];
  }
  const sorted = [...files].sort((left, right) =>
    getFileName(left).localeCompare(getFileName(right), "en", {
      sensitivity: "base",
    }),
  );
  if (sortMode === "name-desc") {
    sorted.reverse();
  }
  return sorted;
}

export function filterAndSortArtifacts(
  files: string[],
  {
    query,
    filterType,
    sortMode,
  }: {
    query: string;
    filterType: ArtifactFilterType;
    sortMode: ArtifactSortMode;
  },
): string[] {
  const filtered = files.filter((filepath) => {
    if (!matchesQuery(filepath, query)) {
      return false;
    }
    if (filterType === "all") {
      return true;
    }
    return getArtifactFilterType(filepath) === filterType;
  });
  return sortArtifacts(filtered, sortMode);
}
