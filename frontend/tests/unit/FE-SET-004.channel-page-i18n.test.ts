import { describe, it } from "vitest";

import type { Translations } from "@/core/i18n";
import { enUS } from "@/core/i18n/locales/en-US";
import { zhCN } from "@/core/i18n/locales/zh-CN";

const REQUIRED_CHANNEL_PAGE_KEYS = [
  "activeUsersLabel",
  "cancelAction",
  "missingRequiredFieldsPrefix",
  "sessionAssistantIdLabel",
  "sessionAssistantIdPlaceholder",
  "sessionDefaultsDescription",
  "sessionDefaultsTitle",
  "sessionDisabledOption",
  "sessionEnabledOption",
  "sessionInheritLabel",
  "sessionInheritOption",
  "sessionOverrideAction",
  "sessionOverrideBadge",
  "sessionOverrideCurrentLabel",
  "sessionOverrideDialogDescription",
  "sessionOverrideDialogTitle",
  "sessionOverrideSaveFailedToast",
  "sessionOverrideSavedToast",
  "sessionPlanModeLabel",
  "sessionRecursionLimitLabel",
  "sessionRecursionLimitPlaceholder",
  "sessionResetAction",
  "sessionSubagentLabel",
  "sessionThinkingLabel",
] as const;

function assertChannelPageI18nKeys(localeName: string, translations: Translations) {
  const channelPage = translations.settings.channelPage as Record<string, unknown> | undefined;
  if (!channelPage) {
    throw new Error(`[${localeName}] missing settings.channelPage translations`);
  }

  for (const key of REQUIRED_CHANNEL_PAGE_KEYS) {
    const value = channelPage[key];
    // withFallbackLabels returns the key name itself when the translation is missing.
    if (value === key) {
      throw new Error(`[${localeName}] missing settings.channelPage.${key}`);
    }
  }
}

describe("FE-SET-004 通道设置页 i18n key 完整性", () => {
  it("en-US 不应回退为 key 名", () => {
    assertChannelPageI18nKeys("en-US", enUS);
  });

  it("zh-CN 不应回退为 key 名", () => {
    assertChannelPageI18nKeys("zh-CN", zhCN);
  });
});
