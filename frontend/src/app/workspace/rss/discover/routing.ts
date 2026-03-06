export function buildRSSDiscoverPath(
  category: string,
  keyword: string,
  language = "all",
): string {
  const normalizedCategory = (category || "all").trim().toLowerCase();
  const normalizedKeyword = keyword.trim();
  const normalizedLanguage = (language || "all").trim().toLowerCase();

  const basePath =
    normalizedCategory === "all"
      ? "/workspace/rss/discover"
      : `/workspace/rss/discover/category/${encodeURIComponent(
          normalizedCategory,
        )}`;

  const nextQuery = new URLSearchParams();
  if (normalizedKeyword) {
    nextQuery.set("q", normalizedKeyword);
  }
  if (normalizedLanguage !== "all") {
    nextQuery.set("language", normalizedLanguage);
  }

  if (nextQuery.size === 0) {
    return basePath;
  }

  return `${basePath}?${nextQuery.toString()}`;
}
