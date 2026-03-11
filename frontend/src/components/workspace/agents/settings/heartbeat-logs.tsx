"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHeartbeatLog, useHeartbeatLogs } from "@/core/agents/heartbeat-hooks";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

interface HeartbeatLogsViewerProps {
  agentName: string;
}

function statusClass(status: string): string {
  if (status === "success") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (status === "failed") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  if (status === "running") return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400";
}

function statusLabel(status: string, labels: {
  success: string;
  failed: string;
  running: string;
}): string {
  if (status === "success") return labels.success;
  if (status === "failed") return labels.failed;
  if (status === "running") return labels.running;
  return status;
}

export function HeartbeatLogsViewer({ agentName }: HeartbeatLogsViewerProps) {
  const { locale, t } = useI18n();
  const copy = t.agents.settings.logs;
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data: logs, isLoading, error } = useHeartbeatLogs({
    agentName,
    status: statusFilter || undefined,
    limit: 50,
  });

  const { data: selectedLog } = useHeartbeatLog(agentName, selectedLogId ?? "");

  const formatDate = (timestamp: string) => {
    return new Date(timestamp).toLocaleString(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-base">{copy.executionLogsTitle}</CardTitle>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">{copy.allStatus}</option>
            <option value="success">{copy.status.success}</option>
            <option value="failed">{copy.status.failed}</option>
            <option value="running">{copy.status.running}</option>
          </select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">
              {copy.loading}
            </div>
          ) : error ? (
            <div className="py-8 text-center text-destructive">
              {copy.loadLogsFailed}
            </div>
          ) : logs?.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              {copy.noLogs}
            </div>
          ) : (
            <div className="space-y-2">
              {logs?.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setSelectedLogId(log.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{log.heartbeat_type}</span>
                      <Badge className={cn("shrink-0", statusClass(log.status))}>
                        {statusLabel(log.status, copy.status)}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground text-xs mt-1">
                      {formatDate(log.timestamp)}
                    </div>
                  </div>
                  <div className="text-muted-foreground text-sm shrink-0 ml-4">
                    {formatDuration(log.duration_seconds)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Log Detail Dialog */}
      <Dialog open={!!selectedLogId} onOpenChange={() => setSelectedLogId(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              {copy.logDetailsTitle} - {selectedLog?.heartbeat_type}
            </DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Badge className={cn(statusClass(selectedLog.status))}>
                  {statusLabel(selectedLog.status, copy.status)}
                </Badge>
                <span className="text-muted-foreground text-sm">
                  {formatDate(selectedLog.timestamp)}
                </span>
                <span className="text-muted-foreground text-sm">
                  {copy.duration}: {formatDuration(selectedLog.duration_seconds)}
                </span>
              </div>
              {selectedLog.error_message && (
                <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
                  <strong>{copy.error}:</strong> {selectedLog.error_message}
                </div>
              )}
              <div>
                <h4 className="text-sm font-medium mb-2">
                  {copy.result}
                </h4>
                <pre className="bg-muted p-3 rounded-md overflow-auto text-xs max-h-60">
                  {JSON.stringify(selectedLog.result, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
