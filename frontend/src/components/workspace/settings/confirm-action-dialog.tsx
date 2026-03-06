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

type ConfirmActionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  cancelText?: string;
  confirmText?: string;
  confirmVariant?: "default" | "destructive";
  confirmDisabled?: boolean;
  onConfirm: () => void;
};

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  cancelText,
  confirmText,
  confirmVariant = "default",
  confirmDisabled = false,
  onConfirm,
}: ConfirmActionDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {cancelText ?? t.common.cancel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            disabled={confirmDisabled}
            onClick={() => {
              onConfirm();
            }}
          >
            {confirmText ?? t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
