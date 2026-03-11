"use client";

import {
  BarChart3Icon,
  BookOpenIcon,
  BotIcon,
  BrainCircuitIcon,
  CheckIcon,
  Code2Icon,
  GlobeIcon,
  SparklesIcon,
  TargetIcon,
  WandSparklesIcon,
} from "lucide-react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
} from "motion/react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";

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
  displayName: string;
  description: string;
  role: string;
  gradient: string;
  Icon: typeof BotIcon;
};

type TransitionPhase = "selection" | "zooming" | "sliding";

type TransitionState = {
  agent: PickerAgent;
  route: string;
  origin: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
};

const CARD_GRADIENTS = [
  "from-purple-500 to-indigo-600",
  "from-blue-500 to-cyan-600",
  "from-emerald-500 to-teal-600",
  "from-pink-500 to-rose-600",
  "from-orange-500 to-red-600",
  "from-yellow-400 to-orange-500",
  "from-sky-500 to-indigo-600",
  "from-fuchsia-500 to-violet-600",
] as const;

const CARD_ICONS = [
  SparklesIcon,
  BarChart3Icon,
  Code2Icon,
  BookOpenIcon,
  TargetIcon,
  GlobeIcon,
  BrainCircuitIcon,
  WandSparklesIcon,
] as const;

function routeOfAgent(agentName: string): string {
  if (agentName === "_default") {
    return "/workspace/chats/new";
  }
  return `/workspace/agents/${encodeURIComponent(agentName)}/chats/new`;
}

function hashIndex(source: string, modulo: number): number {
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return hash % modulo;
}

function rowGridClass(count: number): string {
  if (count <= 2) return "sm:grid-cols-2";
  if (count === 3) return "sm:grid-cols-2 lg:grid-cols-3";
  return "sm:grid-cols-2 xl:grid-cols-4";
}

function cardRole(
  model: string | null | undefined,
  pickerCopy: ReturnType<typeof useI18n>["t"]["agents"]["picker"],
): string {
  return model?.trim() ?? pickerCopy.defaultRole;
}

function PickerCardFace({
  agent,
  selected,
}: {
  agent: PickerAgent;
  selected: boolean;
}) {
  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden rounded-2xl bg-white p-3 text-center",
        "border transition-shadow",
        selected
          ? "border-emerald-500 shadow-2xl"
          : "border-stone-200/70 shadow-sm",
      )}
    >
      <div
        className={cn(
          "mx-auto mb-2 flex size-8 items-center justify-center rounded-xl",
          "bg-gradient-to-br text-white shadow-sm",
          agent.gradient,
        )}
      >
        <agent.Icon className="size-4" />
      </div>

      <h3 className="truncate text-sm font-bold tracking-tight text-stone-800">
        {agent.displayName}
      </h3>
      <p className="mb-1.5 truncate text-[8px] font-semibold tracking-[0.16em] text-stone-400 uppercase">
        {agent.role}
      </p>
      <p className="line-clamp-4 text-[10px] leading-relaxed text-stone-500">
        {agent.description}
      </p>

      {selected ? (
        <div className="absolute top-2 right-2 rounded-full bg-emerald-500/10 p-1 text-emerald-600">
          <CheckIcon className="size-3" />
        </div>
      ) : null}
    </div>
  );
}

function WheelCard({
  agent,
  index,
  centerIndex,
  anglePerCard,
  dragX,
  selected,
  transitioning,
  launching,
  onSelect,
}: {
  agent: PickerAgent;
  index: number;
  centerIndex: number;
  anglePerCard: number;
  dragX: ReturnType<typeof useMotionValue<number>>;
  selected: boolean;
  transitioning: boolean;
  launching: boolean;
  onSelect: (agent: PickerAgent, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const baseAngle = (index - centerIndex) * anglePerCard;
  const rotationOffset = useTransform(dragX, (x) => x * 0.1);
  const currentAngle = useTransform(rotationOffset, (rotation) => baseAngle + rotation);
  const x = useTransform(dragX, (raw) => -raw);

  const opacity = useTransform(currentAngle, [-50, -35, 0, 35, 50], [0, 1, 1, 1, 0]);
  const scale = useTransform(currentAngle, [-50, -25, 0, 25, 50], [0.7, 0.9, 1, 0.9, 0.7]);
  const blur = useTransform(currentAngle, [-50, -30, 0, 30, 50], ["blur(8px)", "blur(0px)", "blur(0px)", "blur(0px)", "blur(8px)"]);
  const baseZIndex = useTransform(currentAngle, (angle) => Math.round(100 - Math.abs(angle)));
  const pointerEvents = useTransform(currentAngle, (angle) =>
    Math.abs(angle) > 35 ? "none" : "auto",
  );

  return (
    <motion.button
      type="button"
      className="absolute bottom-0 left-1/2 -translate-x-1/2"
      onClick={(event) => onSelect(agent, event)}
      style={{
        transformOrigin: "50% 350px",
        rotate: currentAngle,
        x,
        zIndex: launching ? 220 : baseZIndex,
        pointerEvents,
        opacity: launching ? 0 : undefined,
      }}
      whileHover={transitioning ? undefined : { y: -16, scale: 1.05 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        style={{ opacity: transitioning ? 0.3 : opacity, scale, filter: blur }}
        initial={{ y: 150 }}
        animate={{ y: selected ? -8 : 0 }}
        transition={{
          type: "spring",
          stiffness: 100,
          damping: 15,
          delay: Math.min(index * 0.02, 0.5),
        }}
      >
        <motion.div
          layoutId={`picker-card-${agent.name}`}
          className="h-44 w-32"
        >
          <PickerCardFace agent={agent} selected={selected} />
        </motion.div>
      </motion.div>
    </motion.button>
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

  const cards = useMemo<PickerAgent[]>(() => {
    const input = [
      ...(defaultAgent
        ? [
            {
              name: defaultAgent.name,
              description: defaultAgent.description,
              model: defaultAgent.model,
            },
          ]
        : []),
      ...agents.map((agent) => ({
        name: agent.name,
        description: agent.description,
        model: agent.model,
      })),
    ];

    return input.map((agent) => {
      const gradientIndex = hashIndex(agent.name, CARD_GRADIENTS.length);
      const iconIndex = hashIndex(`${agent.name}:icon`, CARD_ICONS.length);
      return {
        name: agent.name,
        displayName:
          agent.name === "_default" ? pickerCopy.defaultAgentName : agent.name,
        description:
          agent.description ||
          (agent.name === "_default"
            ? pickerCopy.defaultAgentDescription
            : pickerCopy.noDescription),
        role: cardRole(agent.model, pickerCopy),
        gradient: CARD_GRADIENTS[gradientIndex] ?? CARD_GRADIENTS[0],
        Icon: CARD_ICONS[iconIndex] ?? BotIcon,
      };
    });
  }, [defaultAgent, agents, pickerCopy]);

  const [isDealt, setIsDealt] = useState(false);
  const [hoveredAgentName, setHoveredAgentName] = useState<string | null>(null);
  const [phase, setPhase] = useState<TransitionPhase>("selection");
  const [transitionState, setTransitionState] = useState<TransitionState | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const dragX = useMotionValue(0);
  const timersRef = useRef<number[]>([]);

  const cardCount = cards.length;
  const fanLayout = cardCount >= 5;
  const transitioning = phase !== "selection" && transitionState != null;

  useEffect(() => {
    if (cardCount <= 1) return;
    setIsDealt(false);
    if (prefersReducedMotion) {
      setIsDealt(true);
      return;
    }
    const timer = window.setTimeout(() => setIsDealt(true), 42);
    return () => window.clearTimeout(timer);
  }, [cardCount, prefersReducedMotion]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(
    () => () => {
      for (const timer of timersRef.current) {
        window.clearTimeout(timer);
      }
      timersRef.current = [];
    },
    [],
  );

  const triggerSelect = (agent: PickerAgent, event: MouseEvent<HTMLButtonElement>) => {
    const targetRoute = routeOfAgent(agent.name);
    const currentRoute = routeOfAgent(selectedAgentName);
    if (targetRoute === currentRoute || transitioning) {
      return;
    }

    if (prefersReducedMotion) {
      router.push(targetRoute);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    setTransitionState({
      agent,
      route: targetRoute,
      origin: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
    });
    setPhase("zooming");

    const zoomTimer = window.setTimeout(() => {
      setPhase("sliding");
    }, 1200);

    const navigateTimer = window.setTimeout(() => {
      router.push(targetRoute);
    }, 1800);

    timersRef.current = [zoomTimer, navigateTimer];
  };

  if (cardCount <= 1) {
    return null;
  }

  return (
    <div className={cn("relative w-full max-w-4xl", className)}>
      <p className="mb-3 text-center text-xs tracking-wide text-stone-500">
        {pickerCopy.selectAgent}
      </p>

      {fanLayout ? (
        (() => {
          const anglePerCard = Math.max(6, 20 - cardCount * 0.5);
          const centerIndex = (cardCount - 1) / 2;
          const maxDrag = centerIndex * anglePerCard * 10;

          return (
            <div
              className={cn(
                "relative flex w-full items-end justify-center overflow-visible",
                isMobile ? "h-[220px]" : "h-[236px]",
              )}
            >
              <motion.div
                drag="x"
                dragConstraints={{ left: -maxDrag, right: maxDrag }}
                dragElastic={0.1}
                dragTransition={{
                  power: 0.2,
                  timeConstant: 200,
                  bounceStiffness: 100,
                  bounceDamping: 15,
                }}
                style={{ x: dragX }}
                className={cn(
                  "absolute inset-0 flex items-end justify-center",
                  transitioning ? "cursor-default" : "cursor-grab active:cursor-grabbing",
                )}
              >
                {cards.map((agent, index) => {
                  const selected = agent.name === selectedAgentName;
                  const launching = transitionState?.agent.name === agent.name;
                  return (
                    <WheelCard
                      key={agent.name}
                      agent={agent}
                      index={index}
                      centerIndex={centerIndex}
                      anglePerCard={anglePerCard}
                      dragX={dragX}
                      selected={selected}
                      transitioning={transitioning}
                      launching={launching}
                      onSelect={triggerSelect}
                    />
                  );
                })}
              </motion.div>
            </div>
          );
        })()
      ) : (
        <div className={cn("grid grid-cols-1 gap-4", rowGridClass(cardCount))}>
          <AnimatePresence>
            {cards.map((agent, index) => {
              const selected = agent.name === selectedAgentName;
              const isHovered = hoveredAgentName === agent.name;
              const launching = transitionState?.agent.name === agent.name;
              return (
                <motion.button
                  key={agent.name}
                  type="button"
                  className={cn(
                    "flex justify-center rounded-2xl",
                    "focus-visible:ring-2 focus-visible:ring-emerald-500/45 focus-visible:outline-none",
                  )}
                  initial={{ opacity: 0, y: 100 }}
                  animate={{
                    opacity: isDealt ? (transitioning ? 0.36 : 1) : 0,
                    y: isDealt ? (isHovered ? -15 : selected ? -8 : 0) : 60,
                    scale: isHovered ? 1.08 : selected ? 1.03 : 1,
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 100,
                    damping: 15,
                    delay: isDealt ? index * 0.05 : 0,
                  }}
                  style={{ zIndex: launching ? 220 : selected ? 30 : 10, opacity: launching ? 0 : undefined }}
                  onMouseEnter={() => setHoveredAgentName(agent.name)}
                  onMouseLeave={() =>
                    setHoveredAgentName((current) =>
                      current === agent.name ? null : current,
                    )
                  }
                  onFocus={() => setHoveredAgentName(agent.name)}
                  onBlur={() =>
                    setHoveredAgentName((current) =>
                      current === agent.name ? null : current,
                    )
                  }
                  onClick={(event) => triggerSelect(agent, event)}
                >
                  <motion.div layoutId={`picker-card-${agent.name}`} className="h-44 w-32">
                    <PickerCardFace agent={agent} selected={selected} />
                  </motion.div>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {transitionState && !prefersReducedMotion ? (
          <>
            <motion.div
              className="pointer-events-none fixed inset-0 z-[220] bg-black"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.78 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            />

            <motion.div
              className="pointer-events-none fixed z-[230]"
              style={{
                left: transitionState.origin.left,
                top: transitionState.origin.top,
                width: transitionState.origin.width,
                height: transitionState.origin.height,
              }}
              initial={{ scale: 1, y: 0, rotate: 0, opacity: 1 }}
              animate={
                phase === "zooming"
                  ? { scale: 1.5, y: 0, rotate: 0, opacity: 1 }
                  : { scale: 1.5, y: "150vh", rotate: 10, opacity: 0.94 }
              }
              transition={
                phase === "zooming"
                  ? { type: "spring", damping: 20, stiffness: 100 }
                  : { duration: 0.6, ease: "easeIn" }
              }
            >
              <PickerCardFace agent={transitionState.agent} selected={true} />
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
