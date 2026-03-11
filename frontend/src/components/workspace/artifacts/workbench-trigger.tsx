import { Code2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/workspace/tooltip";
import { useI18n } from "@/core/i18n/hooks";

import { useArtifacts } from "./context";

export const WorkbenchTrigger = () => {
  const { t } = useI18n();
  const { setOpen: setArtifactsOpen, setPanelType } = useArtifacts();

  return (
    <Tooltip content={t.workspace.artifactPanel.plugin}>
      <Button
        className="text-muted-foreground hover:text-foreground"
        variant="ghost"
        onClick={() => {
          setPanelType("workbench");
          setArtifactsOpen(true);
        }}
      >
        <Code2Icon />
        {t.workspace.artifactPanel.plugin}
      </Button>
    </Tooltip>
  );
};
