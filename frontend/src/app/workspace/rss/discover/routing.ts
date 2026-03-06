export function buildRSSDiscoverPath(
  category: string,
  keyword: string,
): string {
  const normalizedCategory = (category || "all").trim().toLowerCase();
  const normalizedKeyword = keyword.trim();

  const basePath =
    normalizedCategory === "all"
      ? "/workspace/rss/discover"
      : `/workspace/rss/discover/category/${encodeURIComponent(
          normalizedCategory,
        )}`;

  if (!normalizedKeyword) {
    return basePath;
  }

  const query = new URLSearchParams({ q: normalizedKeyword }).toString();
  return `${basePath}?${query}`;
}
