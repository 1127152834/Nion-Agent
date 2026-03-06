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
import { cn } from "@/lib/utils";

const reveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.55, ease: "easeOut" as const },
};

const valueCards = [
  {
    icon: SparklesIcon,
    title: "一句话开始",
    description: "你只要提出目标，Nion 会理解意图并主动推进。",
    tone: "from-amber-300/25 via-transparent to-transparent",
  },
  {
    icon: BrainCircuitIcon,
    title: "过程可见可控",
    description: "每一步都能看到进展，随时追加要求，不会“黑箱执行”。",
    tone: "from-sky-300/20 via-transparent to-transparent",
  },
  {
    icon: ShieldCheckIcon,
    title: "稳定且安全",
    description: "在受控环境执行任务，保障文件与流程的可靠性。",
    tone: "from-emerald-300/20 via-transparent to-transparent",
  },
];

const userScenarios = [
  {
    title: "每天 10 分钟信息快报",
    description: "自动整理资讯重点，给出结论与下一步建议。",
  },
  {
    title: "写作助手",
    description: "从提纲、初稿到润色，全程协作完成内容生产。",
  },
  {
    title: "数字工作流自动化",
    description: "把重复任务沉淀成固定流程，减少手工操作。",
  },
  {
    title: "复杂任务拆解执行",
    description: "多步骤目标自动分解，逐步交付而不是一次性失败。",
  },
];

const onboardingSteps = [
  {
    badge: "STEP 01",
    title: "描述你要达成的结果",
    description: "例如：\"帮我把今天的重要资讯整理成三条结论\"。",
  },
  {
    badge: "STEP 02",
    title: "查看执行过程并实时调整",
    description: "Nion 会持续反馈进度，你可以随时补充偏好与限制。",
  },
  {
    badge: "STEP 03",
    title: "拿到结果并一键迭代",
    description: "继续细化输出，直到最终结果符合你的真实需求。",
  },
];

export function AboutSettingsPage() {
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
              新一代个人智能工作台
            </Badge>
            <div className="space-y-3">
              <h2 className="font-serif text-4xl leading-tight font-semibold tracking-tight md:text-5xl">
                把复杂工作
                <br />
                变成一段自然对话
              </h2>
              <p className="text-muted-foreground max-w-2xl text-sm leading-7 md:text-base">
                Nion 为普通用户设计，不需要技术背景。你只要说出目标，它就会理解、拆解、执行并交付结果。
                从信息整理到内容创作，再到日常数字任务，整个过程都清晰可见。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">面向日常用户</Badge>
              <Badge variant="outline">流程透明</Badge>
              <Badge variant="outline">结果可迭代</Badge>
              <Badge variant="outline">持续进化</Badge>
            </div>
          </div>

          <div className="grid gap-3">
            {[
              { label: "上手门槛", value: "极低", hint: "只需自然语言描述目标" },
              { label: "响应方式", value: "多步骤推进", hint: "不是一次性输出" },
              { label: "交付标准", value: "可直接使用", hint: "结论 + 行动建议" },
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
          <h3 className="text-lg font-semibold tracking-tight">为什么这页像官网，而不是说明书</h3>
          <p className="text-muted-foreground text-sm">
            你看到的是“体验价值”，不是参数堆叠。普通用户关注的是能不能更快、更轻松地完成事情。
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
              <h3 className="text-base font-semibold">用户常见场景</h3>
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
              <h3 className="text-base font-semibold">三步上手路径</h3>
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
              <div className="font-serif text-2xl font-semibold tracking-tight">准备好把任务交给 Nion 了吗？</div>
              <p className="text-muted-foreground text-sm leading-6">
                从今天开始，把重复、繁琐、耗时的流程交给它，你专注在真正重要的判断与决策。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="px-3 py-1 text-xs">
                持续进化中
              </Badge>
            </div>
          </CardContent>
        </Card>
      </motion.section>
    </div>
  );
}
