"use client";

import type { ConfigValidateErrorItem, ConfigValidateWarningItem } from "@/core/config-center";
import { useI18n } from "@/core/i18n/hooks";

export function ConfigValidationErrors({
  errors,
  warnings = [],
}: {
  errors: ConfigValidateErrorItem[];
  warnings?: ConfigValidateWarningItem[];
}) {
  const { t } = useI18n();
  const settingsLike = t.settings as unknown as {
    validation?: {
      rootLabel?: string;
      validationFailed?: string;
    };
  };
  const validationCopy = {
    rootLabel: "root",
    validationFailed: "Validation failed",
    ...(settingsLike.validation ?? {}),
  };

  if (errors.length === 0 && warnings.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {errors.length > 0 && (
        <div className="space-y-1 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">
          {errors.map((item, index) => (
            <div key={`error-${item.path.join(".")}-${index}`}>
              <span className="font-medium">
                {item.path.join(".") || validationCopy.rootLabel}
              </span>{" "}
              {item.message || validationCopy.validationFailed}
            </div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          {warnings.map((item, index) => (
            <div key={`warning-${item.path.join(".")}-${index}`}>
              <span className="font-medium">
                {item.path.join(".") || validationCopy.rootLabel}
              </span>{" "}
              {item.message || validationCopy.validationFailed}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
