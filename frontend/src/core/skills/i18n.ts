import type { Skill } from "./type";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function getLocalizedSkillDescription(skill: Skill, locale: string): string {
  const source = skill.description;
  if (!source) {
    return "";
  }

  try {
    const parsed = JSON.parse(source) as unknown;
    if (!isRecord(parsed)) {
      return source;
    }

    const direct = parsed[locale];
    if (typeof direct === "string" && direct.trim()) {
      return direct;
    }

    const baseLocale = locale.split("-")[0];
    if (baseLocale) {
      const fallbackByPrefix = parsed[baseLocale];
      if (typeof fallbackByPrefix === "string" && fallbackByPrefix.trim()) {
        return fallbackByPrefix;
      }
    }

    const en = parsed.en;
    if (typeof en === "string" && en.trim()) {
      return en;
    }
  } catch {
    return source;
  }

  return source;
}
