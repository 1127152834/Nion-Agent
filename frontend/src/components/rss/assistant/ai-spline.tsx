"use client";

import { BotIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const SCENE_URL = "https://assets.folo.is/ai2.splinecode";
const VIEWER_SCRIPT_URL = "https://unpkg.com/@splinetool/viewer@1.9.98/build/spline-viewer.js";

type SplineViewerElement = HTMLElement & {
  url?: string;
};

function FallbackAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-primary/10 text-primary flex size-full items-center justify-center rounded-2xl border",
        className,
      )}
    >
      <BotIcon className="size-8" />
    </div>
  );
}

function createViewerElement() {
  const el = document.createElement("spline-viewer") as SplineViewerElement;
  el.setAttribute("url", SCENE_URL);
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.display = "block";
  return el;
}

export function RSSAssistantSpline({ className }: { className?: string }) {
  const [viewerReady, setViewerReady] = useState(false);
  const [viewerFailed, setViewerFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const containerClassName = useMemo(
    () => cn("relative size-16 overflow-hidden rounded-2xl", className),
    [className],
  );

  useEffect(() => {
    let disposed = false;

    const ensureViewer = async () => {
      if (typeof window === "undefined") {
        return;
      }

      if (customElements.get("spline-viewer")) {
        if (!disposed) {
          setViewerReady(true);
        }
        return;
      }

      const existingScript = document.querySelector<HTMLScriptElement>(
        `script[data-spline-viewer="true"]`,
      );

      if (existingScript) {
        const waitUntilReady = () => {
          if (disposed) {
            return;
          }
          if (customElements.get("spline-viewer")) {
            setViewerReady(true);
            return;
          }
          window.setTimeout(waitUntilReady, 100);
        };

        waitUntilReady();
        return;
      }

      const script = document.createElement("script");
      script.type = "module";
      script.src = VIEWER_SCRIPT_URL;
      script.async = true;
      script.dataset.splineViewer = "true";
      script.onload = () => {
        if (disposed) {
          return;
        }
        if (customElements.get("spline-viewer")) {
          setViewerReady(true);
        } else {
          setViewerFailed(true);
        }
      };
      script.onerror = () => {
        if (!disposed) {
          setViewerFailed(true);
        }
      };
      document.head.appendChild(script);
    };

    void ensureViewer();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!viewerReady || viewerFailed) {
      return;
    }

    const host = hostRef.current;
    if (!host) {
      return;
    }

    host.innerHTML = "";
    host.appendChild(createViewerElement());

    return () => {
      host.innerHTML = "";
    };
  }, [viewerFailed, viewerReady]);

  if (viewerFailed) {
    return <FallbackAvatar className={containerClassName} />;
  }

  return (
    <div className={containerClassName}>
      {!viewerReady && <FallbackAvatar className="absolute inset-0" />}
      <div ref={hostRef} className="absolute inset-0" />
    </div>
  );
}
