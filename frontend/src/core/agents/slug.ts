import { pinyin } from "pinyin-pro";

export const AGENT_SLUG_RE = /^[A-Za-z0-9-]+$/;

function isCjkUnifiedIdeograph(char: string): boolean {
  // Covers \u4E00-\u9FFF plus extension blocks commonly used for Chinese names.
  // Not perfect, but sufficient for generating a stable ASCII slug.
  return /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(char);
}

export function toAgentSlug(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  let romanized = "";
  for (const char of trimmed) {
    if (isCjkUnifiedIdeograph(char)) {
      romanized += `${pinyin(char, { toneType: "none" })} `;
      continue;
    }
    romanized += char;
  }

  return romanized
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

