"use client";

import { PlayIcon, RefreshCcwIcon, TrashIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/core/i18n/hooks";
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

function statusLabel(status: string, isZh: boolean): string {
  if (!isZh) {
    return status;
  }
  if (status === "completed") return "已完成";
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已取消";
  if (status === "pending") return "待执行";
  return status;
}

export function ScheduledTaskManager() {
  const { locale } = useI18n();
  const isZh = locale.startsWith("zh");
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
      toast.error(isZh ? "请填写任务名称和 Prompt" : "Please fill in task name and prompt");
      return;
    }

    const trigger: CreateScheduledTaskRequest["trigger"] = { type: triggerType };
    if (triggerType === "cron") {
      trigger.cron_expression = triggerValue.trim();
    } else if (triggerType === "interval") {
      const seconds = Number(triggerValue);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        toast.error(isZh ? "间隔秒数必须大于 0" : "Interval seconds must be greater than 0");
        return;
      }
      trigger.interval_seconds = Math.floor(seconds);
    } else if (triggerType === "once") {
      const date = new Date(triggerValue);
      if (Number.isNaN(date.getTime())) {
        toast.error(isZh ? "请输入有效的执行时间" : "Please enter a valid execution time");
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
      toast.success(isZh ? "任务已创建" : "Task created");
      setName("");
      setPrompt("");
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (isZh ? "创建任务失败" : "Failed to create task"));
    }
  };

  const handleDelete = async (taskId: string) => {
    try {
      await deleteMutation.mutateAsync(taskId);
      if (selectedTaskId === taskId) {
        setSelectedTaskId(null);
      }
      toast.success(isZh ? "任务已删除" : "Task deleted");
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (isZh ? "删除任务失败" : "Failed to delete task"));
    }
  };

  const handleRun = async (taskId: string) => {
    try {
      await runMutation.mutateAsync(taskId);
      setSelectedTaskId(taskId);
      toast.success(isZh ? "任务已执行" : "Task executed");
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (isZh ? "执行任务失败" : "Failed to execute task"));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6">
      <section className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">
          {isZh ? "新建定时任务" : "Create Scheduled Task"}
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">{isZh ? "任务名称" : "Task name"}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="daily-market-report"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{isZh ? "触发类型" : "Trigger type"}</label>
            <select
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as TriggerType)}
            >
              <option value="cron">Cron</option>
              <option value="interval">{isZh ? "固定间隔(秒)" : "Interval (seconds)"}</option>
              <option value="once">{isZh ? "单次执行" : "Run once"}</option>
            </select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">
              {triggerType === "cron"
                ? (isZh ? "Cron 表达式" : "Cron expression")
                : triggerType === "interval"
                  ? (isZh ? "间隔秒数" : "Interval seconds")
                  : (isZh ? "执行时间" : "Execution time")}
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
            <label className="text-sm font-medium">{isZh ? "任务 Prompt" : "Task prompt"}</label>
            <textarea
              className="border-input bg-background min-h-24 w-full rounded-md border p-3 text-sm"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={isZh ? "分析小米汽车相关市场变化并生成摘要" : "Analyze market changes and generate a summary"}
            />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending
              ? (isZh ? "创建中..." : "Creating...")
              : (isZh ? "创建任务" : "Create task")}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isZh ? "任务列表" : "Task list"}</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isLoading}
          >
            <RefreshCcwIcon className="mr-2 size-4" />
            {isZh ? "刷新" : "Refresh"}
          </Button>
        </div>
        {isLoading ? (
          <p className="text-muted-foreground text-sm">{isZh ? "加载中..." : "Loading..."}</p>
        ) : sortedTasks.length === 0 ? (
          <p className="text-muted-foreground text-sm">{isZh ? "暂无任务" : "No tasks"}</p>
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
                        {statusLabel(task.status, isZh)}
                      </span>
                    </div>
                    <p className="text-muted-foreground truncate text-xs">
                      {isZh ? "下次执行：" : "Next run: "}
                      {task.next_run_at ?? "-"}
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
                      {isZh ? "立即执行" : "Run now"}
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
                      {isZh ? "删除" : "Delete"}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-semibold">{isZh ? "执行历史" : "Execution history"}</h2>
        {!selectedTaskId ? (
          <p className="text-muted-foreground text-sm">
            {isZh ? "请选择一个任务查看历史" : "Select a task to view history"}
          </p>
        ) : history.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {isZh ? "暂无执行记录" : "No execution records"}
          </p>
        ) : (
          <div className="space-y-2">
            {history.map((record) => (
              <div key={record.run_id} className="rounded-md border p-3 text-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium">{record.run_id}</span>
                  <span className={`rounded px-2 py-0.5 text-xs ${statusClass(record.status)}`}>
                    {statusLabel(record.status, isZh)}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {isZh ? "开始：" : "Start: "}
                  {record.started_at}
                  {" | "}
                  {isZh ? "结束：" : "End: "}
                  {record.completed_at ?? "-"}
                </p>
                {record.error ? (
                  <p className="mt-1 text-xs text-red-600">
                    {isZh ? "错误：" : "Error: "}
                    {record.error}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
