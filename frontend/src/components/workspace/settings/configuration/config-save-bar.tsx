"use client";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

export function ConfigSaveBar({
  className,
  dirty,
  disabled,
  saving,
  onDiscard,
  onSave,
}: {
  className?: string;
  dirty: boolean;
  disabled?: boolean;
  saving?: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const fallbackCopy = {
    clean: "All changes saved",
    dirty: "Unsaved changes",
    discard: "Discard",
    save: "Save",
    saving: "Saving...",
  };
  const settingsLike = t.settings as unknown as {
    configSections?: {
      saveBar?: Record<string, string>;
    };
  };
  const copy = {
    ...fallbackCopy,
    ...(settingsLike.configSections?.saveBar ?? {}),
  };
  const isDisabled = disabled ?? false;
  const isSaving = saving ?? false;

  return (
    <div
      className={cn(
        "bg-background/95 border-border/80 sticky bottom-0 z-20 flex items-center justify-between rounded-lg border px-4 py-3 backdrop-blur",
        className,
      )}
    >
      <div className="text-muted-foreground text-xs">
        {dirty ? copy.dirty : copy.clean}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onDiscard}
          disabled={isDisabled || !dirty || isSaving}
        >
          {copy.discard}
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={isDisabled || !dirty || isSaving}
        >
          {isSaving ? copy.saving : copy.save}
        </Button>
      </div>
    </div>
  );
}
