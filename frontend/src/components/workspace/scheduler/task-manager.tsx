"use client";

import { PlayIcon, RefreshCcwIcon, TrashIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useCreateScheduledTask,
  useDeleteScheduledTask,
  useRunScheduledTaskNow,
  useScheduledTaskHistory,
  useScheduledTasks,
} from "@/core/scheduler";
import type { CreateScheduledTaskRequest, TriggerType } from "@/core/scheduler";

function statusClass(status: string): string {
  if (status === "completed") return "bg-emerald-100 text-emerald-700";
  if (status === "running") return "bg-blue-100 text-blue-700";
  if (status === "failed") return "bg-red-100 text-red-700";
  if (status === "cancelled") return "bg-gray-100 text-gray-700";
  return "bg-amber-100 text-amber-700";
}

export function ScheduledTaskManager() {
  const { tasks, isLoading, refetch } = useScheduledTasks();
  const createMutation = useCreateScheduledTask();
  const deleteMutation = useDeleteScheduledTask();
  const runMutation = useRunScheduledTaskNow();

  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [triggerType, setTriggerType] = useState<TriggerType>("cron");
  const [triggerValue, setTriggerValue] = useState("0 9 * * *");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const { history } = useScheduledTaskHistory(selectedTaskId);

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [tasks],
  );

  const handleCreate = async () => {
    if (!name.trim() || !prompt.trim()) {
      toast.error("请填写任务名称和 Prompt");
      return;
    }

    const trigger: CreateScheduledTaskRequest["trigger"] = { type: triggerType };
    if (triggerType === "cron") {
      trigger.cron_expression = triggerValue.trim();
    } else if (triggerType === "interval") {
      const seconds = Number(triggerValue);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        toast.error("间隔秒数必须大于 0");
        return;
      }
      trigger.interval_seconds = Math.floor(seconds);
    } else if (triggerType === "once") {
      const date = new Date(triggerValue);
      if (Number.isNaN(date.getTime())) {
        toast.error("请输入有效的执行时间");
        return;
      }
      trigger.scheduled_time = date.toISOString();
    }

    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        description: "",
        trigger,
        steps: [
          {
            id: "step-1",
            name: "default-step",
            parallel: false,
            depends_on: [],
            agents: [
              {
                agent_name: "general-purpose",
                prompt: prompt.trim(),
                timeout_seconds: 300,
                retry_on_failure: false,
                max_retries: 0,
              },
            ],
          },
        ],
        enabled: true,
        created_by: "workspace-user",
        max_concurrent_steps: 3,
        timeout_seconds: 3600,
      });
      toast.success("任务已创建");
      setName("");
      setPrompt("");
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建任务失败");
    }
  };

  const handleDelete = async (taskId: string) => {
    try {
      await deleteMutation.mutateAsync(taskId);
      if (selectedTaskId === taskId) {
        setSelectedTaskId(null);
      }
      toast.success("任务已删除");
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除任务失败");
    }
  };

  const handleRun = async (taskId: string) => {
    try {
      await runMutation.mutateAsync(taskId);
      setSelectedTaskId(taskId);
      toast.success("任务已执行");
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "执行任务失败");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6">
      <section className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">新建定时任务</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">任务名称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="daily-market-report"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">触发类型</label>
            <select
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as TriggerType)}
            >
              <option value="cron">Cron</option>
              <option value="interval">固定间隔(秒)</option>
              <option value="once">单次执行</option>
            </select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">
              {triggerType === "cron"
                ? "Cron 表达式"
                : triggerType === "interval"
                  ? "间隔秒数"
                  : "执行时间"}
            </label>
            <Input
              type={triggerType === "once" ? "datetime-local" : "text"}
              value={triggerValue}
              onChange={(e) => setTriggerValue(e.target.value)}
              placeholder={
                triggerType === "cron"
                  ? "0 9 * * *"
                  : triggerType === "interval"
                    ? "3600"
                    : "2026-03-07T09:00"
              }
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">任务 Prompt</label>
            <textarea
              className="border-input bg-background min-h-24 w-full rounded-md border p-3 text-sm"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="分析小米汽车相关市场变化并生成摘要"
            />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending ? "创建中..." : "创建任务"}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">任务列表</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isLoading}
          >
            <RefreshCcwIcon className="mr-2 size-4" />
            刷新
          </Button>
        </div>
        {isLoading ? (
          <p className="text-muted-foreground text-sm">加载中...</p>
        ) : sortedTasks.length === 0 ? (
          <p className="text-muted-foreground text-sm">暂无任务</p>
        ) : (
          <div className="space-y-3">
            {sortedTasks.map((task) => (
              <div
                key={task.id}
                className="hover:bg-muted/40 cursor-pointer rounded-md border p-3"
                onClick={() => setSelectedTaskId(task.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{task.name}</p>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${statusClass(task.status)}`}
                      >
                        {task.status}
                      </span>
                    </div>
                    <p className="text-muted-foreground truncate text-xs">
                      下次执行：{task.next_run_at ?? "-"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRun(task.id);
                      }}
                      disabled={runMutation.isPending}
                    >
                      <PlayIcon className="mr-1 size-4" />
                      立即执行
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(task.id);
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <TrashIcon className="mr-1 size-4" />
                      删除
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-semibold">执行历史</h2>
        {!selectedTaskId ? (
          <p className="text-muted-foreground text-sm">请选择一个任务查看历史</p>
        ) : history.length === 0 ? (
          <p className="text-muted-foreground text-sm">暂无执行记录</p>
        ) : (
          <div className="space-y-2">
            {history.map((record) => (
              <div key={record.run_id} className="rounded-md border p-3 text-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium">{record.run_id}</span>
                  <span className={`rounded px-2 py-0.5 text-xs ${statusClass(record.status)}`}>
                    {record.status}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  开始：{record.started_at} | 结束：{record.completed_at ?? "-"}
                </p>
                {record.error ? (
                  <p className="mt-1 text-xs text-red-600">错误：{record.error}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
