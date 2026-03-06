"use client";

import type { ConfigValidateErrorItem } from "@/core/config-center";
import { useI18n } from "@/core/i18n/hooks";

export function ConfigValidationErrors({
  errors,
}: {
  errors: ConfigValidateErrorItem[];
}) {
  const { t } = useI18n();

  if (errors.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      {errors.map((item, index) => (
        <div key={`${item.path.join(".")}-${index}`}>
          <span className="font-medium">
            {item.path.join(".") || t.settings.validation.rootLabel}
          </span>{" "}
          {item.message || t.settings.validation.validationFailed}
        </div>
      ))}
    </div>
  );
}
