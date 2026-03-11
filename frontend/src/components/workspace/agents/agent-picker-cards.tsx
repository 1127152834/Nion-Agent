"use client";

import { BotIcon, CircleCheckIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { useAgents, useDefaultAgentConfig } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface AgentPickerCardsProps {
  selectedAgentName: string;
  className?: string;
}

type PickerAgent = {
  name: string;
  description: string;
};

type LaunchCardState = {
  agent: PickerAgent;
  route: string;
  origin: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  viewportHeight: number;
};

function routeOfAgent(agentName: string): string {
  if (agentName === "_default") {
    return "/workspace/chats/new";
  }
  return `/workspace/agents/${encodeURIComponent(agentName)}/chats/new`;
}

function rowGridClass(count: number): string {
  if (count <= 2) return "sm:grid-cols-2";
  if (count === 3) return "sm:grid-cols-2 lg:grid-cols-3";
  return "sm:grid-cols-2 xl:grid-cols-4";
}

function fanMetrics(index: number, count: number, isMobile: boolean): {
  x: number;
  y: number;
  angle: number;
  depth: number;
} {
  const center = (count - 1) / 2;
  const offset = index - center;
  const distance = Math.abs(offset);
  const spread = isMobile ? Math.min(28, 10 + count * 3) : Math.min(58, 18 + count * 4.8);
  const step = count > 1 ? spread / (count - 1) : 0;
  const angle = -spread / 2 + index * step;
  const x = offset * (isMobile ? 26 : 52);
  const y = distance * (isMobile ? 4.5 : 7.5);
  const depth = Math.round((count - distance) * 10);
  return { x, y, angle, depth };
}

function PickerCardFace({
  agent,
  selected,
  compact,
  pickerCopy,
}: {
  agent: PickerAgent;
  selected: boolean;
  compact?: boolean;
  pickerCopy: ReturnType<typeof useI18n>["t"]["agents"]["picker"];
}) {
  const name = agent.name === "_default" ? pickerCopy.defaultAgentName : agent.name;
  const description = agent.description || (agent.name === "_default"
    ? pickerCopy.defaultAgentDescription
    : pickerCopy.noDescription);

  return (
    <div
      className={cn(
        "relative h-full rounded-2xl border p-4 text-left",
        "bg-[linear-gradient(158deg,rgba(255,255,255,0.95),rgba(246,241,232,0.88))]",
        "shadow-[0_22px_38px_-28px_rgba(42,27,10,0.58),0_10px_20px_-16px_rgba(42,27,10,0.45)]",
        compact ? "p-3" : "p-4",
        selected
          ? "border-primary/55 ring-primary/24 ring-2"
          : "border-border/80",
      )}
    >
      <div className="pointer-events-none absolute top-0 right-0 left-0 h-12 rounded-t-2xl bg-[linear-gradient(180deg,rgba(255,255,255,0.28),rgba(255,255,255,0))]" />

      <div className="relative flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="bg-primary/12 text-primary flex size-7 shrink-0 items-center justify-center rounded-md border border-black/5">
            <BotIcon className="size-4" />
          </div>
          <p className="truncate text-sm font-semibold tracking-[0.01em]">{name}</p>
        </div>
        {selected ? (
          <CircleCheckIcon className="text-primary mt-0.5 size-4 shrink-0" />
        ) : null}
      </div>

      <p className={cn("text-muted-foreground mt-2 text-xs leading-5", compact ? "line-clamp-1" : "line-clamp-2")}>
        {description}
      </p>
    </div>
  );
}

export function AgentPickerCards({
  selectedAgentName,
  className,
}: AgentPickerCardsProps) {
  const { t } = useI18n();
  const pickerCopy = t.agents.picker;
  const router = useRouter();
  const isMobile = useIsMobile();
  const { config: defaultAgent } = useDefaultAgentConfig();
  const { agents } = useAgents();

  const cards = useMemo<PickerAgent[]>(
    () => [
      ...(defaultAgent ? [{ name: defaultAgent.name, description: defaultAgent.description }] : []),
      ...agents.map((agent) => ({
        name: agent.name,
        description: agent.description,
      })),
    ],
    [defaultAgent, agents],
  );

  const [isDealt, setIsDealt] = useState(false);
  const [hoveredAgentName, setHoveredAgentName] = useState<string | null>(null);
  const [launchState, setLaunchState] = useState<LaunchCardState | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const navigateTimerRef = useRef<number | null>(null);

  const cardCount = cards.length;
  const fanLayout = cardCount >= 5;
  const transitioning = launchState != null;

  useEffect(() => {
    if (cardCount <= 1) return;
    setIsDealt(false);
    if (prefersReducedMotion) {
      setIsDealt(true);
      return;
    }
    const timer = window.setTimeout(() => setIsDealt(true), 42);
    return () => window.clearTimeout(timer);
  }, [cardCount, fanLayout, prefersReducedMotion]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => () => {
    if (navigateTimerRef.current != null) {
      window.clearTimeout(navigateTimerRef.current);
    }
  }, []);

  const triggerSelect = (agent: PickerAgent, event?: MouseEvent<HTMLButtonElement>) => {
    const targetRoute = routeOfAgent(agent.name);
    const currentRoute = routeOfAgent(selectedAgentName);
    if (targetRoute === currentRoute || transitioning) {
      return;
    }

    if (prefersReducedMotion || !event) {
      router.push(targetRoute);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    setLaunchState({
      agent,
      route: targetRoute,
      origin: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      viewportHeight: window.innerHeight,
    });

    navigateTimerRef.current = window.setTimeout(() => {
      router.push(targetRoute);
    }, 560);
  };

  if (cardCount <= 1) {
    return null;
  }

  return (
    <div className={cn("relative w-full max-w-[980px]", className)}>
      <p className="text-muted-foreground mb-3 text-center text-xs tracking-wide">
        {pickerCopy.selectAgent}
      </p>

      {fanLayout ? (
        <div
          className={cn(
            "relative mx-auto flex w-full items-end justify-center [perspective:1400px]",
            isMobile ? "h-[220px]" : "h-[278px]",
          )}
        >
          {cards.map((agent, index) => {
            const selected = agent.name === selectedAgentName;
            const isHovered = hoveredAgentName === agent.name;
            const isLaunching = launchState?.agent.name === agent.name;
            const metrics = fanMetrics(index, cardCount, isMobile);
            const hoverLift = isHovered ? -24 : selected ? -8 : 0;

            return (
              <motion.button
                key={agent.name}
                type="button"
                onMouseEnter={() => setHoveredAgentName(agent.name)}
                onMouseLeave={() => setHoveredAgentName((current) => (
                  current === agent.name ? null : current
                ))}
                onFocus={() => setHoveredAgentName(agent.name)}
                onBlur={() => setHoveredAgentName((current) => (
                  current === agent.name ? null : current
                ))}
                onClick={(event) => triggerSelect(agent, event)}
                className={cn(
                  "absolute bottom-0 left-1/2 w-[min(250px,64vw)] max-w-[250px] -translate-x-1/2",
                  "rounded-2xl transition-shadow duration-300",
                  "focus-visible:ring-primary/45 focus-visible:outline-none focus-visible:ring-2",
                )}
                style={{
                  zIndex: isLaunching ? 150 : metrics.depth + (isHovered ? 20 : 0),
                  opacity: isLaunching ? 0 : undefined,
                }}
                initial={false}
                animate={{
                  x: isDealt ? metrics.x : 0,
                  y: isDealt ? metrics.y + hoverLift : 36,
                  rotate: isDealt ? metrics.angle : 0,
                  rotateX: isDealt ? 5 : 0,
                  scale: isHovered ? 1.035 : selected ? 1.015 : 1,
                  opacity: isDealt
                    ? transitioning
                      ? 0.34
                      : 1
                    : 0,
                }}
                transition={{
                  type: "spring",
                  stiffness: 260,
                  damping: 26,
                  mass: 0.85,
                  delay: isDealt ? index * 0.035 : 0,
                }}
              >
                <PickerCardFace
                  agent={agent}
                  selected={selected}
                  pickerCopy={pickerCopy}
                />
              </motion.button>
            );
          })}
        </div>
      ) : (
        <div className={cn("grid grid-cols-1 gap-3", rowGridClass(cardCount))}>
          {cards.map((agent, index) => {
            const selected = agent.name === selectedAgentName;
            const isHovered = hoveredAgentName === agent.name;
            const isLaunching = launchState?.agent.name === agent.name;
            return (
              <motion.button
                key={agent.name}
                type="button"
                onMouseEnter={() => setHoveredAgentName(agent.name)}
                onMouseLeave={() => setHoveredAgentName((current) => (
                  current === agent.name ? null : current
                ))}
                onFocus={() => setHoveredAgentName(agent.name)}
                onBlur={() => setHoveredAgentName((current) => (
                  current === agent.name ? null : current
                ))}
                onClick={(event) => triggerSelect(agent, event)}
                className={cn(
                  "w-full rounded-2xl transition-shadow duration-300",
                  "focus-visible:ring-primary/45 focus-visible:outline-none focus-visible:ring-2",
                )}
                style={{ opacity: isLaunching ? 0 : undefined }}
                initial={false}
                animate={{
                  y: isDealt ? (isHovered ? -14 : 0) : 22,
                  scale: isHovered ? 1.02 : 1,
                  opacity: isDealt
                    ? transitioning
                      ? 0.42
                      : 1
                    : 0,
                }}
                transition={{
                  type: "spring",
                  stiffness: 260,
                  damping: 24,
                  mass: 0.86,
                  delay: isDealt ? index * 0.05 : 0,
                }}
              >
                <PickerCardFace
                  agent={agent}
                  selected={selected}
                  compact={cardCount >= 4}
                  pickerCopy={pickerCopy}
                />
              </motion.button>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {launchState && !prefersReducedMotion ? (
          <>
            <motion.div
              className="pointer-events-none fixed inset-0 z-[160] bg-black"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.72 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            />

            <motion.div
              className="pointer-events-none fixed z-[170]"
              style={{
                left: launchState.origin.left,
                top: launchState.origin.top,
                width: launchState.origin.width,
                height: launchState.origin.height,
              }}
              initial={{
                x: 0,
                y: 0,
                rotate: 0,
                scale: 1,
                opacity: 1,
              }}
              animate={{
                x: [0, 12, 22],
                y: [0, -132, launchState.viewportHeight - launchState.origin.top + 86],
                rotate: [0, -4, 8],
                scale: [1, 1.08, 0.96],
                opacity: [1, 1, 0.9],
              }}
              transition={{
                duration: 0.62,
                times: [0, 0.43, 1],
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <PickerCardFace
                agent={launchState.agent}
                selected={true}
                pickerCopy={pickerCopy}
              />
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
