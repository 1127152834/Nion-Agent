import { ImageIcon } from "lucide-react";

import type { WorkbenchPlugin, WorkbenchContext, Artifact } from "@/core/workbench";

/**
 * Example Image Viewer Plugin
 * Demonstrates the workbench plugin system with a simple image viewer
 */
const ExampleImageViewerPlugin: WorkbenchPlugin = {
  id: "example-image-viewer",
  name: "Example Image Viewer",
  version: "1.0.0",
  description: "Simple image viewer plugin demonstrating the workbench plugin system",
  author: "Nion Team",
  icon: ImageIcon,

  canHandle(artifact: Artifact): boolean | number {
    const path = artifact.path.toLowerCase();
    const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"];

    if (imageExtensions.some(ext => path.endsWith(ext))) {
      return 80; // High priority for image files
    }

    return false;
  },

  render(context: WorkbenchContext) {
    const imageUrl = `/api/threads/${context.threadId}/artifacts/${context.artifact.path}`;

    return (
      <div className="flex size-full flex-col items-center justify-center bg-muted/30 p-4">
        <div className="flex max-h-full max-w-full items-center justify-center">
          <img
            src={imageUrl}
            alt={context.artifact.path}
            className="max-h-full max-w-full object-contain"
            onError={(e) => {
              context.toast("Failed to load image", "error");
              console.error("Image load error:", e);
            }}
          />
        </div>
        <div className="mt-4 text-muted-foreground text-sm">
          {context.artifact.path}
        </div>
      </div>
    );
  },

  onMount(context: WorkbenchContext) {
    console.log("Example Image Viewer mounted for:", context.artifact.path);
  },

  onClose() {
    console.log("Example Image Viewer closed");
  },
};

export default ExampleImageViewerPlugin;
