import type { Skill } from "./type";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === "'" || first === '"') && first === last) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

const SYSTEM_SKILL_DISPLAY_NAMES: Record<string, Record<string, string>> = {
  bootstrap: {
    en: "Bootstrap",
    "en-US": "Bootstrap",
    zh: "入门引导",
    "zh-CN": "入门引导",
  },
  "chart-visualization": {
    en: "Chart Visualization",
    "en-US": "Chart Visualization",
    zh: "图表可视化",
    "zh-CN": "图表可视化",
  },
  "claude-to-deerflow": {
    en: "DeerFlow Connector",
    "en-US": "DeerFlow Connector",
    zh: "连接 DeerFlow",
    "zh-CN": "连接 DeerFlow",
  },
  "consulting-analysis": {
    en: "Consulting Analysis",
    "en-US": "Consulting Analysis",
    zh: "咨询分析报告",
    "zh-CN": "咨询分析报告",
  },
  "data-analysis": {
    en: "Data Analysis",
    "en-US": "Data Analysis",
    zh: "数据分析",
    "zh-CN": "数据分析",
  },
  "deep-research": {
    en: "Deep Research",
    "en-US": "Deep Research",
    zh: "深度调研",
    "zh-CN": "深度调研",
  },
  "find-skills": {
    en: "Find Skills",
    "en-US": "Find Skills",
    zh: "发现技能",
    "zh-CN": "发现技能",
  },
  "frontend-design": {
    en: "Frontend Design",
    "en-US": "Frontend Design",
    zh: "前端设计",
    "zh-CN": "前端设计",
  },
  "github-deep-research": {
    en: "GitHub Deep Research",
    "en-US": "GitHub Deep Research",
    zh: "GitHub 深度调研",
    "zh-CN": "GitHub 深度调研",
  },
  "image-generation": {
    en: "Image Generation",
    "en-US": "Image Generation",
    zh: "图像生成",
    "zh-CN": "图像生成",
  },
  "plugin-assistant-orchestrator": {
    en: "Plugin Assistant Orchestrator",
    "en-US": "Plugin Assistant Orchestrator",
    zh: "插件助手编排器",
    "zh-CN": "插件助手编排器",
  },
  "podcast-generation": {
    en: "Podcast Generation",
    "en-US": "Podcast Generation",
    zh: "播客生成",
    "zh-CN": "播客生成",
  },
  "ppt-generation": {
    en: "PPT Generation",
    "en-US": "PPT Generation",
    zh: "PPT 生成",
    "zh-CN": "PPT 生成",
  },
  "skill-creator": {
    en: "Skill Creator",
    "en-US": "Skill Creator",
    zh: "技能创建器",
    "zh-CN": "技能创建器",
  },
  "surprise-me": {
    en: "Surprise Me",
    "en-US": "Surprise Me",
    zh: "惊喜一下",
    "zh-CN": "惊喜一下",
  },
  "vercel-deploy": {
    en: "Vercel Deploy",
    "en-US": "Vercel Deploy",
    zh: "Vercel 部署",
    "zh-CN": "Vercel 部署",
  },
  "video-generation": {
    en: "Video Generation",
    "en-US": "Video Generation",
    zh: "视频生成",
    "zh-CN": "视频生成",
  },
  "web-design-guidelines": {
    en: "Web Design Guidelines",
    "en-US": "Web Design Guidelines",
    zh: "Web 设计规范检查",
    "zh-CN": "Web 设计规范检查",
  },
};

export function getLocalizedSkillName(skillName: string, locale: string): string {
  const entry = SYSTEM_SKILL_DISPLAY_NAMES[skillName];
  if (!entry) {
    return skillName;
  }

  const direct = entry[locale];
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }

  const baseLocale = locale.split("-")[0];
  if (baseLocale) {
    const fallbackByPrefix = entry[baseLocale];
    if (typeof fallbackByPrefix === "string" && fallbackByPrefix.trim()) {
      return fallbackByPrefix;
    }
  }

  return skillName;
}

export function getLocalizedSkillDescription(skill: Skill, locale: string): string {
  const source = skill.description;
  if (!source) {
    return "";
  }

  const normalizedSource = stripWrappingQuotes(source);
  try {
    const parsed = JSON.parse(normalizedSource) as unknown;
    if (!isRecord(parsed)) {
      return normalizedSource;
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
    return normalizedSource;
  }

  return normalizedSource;
}
