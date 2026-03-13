"use client";

import {
  ActivityIcon,
  ArrowRightIcon,
  BoxIcon,
  BotIcon,
  BrainCircuitIcon,
  CompassIcon,
  DatabaseIcon,
  Link2Icon,
  RocketIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShineBorder } from "@/components/ui/shine-border";
import { useI18n } from "@/core/i18n/hooks";
import { pathOfNewThread } from "@/core/threads/utils";

const reveal = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.16 },
  transition: { duration: 0.56, ease: "easeOut" as const },
};

const heroFloating = {
  animate: {
    x: [0, 10, -8, 0],
    y: [0, -12, 6, 0],
    scale: [1, 1.04, 0.98, 1],
  },
  transition: {
    duration: 18,
    repeat: Number.POSITIVE_INFINITY,
    ease: "easeInOut" as const,
  },
};

export function AboutPage() {
  const { t } = useI18n();
  const copy = t.settings.aboutPage;

  const proofMetrics = [
    {
      label: copy.proofMetrics.orchestrationLabel,
      value: copy.proofMetrics.orchestrationValue,
      hint: copy.proofMetrics.orchestrationHint,
      glow: "from-amber-300/25 via-amber-100/5 to-transparent",
    },
    {
      label: copy.proofMetrics.memoryLabel,
      value: copy.proofMetrics.memoryValue,
      hint: copy.proofMetrics.memoryHint,
      glow: "from-cyan-300/22 via-cyan-100/5 to-transparent",
    },
    {
      label: copy.proofMetrics.channelLabel,
      value: copy.proofMetrics.channelValue,
      hint: copy.proofMetrics.channelHint,
      glow: "from-emerald-300/22 via-emerald-100/5 to-transparent",
    },
  ];

  const capabilityCards = [
    {
      icon: BrainCircuitIcon,
      title: copy.capabilities.orchestrationTitle,
      value: copy.capabilities.orchestrationValue,
      proof: copy.capabilities.orchestrationProof,
      number: "01",
      surface: "from-amber-300/28 via-amber-100/10 to-transparent",
      layout: "md:col-span-4 md:row-span-2",
    },
    {
      icon: DatabaseIcon,
      title: copy.capabilities.memoryTitle,
      value: copy.capabilities.memoryValue,
      proof: copy.capabilities.memoryProof,
      number: "02",
      surface: "from-cyan-300/28 via-cyan-100/10 to-transparent",
      layout: "md:col-span-2",
    },
    {
      icon: BoxIcon,
      title: copy.capabilities.ecosystemTitle,
      value: copy.capabilities.ecosystemValue,
      proof: copy.capabilities.ecosystemProof,
      number: "03",
      surface: "from-indigo-300/24 via-indigo-100/8 to-transparent",
      layout: "md:col-span-2",
    },
    {
      icon: ActivityIcon,
      title: copy.capabilities.automationTitle,
      value: copy.capabilities.automationValue,
      proof: copy.capabilities.automationProof,
      number: "04",
      surface: "from-emerald-300/26 via-emerald-100/8 to-transparent",
      layout: "md:col-span-3",
    },
    {
      icon: Link2Icon,
      title: copy.capabilities.channelsTitle,
      value: copy.capabilities.channelsValue,
      proof: copy.capabilities.channelsProof,
      number: "05",
      surface: "from-sky-300/26 via-sky-100/8 to-transparent",
      layout: "md:col-span-3",
    },
  ];

  const trustCards = [
    {
      icon: ShieldCheckIcon,
      title: copy.trust.runtimeTitle,
      description: copy.trust.runtimeDescription,
      proof: copy.trust.runtimeProof,
      marker: "hsl(var(--chart-4))",
    },
    {
      icon: BrainCircuitIcon,
      title: copy.trust.memoryTitle,
      description: copy.trust.memoryDescription,
      proof: copy.trust.memoryProof,
      marker: "hsl(var(--chart-2))",
    },
    {
      icon: WrenchIcon,
      title: copy.trust.pluginTitle,
      description: copy.trust.pluginDescription,
      proof: copy.trust.pluginProof,
      marker: "hsl(var(--chart-1))",
    },
    {
      icon: ActivityIcon,
      title: copy.trust.taskTitle,
      description: copy.trust.taskDescription,
      proof: copy.trust.taskProof,
      marker: "hsl(var(--chart-3))",
    },
  ];

  const scenarios = [
    {
      icon: CompassIcon,
      title: copy.scenarios.infoTitle,
      result: copy.scenarios.infoResult,
      path: copy.scenarios.infoPath,
      tone: "from-amber-300/22 via-amber-100/5 to-transparent",
    },
    {
      icon: SparklesIcon,
      title: copy.scenarios.writingTitle,
      result: copy.scenarios.writingResult,
      path: copy.scenarios.writingPath,
      tone: "from-indigo-300/20 via-indigo-100/5 to-transparent",
    },
    {
      icon: RocketIcon,
      title: copy.scenarios.automationTitle,
      result: copy.scenarios.automationResult,
      path: copy.scenarios.automationPath,
      tone: "from-emerald-300/22 via-emerald-100/5 to-transparent",
    },
    {
      icon: BotIcon,
      title: copy.scenarios.channelTitle,
      result: copy.scenarios.channelResult,
      path: copy.scenarios.channelPath,
      tone: "from-sky-300/22 via-sky-100/5 to-transparent",
    },
  ];

  const messagePillars = [
    copy.messageHouse.pillars.orchestration,
    copy.messageHouse.pillars.memory,
    copy.messageHouse.pillars.ecosystem,
    copy.messageHouse.pillars.automation,
    copy.messageHouse.pillars.safety,
  ];

  return (
    <div className="relative isolate space-y-10 pb-8">
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-75 [background:radial-gradient(circle_at_8%_12%,hsl(var(--primary)/0.08),transparent_34%),radial-gradient(circle_at_88%_14%,hsl(var(--chart-4)/0.16),transparent_30%),radial-gradient(circle_at_76%_90%,hsl(var(--chart-2)/0.14),transparent_36%)]" />

      <motion.section
        {...reveal}
        className="relative overflow-hidden rounded-[2rem] border border-foreground/10 bg-[linear-gradient(125deg,hsl(var(--background))_20%,hsl(var(--foreground)/0.02)_52%,hsl(var(--background))_100%)] px-6 py-7 md:px-9 md:py-9"
      >
        <motion.div
          {...heroFloating}
          className="pointer-events-none absolute -top-14 -left-16 size-56 rounded-full bg-[radial-gradient(circle,hsl(var(--chart-4)/0.22)_0%,transparent_62%)] blur-2xl"
        />
        <motion.div
          {...heroFloating}
          transition={{ ...heroFloating.transition, duration: 24, delay: 0.8 }}
          className="pointer-events-none absolute right-0 bottom-0 size-64 rounded-full bg-[radial-gradient(circle,hsl(var(--chart-2)/0.22)_0%,transparent_66%)] blur-3xl"
        />
        <div className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(to_right,hsl(var(--foreground)/0.16)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--foreground)/0.16)_1px,transparent_1px)] [background-size:30px_30px]" />

        <div className="relative grid gap-7 xl:grid-cols-[1.12fr_0.88fr]">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="inline-flex items-center rounded-full border border-foreground/12 bg-background/85 px-3 py-1.5 backdrop-blur-sm">
                <span className="font-serif text-sm tracking-[0.26em]">NION</span>
              </div>
              <Badge variant="secondary" className="gap-1.5 px-3 py-1 text-xs tracking-wide">
                <RocketIcon className="size-3.5" />
                {copy.brand.eyebrow}
              </Badge>
            </div>

            <div className="space-y-4">
              <h1 className="font-serif text-4xl leading-[1.08] font-semibold tracking-tight md:text-5xl xl:text-6xl">
                {copy.brand.slogan}
              </h1>
              <p className="max-w-3xl text-sm leading-7 text-foreground/88 md:text-base md:leading-8">
                {copy.brand.subline}
              </p>
              <div className="rounded-2xl border border-foreground/10 bg-background/72 p-4 backdrop-blur-sm">
                <p className="text-muted-foreground text-sm leading-7 md:text-base">{copy.brand.masterClaim}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button asChild className="rounded-full px-5">
                <Link href={pathOfNewThread()}>
                  {copy.brand.ctaPrimary}
                  <ArrowRightIcon className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full border-foreground/20 px-5">
                <Link href="/workspace/agents">
                  <BotIcon className="size-4" />
                  {copy.brand.ctaSecondary}
                </Link>
              </Button>
            </div>

            <Card className="relative overflow-hidden border-foreground/10 bg-background/78 py-0">
              <div className="absolute inset-0 bg-[linear-gradient(125deg,hsl(var(--chart-4)/0.18),transparent_44%,hsl(var(--chart-2)/0.1))]" />
              <CardContent className="relative space-y-3 p-4 md:p-5">
                <div className="flex items-center gap-2 text-xs tracking-wide text-muted-foreground">
                  <SparklesIcon className="size-3.5" />
                  {copy.messageHouse.title}
                </div>
                <div className="font-serif text-xl leading-snug font-semibold md:text-2xl">{copy.messageHouse.promise}</div>
                <div className="flex flex-wrap gap-2">
                  {messagePillars.map((pillar) => (
                    <Badge key={pillar} variant="outline" className="rounded-full border-foreground/20 bg-background/75">
                      {pillar}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 self-end">
            {proofMetrics.map((item, index) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, x: 18 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.08 + index * 0.08, duration: 0.45, ease: "easeOut" }}
                whileHover={{ y: -3 }}
                className="group relative overflow-hidden rounded-2xl border border-foreground/12 bg-background/82 p-4 backdrop-blur-sm"
              >
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${item.glow} opacity-75 transition-opacity duration-300 group-hover:opacity-100`} />
                <div className="relative">
                  <div className="text-muted-foreground text-xs tracking-wide">{item.label}</div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight">{item.value}</div>
                  <div className="text-muted-foreground mt-1 text-xs leading-6">{item.hint}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      <motion.section {...reveal} className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-serif text-3xl font-semibold tracking-tight md:text-4xl">{copy.capabilitiesTitle}</h2>
          <p className="text-muted-foreground text-sm md:text-base">{copy.capabilitiesSubtitle}</p>
        </div>

        <div className="grid gap-3 md:grid-cols-6 md:auto-rows-[minmax(148px,auto)]">
          {capabilityCards.map(({ icon: Icon, title, value, proof, number, surface, layout }, index) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.05 + index * 0.06, duration: 0.44, ease: "easeOut" }}
              whileHover={{ y: -5 }}
              className={layout}
            >
              <Card className="group relative h-full overflow-hidden border-foreground/12 py-0">
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${surface} opacity-75 transition-opacity duration-300 group-hover:opacity-100`} />
                <CardContent className="relative flex h-full flex-col gap-3 p-5">
                  <div className="flex items-center justify-between">
                    <div className="bg-primary/10 text-primary inline-flex size-9 items-center justify-center rounded-xl">
                      <Icon className="size-4.5" />
                    </div>
                    <span className="text-muted-foreground/80 font-mono text-xs tracking-[0.24em]">{number}</span>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-base font-semibold tracking-tight">{title}</h3>
                    <p className="text-primary text-sm font-medium">{value}</p>
                    <p className="text-muted-foreground text-sm leading-6">{proof}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </motion.section>

      <motion.section
        {...reveal}
        className="relative overflow-hidden rounded-[1.75rem] border border-foreground/10 bg-[linear-gradient(140deg,hsl(var(--background))_15%,hsl(var(--foreground)/0.02)_58%,hsl(var(--background))_100%)] p-5 md:p-7"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,hsl(var(--chart-4)/0.16),transparent_32%),radial-gradient(circle_at_90%_85%,hsl(var(--chart-2)/0.14),transparent_34%)]" />
        <div className="relative grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-2">
            <h2 className="font-serif text-3xl font-semibold tracking-tight md:text-4xl">{copy.trustTitle}</h2>
            <p className="text-muted-foreground max-w-xl text-sm leading-7 md:text-base">{copy.trustSubtitle}</p>
          </div>

          <div className="relative space-y-3 pl-6">
            <div className="absolute top-0 bottom-0 left-[11px] w-px bg-gradient-to-b from-foreground/40 via-foreground/15 to-transparent" />
            {trustCards.map(({ icon: Icon, title, description, proof, marker }, index) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, x: 12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.06 + index * 0.06, duration: 0.4, ease: "easeOut" }}
                className="relative"
              >
                <span
                  className="absolute top-6 -left-[1.625rem] size-3 rounded-full border border-background"
                  style={{ backgroundColor: marker }}
                />
                <Card className="border-foreground/12 bg-background/80 py-0 backdrop-blur-sm">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center gap-2">
                      <div className="bg-primary/10 text-primary inline-flex size-8 items-center justify-center rounded-lg">
                        <Icon className="size-4" />
                      </div>
                      <h3 className="text-base font-semibold">{title}</h3>
                    </div>
                    <p className="text-sm leading-6 text-foreground/88">{description}</p>
                    <p className="text-muted-foreground text-sm leading-6">{proof}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      <motion.section {...reveal} className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-serif text-3xl font-semibold tracking-tight md:text-4xl">{copy.scenariosTitle}</h2>
          <p className="text-muted-foreground text-sm md:text-base">{copy.scenariosSubtitle}</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {scenarios.map(({ icon: Icon, title, result, path, tone }, index) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.04 + index * 0.06, duration: 0.42, ease: "easeOut" }}
              whileHover={{ y: -4 }}
            >
              <Card className="group relative h-full overflow-hidden border-foreground/10 py-0">
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tone} opacity-75 transition-opacity duration-300 group-hover:opacity-100`} />
                <CardContent className="relative space-y-3 p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="bg-primary/10 text-primary inline-flex size-8 items-center justify-center rounded-lg">
                        <Icon className="size-4" />
                      </div>
                      <h3 className="text-base font-semibold">{title}</h3>
                    </div>
                    <ArrowRightIcon className="text-muted-foreground size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                  </div>
                  <p className="text-primary text-sm font-medium leading-6">{result}</p>
                  <p className="text-muted-foreground text-sm leading-6">{path}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </motion.section>

      <motion.section {...reveal}>
        <Card className="relative overflow-hidden border-foreground/10 bg-[linear-gradient(120deg,hsl(var(--primary)/0.16),hsl(var(--background))_42%,hsl(var(--chart-2)/0.16)_100%)] py-0">
          <ShineBorder
            borderWidth={1.2}
            duration={11}
            shineColor={["rgba(22,22,22,0.65)", "rgba(215,178,116,0.55)", "rgba(104,178,188,0.5)"]}
          />
          <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(hsl(var(--foreground)/0.45)_1px,transparent_1px)] [background-size:12px_12px]" />
          <CardContent className="relative flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between md:p-7">
            <div className="space-y-2">
              <Badge variant="secondary" className="w-fit px-3 py-1 text-xs tracking-wide">
                {copy.ctaBadge}
              </Badge>
              <h2 className="font-serif text-2xl leading-tight font-semibold tracking-tight md:text-3xl">{copy.ctaTitle}</h2>
              <p className="text-muted-foreground max-w-2xl text-sm leading-7 md:text-base">{copy.ctaDescription}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button asChild className="rounded-full px-5">
                <Link href={pathOfNewThread()}>
                  {copy.ctaPrimary}
                  <ArrowRightIcon className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full border-foreground/20 px-5">
                <Link href="/workspace/agents">
                  <BotIcon className="size-4" />
                  {copy.ctaSecondary}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.section>
    </div>
  );
}
