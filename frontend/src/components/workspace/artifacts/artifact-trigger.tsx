import { FilesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/workspace/tooltip";
import { useI18n } from "@/core/i18n/hooks";

import { useArtifacts } from "./context";

export const ArtifactTrigger = () => {
  const { t } = useI18n();
  const { artifacts, setOpen: setArtifactsOpen } = useArtifacts();
  const artifactsCount = artifacts?.length ?? 0;
  return (
    <Tooltip content={t.common.artifacts}>
      <Button
        className="text-muted-foreground hover:text-foreground"
        variant="ghost"
        onClick={() => {
          setArtifactsOpen(true);
        }}
      >
        <FilesIcon />
        {t.common.artifacts}
        {artifactsCount > 0 ? ` (${artifactsCount})` : ""}
      </Button>
    </Tooltip>
  );
};
