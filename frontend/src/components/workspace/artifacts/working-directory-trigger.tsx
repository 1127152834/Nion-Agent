import { FolderIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/workspace/tooltip";
import { useI18n } from "@/core/i18n/hooks";

import { useArtifacts } from "./context";

export const WorkingDirectoryTrigger = () => {
  const { t } = useI18n();
  const { artifacts, deselect, setOpen: setArtifactsOpen } = useArtifacts();
  const artifactsCount = artifacts?.length ?? 0;

  return (
    <Tooltip content={t.common.browseWorkspace}>
      <Button
        className="text-muted-foreground hover:text-foreground"
        variant="ghost"
        onClick={() => {
          deselect();
          setArtifactsOpen(true);
        }}
      >
        <FolderIcon />
        {t.common.workingDirectory}
        {artifactsCount > 0 ? ` (${artifactsCount})` : ""}
      </Button>
    </Tooltip>
  );
};
