"use client";

import {
  BrainCircuitIcon,
  CompassIcon,
  RocketIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WandSparklesIcon,
} from "lucide-react";
import { motion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

const reveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.55, ease: "easeOut" as const },
};

export function AboutSettingsPage() {
  const { t } = useI18n();
  const copy = t.settings.aboutPage;
  const valueCards = [
    {
      icon: SparklesIcon,
      title: copy.valueCards.startTitle,
      description: copy.valueCards.startDescription,
      tone: "from-amber-300/25 via-transparent to-transparent",
    },
    {
      icon: BrainCircuitIcon,
      title: copy.valueCards.visibleTitle,
      description: copy.valueCards.visibleDescription,
      tone: "from-sky-300/20 via-transparent to-transparent",
    },
    {
      icon: ShieldCheckIcon,
      title: copy.valueCards.stableTitle,
      description: copy.valueCards.stableDescription,
      tone: "from-emerald-300/20 via-transparent to-transparent",
    },
  ];
  const userScenarios = [
    {
      title: copy.scenarios.dailyBriefTitle,
      description: copy.scenarios.dailyBriefDescription,
    },
    {
      title: copy.scenarios.writingTitle,
      description: copy.scenarios.writingDescription,
    },
    {
      title: copy.scenarios.automationTitle,
      description: copy.scenarios.automationDescription,
    },
    {
      title: copy.scenarios.decompositionTitle,
      description: copy.scenarios.decompositionDescription,
    },
  ];
  const onboardingSteps = [
    {
      badge: copy.steps.step1Badge,
      title: copy.steps.step1Title,
      description: copy.steps.step1Description,
    },
    {
      badge: copy.steps.step2Badge,
      title: copy.steps.step2Title,
      description: copy.steps.step2Description,
    },
    {
      badge: copy.steps.step3Badge,
      title: copy.steps.step3Title,
      description: copy.steps.step3Description,
    },
  ];

  return (
    <div className="space-y-8 pb-2">
      <motion.section
        {...reveal}
        className="relative overflow-hidden rounded-3xl border border-foreground/10 bg-[linear-gradient(125deg,hsl(var(--foreground)/0.03),hsl(var(--background)),hsl(var(--foreground)/0.02))] p-6 md:p-10"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_20%,hsl(var(--primary)/0.2),transparent_36%),radial-gradient(circle_at_85%_15%,hsl(32_95%_62%/0.2),transparent_28%),radial-gradient(circle_at_85%_82%,hsl(196_95%_62%/0.14),transparent_34%)]" />
        <div className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(to_right,hsl(var(--foreground)/0.22)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--foreground)/0.22)_1px,transparent_1px)] [background-size:34px_34px]" />
        <div className="relative grid items-end gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <Badge variant="secondary" className="w-fit gap-1.5 px-3 py-1">
              <RocketIcon className="size-3.5" />
              {copy.heroBadge}
            </Badge>
            <div className="space-y-3">
              <h2 className="font-serif text-4xl leading-tight font-semibold tracking-tight md:text-5xl">
                {copy.heroTitleLine1}
                <br />
                {copy.heroTitleLine2}
              </h2>
              <p className="text-muted-foreground max-w-2xl text-sm leading-7 md:text-base">
                {copy.heroDescription}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{copy.tags.forUsers}</Badge>
              <Badge variant="outline">{copy.tags.transparent}</Badge>
              <Badge variant="outline">{copy.tags.iterative}</Badge>
              <Badge variant="outline">{copy.tags.evolving}</Badge>
            </div>
          </div>

          <div className="grid gap-3">
            {[
              {
                label: copy.metrics.lowBarrierLabel,
                value: copy.metrics.lowBarrierValue,
                hint: copy.metrics.lowBarrierHint,
              },
              {
                label: copy.metrics.responseModeLabel,
                value: copy.metrics.responseModeValue,
                hint: copy.metrics.responseModeHint,
              },
              {
                label: copy.metrics.deliveryLabel,
                value: copy.metrics.deliveryValue,
                hint: copy.metrics.deliveryHint,
              },
            ].map((item, index) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, x: 18 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 + index * 0.08, duration: 0.45, ease: "easeOut" }}
                className="rounded-2xl border border-foreground/10 bg-background/80 p-4 backdrop-blur-sm"
              >
                <div className="text-muted-foreground text-xs tracking-wide">{item.label}</div>
                <div className="mt-1 text-2xl font-semibold">{item.value}</div>
                <div className="text-muted-foreground mt-1 text-xs">{item.hint}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      <motion.section {...reveal} className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold tracking-tight">{copy.whyTitle}</h3>
          <p className="text-muted-foreground text-sm">
            {copy.whyDescription}
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {valueCards.map(({ icon: Icon, title, description, tone }, index) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.05 + index * 0.08, duration: 0.45, ease: "easeOut" }}
              whileHover={{ y: -4 }}
            >
              <Card className="relative h-full overflow-hidden border-foreground/10 py-0">
                <div className={cn("absolute inset-0 bg-gradient-to-br", tone)} />
                <CardContent className="relative flex h-full flex-col gap-3 p-5">
                  <div className="bg-primary/10 text-primary inline-flex size-9 items-center justify-center rounded-xl">
                    <Icon className="size-4.5" />
                  </div>
                  <div className="text-base font-medium">{title}</div>
                  <p className="text-muted-foreground text-sm leading-6">{description}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </motion.section>

      <motion.section {...reveal} className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="overflow-hidden border-foreground/10 py-0">
          <CardContent className="p-5 md:p-6">
            <div className="mb-4 flex items-center gap-2">
              <CompassIcon className="text-primary size-4.5" />
              <h3 className="text-base font-semibold">{copy.scenariosTitle}</h3>
            </div>
            <div className="grid gap-3">
              {userScenarios.map((item, index) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.05 + index * 0.07, duration: 0.4 }}
                  className="bg-muted/40 rounded-xl border border-foreground/10 p-4"
                >
                  <div className="text-sm font-medium">{item.title}</div>
                  <div className="text-muted-foreground mt-1 text-sm leading-6">{item.description}</div>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-foreground/10 py-0">
          <CardContent className="p-5 md:p-6">
            <div className="mb-4 flex items-center gap-2">
              <WandSparklesIcon className="text-primary size-4.5" />
              <h3 className="text-base font-semibold">{copy.stepsTitle}</h3>
            </div>
            <div className="space-y-3">
              {onboardingSteps.map((item, index) => (
                <div key={item.badge}>
                  {index > 0 ? <Separator className="mb-3" /> : null}
                  <div className="flex gap-3">
                    <Badge variant="outline" className="h-fit rounded-md px-2 py-0.5 text-[10px] tracking-wide">
                      {item.badge}
                    </Badge>
                    <div className="space-y-1">
                      <div className="text-sm font-medium">{item.title}</div>
                      <div className="text-muted-foreground text-sm leading-6">{item.description}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.section>

      <motion.section {...reveal}>
        <Card className="relative overflow-hidden border-foreground/10 bg-[linear-gradient(120deg,hsl(var(--primary)/0.16),hsl(var(--background)),hsl(var(--foreground)/0.03))] py-0">
          <div className="absolute inset-0 opacity-[0.2] [background-image:radial-gradient(hsl(var(--foreground)/0.45)_1px,transparent_1px)] [background-size:12px_12px]" />
          <CardContent className="relative flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1.5">
              <div className="font-serif text-2xl font-semibold tracking-tight">{copy.ctaTitle}</div>
              <p className="text-muted-foreground text-sm leading-6">
                {copy.ctaDescription}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="px-3 py-1 text-xs">
                {copy.ctaBadge}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </motion.section>
    </div>
  );
}
