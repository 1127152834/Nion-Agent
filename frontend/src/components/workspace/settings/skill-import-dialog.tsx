"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/core/i18n/hooks";

type SkillImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SkillImportDialog({
  open,
  onOpenChange,
}: SkillImportDialogProps) {
  const { t } = useI18n();
  const fallbackCopy = {
    title: "Import skill",
    description: "Import a skill from package file or shared source.",
    close: "Close",
  };
  const settingsLike = t.settings as unknown as {
    skillImportDialog?: Record<string, string>;
  };
  const copy = {
    ...fallbackCopy,
    ...(settingsLike.skillImportDialog ?? {}),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {copy.description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {copy.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
