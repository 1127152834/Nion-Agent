"use client";

import type { ConfigValidateErrorItem } from "@/core/config-center";

export function ConfigValidationErrors({
  errors,
}: {
  errors: ConfigValidateErrorItem[];
}) {
  if (errors.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      {errors.map((item, index) => (
        <div key={`${item.path.join(".")}-${index}`}>
          <span className="font-medium">{item.path.join(".") || "(root)"}:</span>{" "}
          {item.message}
        </div>
      ))}
    </div>
  );
}
