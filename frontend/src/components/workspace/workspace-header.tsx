"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import { useWorkspaceSidebarPresentation } from "./workspace-sidebar-routing";

export function WorkspaceHeader({ className }: { className?: string }) {
  const { t } = useI18n();
  const { isCollapsed } = useWorkspaceSidebarPresentation();
  const { toggleSidebar } = useSidebar();
  const [titlebarInset, setTitlebarInset] = useState(0);
  const nionRef = useRef<SVGGElement | null>(null);
  const arrowRef = useRef<SVGPathElement | null>(null);
  const arrowLengthRef = useRef(0);
  const animationsRef = useRef<Animation[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const ua = window.navigator.userAgent || "";
    const platform = window.navigator.platform || "";
    const isElectron = ua.includes("Electron");
    const isMac = /Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(ua);
    setTitlebarInset(isElectron && isMac ? 26 : 0);
  }, []);

  useEffect(() => {
    if (!isCollapsed) {
      animationsRef.current.forEach((anim) => anim.cancel());
      animationsRef.current = [];
      return;
    }
    const nion = nionRef.current;
    const arrow = arrowRef.current;
    if (!nion || !arrow) {
      return;
    }
    const length = arrow.getTotalLength();
    arrowLengthRef.current = length;
    nion.style.opacity = "1";
    nion.style.transform = "scale(1) translateX(0px)";
    arrow.style.strokeDasharray = `${length}`;
    arrow.style.strokeDashoffset = `${length}`;
    arrow.style.opacity = "0";
    arrow.style.transform = "scale(0.6) translateX(-6px)";
  }, [isCollapsed]);

  const playMorph = useCallback((toArrow: boolean) => {
    const nion = nionRef.current;
    const arrow = arrowRef.current;
    if (!nion || !arrow) {
      return;
    }
    const length = arrowLengthRef.current || 48;
    animationsRef.current.forEach((anim) => anim.cancel());
    animationsRef.current = [];

    const duration = 1000;
    const easing = "cubic-bezier(0.16, 1, 0.3, 1)";

    const nionFrames = toArrow
      ? [
          { opacity: 1, transform: "scale(1) translateX(0px)" },
          { opacity: 0, transform: "scale(0.78) translateX(-6px)" },
        ]
      : [
          { opacity: 0, transform: "scale(0.78) translateX(-6px)" },
          { opacity: 1, transform: "scale(1) translateX(0px)" },
        ];

    const arrowFrames = toArrow
      ? [
          { opacity: 0, transform: "scale(0.6) translateX(-6px)", strokeDashoffset: length },
          { opacity: 1, transform: "scale(1) translateX(0px)", strokeDashoffset: 0 },
        ]
      : [
          { opacity: 1, transform: "scale(1) translateX(0px)", strokeDashoffset: 0 },
          { opacity: 0, transform: "scale(0.6) translateX(-6px)", strokeDashoffset: length },
        ];

    animationsRef.current = [
      nion.animate(nionFrames, { duration, easing, fill: "forwards" }),
      arrow.animate(arrowFrames, { duration, easing, fill: "forwards" }),
    ];
  }, []);

  return (
    <>
      <div
        className={cn(
          "group/workspace-header flex h-16 flex-col justify-center cursor-move transition-all duration-200 hover:bg-gradient-to-b hover:from-muted/40 hover:to-muted/20",
          className,
        )}
        style={{
          WebkitAppRegion: "drag",
          ...(titlebarInset > 0
            ? {
                paddingTop: `${titlebarInset}px`,
                height: `${64 + titlebarInset}px`,
              }
            : {}),
        } as React.CSSProperties}
      >
        {isCollapsed ? (
          <div className="group-has-data-[collapsible=icon]/sidebar-wrapper:-translate-y flex w-full items-center justify-center">
            {/* Hover morph: NION -> arrow (1s) to hint expand action. */}
            <button
              type="button"
              aria-label={t.workspace.header.expandSidebar}
              onClick={toggleSidebar}
              onMouseEnter={() => playMorph(true)}
              onMouseLeave={() => playMorph(false)}
              onFocus={() => playMorph(true)}
              onBlur={() => playMorph(false)}
              className="group/nion-toggle relative flex h-10 w-16 items-center justify-center"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <svg
                viewBox="0 0 120 24"
                className="text-primary h-6 w-14"
                aria-hidden="true"
              >
                <g
                  ref={nionRef}
                  style={{
                    transformBox: "fill-box",
                    transformOrigin: "center",
                  }}
                >
                  <text
                    x="50%"
                    y="50%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-current font-serif"
                    letterSpacing="0.12em"
                    fontSize="18"
                  >
                    NION
                  </text>
                </g>
                <path
                  ref={arrowRef}
                  d="M34 12H86M78 6L86 12L78 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    transformBox: "fill-box",
                    transformOrigin: "center",
                  }}
                />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 w-full">
            {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" ? (
              <Link
                href="/"
                className="text-primary ml-2 shrink-0 font-serif"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                Nion
              </Link>
            ) : (
              <div className="text-primary ml-2 shrink-0 cursor-default font-serif">
                Nion
              </div>
            )}
            <SidebarTrigger style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties} />
            <div className="flex-1 min-w-0" />
          </div>
        )}
      </div>
    </>
  );
}
