"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { exportTraceProcesslog } from "@/core/processlog";

type ProcessLogLevel = "all" | "debug" | "info" | "warn" | "error";

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ProcesslogViewerDialog({
  traceId,
  open,
  onOpenChange,
}: {
  traceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [level, setLevel] = useState<ProcessLogLevel>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<{ count: number; events: Array<Record<string, unknown>> } | null>(null);

  useEffect(() => {
    if (!open || !traceId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void exportTraceProcesslog(traceId)
      .then((data) => {
        if (cancelled) {
          return;
        }
        setPayload({
          count: data.count,
          events: data.events,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setPayload(null);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, traceId]);

  const filteredEvents = useMemo(() => {
    const events = payload?.events ?? [];
    if (level === "all") {
      return events;
    }
    return events.filter((event) => event.level === level);
  }, [level, payload?.events]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-full max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>系统日志</DialogTitle>
          <DialogDescription>
            {traceId ? (
              <span className="font-mono text-xs">trace_id: {traceId}</span>
            ) : (
              "缺少 trace_id"
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">级别</span>
            <Select
              value={level}
              onValueChange={(value: ProcessLogLevel) => setLevel(value)}
              disabled={!payload || loading}
            >
              <SelectTrigger className="h-8 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="debug">debug</SelectItem>
                <SelectItem value="info">info</SelectItem>
                <SelectItem value="warn">warn</SelectItem>
                <SelectItem value="error">error</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Badge variant="secondary">
            {loading ? "加载中..." : `${filteredEvents.length}/${payload?.count ?? 0}`}
          </Badge>
        </div>

        {error ? (
          <div className="rounded-xl border border-border/80 bg-muted/25 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="space-y-2">
          {filteredEvents.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              {loading ? "加载中..." : "暂无日志事件"}
            </div>
          ) : (
            filteredEvents.map((event) => {
              const id = typeof event.id === "string" ? event.id : "";
              const step = typeof event.step === "string" ? event.step : "-";
              const levelValue = typeof event.level === "string" ? event.level : "info";
              const createdAt = typeof event.created_at === "string" ? event.created_at : null;
              const duration = typeof event.duration_ms === "number" ? event.duration_ms : 0;
              const data = "data" in event ? event.data : null;
              return (
                <div key={id || step} className="rounded-2xl border border-border/80 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{levelValue}</Badge>
                      <span className="text-sm font-medium">{step}</span>
                      <span className="text-muted-foreground text-xs">
                        {duration}ms
                      </span>
                    </div>
                    <span className="text-muted-foreground text-xs font-mono">
                      {formatDateTime(createdAt)}
                    </span>
                  </div>
                  <details className="mt-2">
                    <summary className="text-muted-foreground cursor-pointer text-xs">
                      data
                    </summary>
                    <pre className="mt-2 overflow-x-auto rounded-xl bg-muted/30 p-3 text-xs leading-5">
                      {safeStringify(data)}
                    </pre>
                  </details>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
