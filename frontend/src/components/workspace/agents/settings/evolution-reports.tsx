"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useAcceptSuggestion,
  useDismissSuggestion,
  useEvolutionReports,
  useEvolutionSuggestions,
} from "@/core/agents/evolution-hooks";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

interface EvolutionReportsViewerProps {
  agentName: string;
}

function statusClass(status: string): string {
  if (status === "completed") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (status === "failed") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  if (status === "pending") return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400";
}

function priorityClass(priority: string): string {
  if (priority === "HIGH") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  if (priority === "MEDIUM") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  if (priority === "LOW") return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400";
}

function suggestionStatusClass(status: string): string {
  if (status === "accepted") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (status === "dismissed") return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400";
  if (status === "pending") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400";
}

function statusLabel(status: string, labels: {
  completed: string;
  failed: string;
  pending: string;
  accepted: string;
  dismissed: string;
}): string {
  if (status === "completed") return labels.completed;
  if (status === "failed") return labels.failed;
  if (status === "pending") return labels.pending;
  if (status === "accepted") return labels.accepted;
  if (status === "dismissed") return labels.dismissed;
  return status;
}

function priorityLabel(priority: string, labels: {
  high: string;
  medium: string;
  low: string;
}): string {
  if (priority === "HIGH") return labels.high;
  if (priority === "MEDIUM") return labels.medium;
  if (priority === "LOW") return labels.low;
  return priority;
}

export function EvolutionReportsViewer({ agentName }: EvolutionReportsViewerProps) {
  const { locale, t } = useI18n();
  const copy = t.agents.settings.logs;
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data: reports, isLoading: reportsLoading, error: reportsError } = useEvolutionReports(agentName);
  const { data: suggestions, isLoading: suggestionsLoading, error: suggestionsError } = useEvolutionSuggestions(
    agentName,
    statusFilter || undefined
  );

  const dismissMutation = useDismissSuggestion(agentName);
  const acceptMutation = useAcceptSuggestion(agentName);

  const selectedSuggestion = suggestions?.find((s) => s.id === selectedSuggestionId);

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

  const handleDismiss = (suggestionId: string) => {
    dismissMutation.mutate(suggestionId);
    setSelectedSuggestionId(null);
  };

  const handleAccept = (suggestionId: string) => {
    acceptMutation.mutate(suggestionId);
    setSelectedSuggestionId(null);
  };

  return (
    <div className="space-y-6">
      {/* Reports Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{copy.reportsTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {reportsLoading ? (
            <div className="py-8 text-center text-muted-foreground">
              {copy.loading}
            </div>
          ) : reportsError ? (
            <div className="py-8 text-center text-destructive">
              {copy.loadReportsFailed}
            </div>
          ) : reports?.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              {copy.noReports}
            </div>
          ) : (
            <div className="space-y-2">
              {reports?.map((report) => (
                <div
                  key={report.report_id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{formatDate(report.timestamp)}</span>
                      <Badge className={cn("shrink-0", statusClass(report.status))}>
                        {statusLabel(report.status, copy.status)}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground text-xs mt-1">
                      {report.summary} • {report.suggestions.length} {copy.suggestionUnit}
                    </div>
                  </div>
                  <div className="text-muted-foreground text-sm shrink-0 ml-4">
                    {formatDuration(report.duration_seconds)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Suggestions Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-base">{copy.suggestionsTitle}</CardTitle>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">{copy.allStatus}</option>
            <option value="pending">{copy.status.pending}</option>
            <option value="accepted">{copy.status.accepted}</option>
            <option value="dismissed">{copy.status.dismissed}</option>
          </select>
        </CardHeader>
        <CardContent>
          {suggestionsLoading ? (
            <div className="py-8 text-center text-muted-foreground">
              {copy.loading}
            </div>
          ) : suggestionsError ? (
            <div className="py-8 text-center text-destructive">
              {copy.loadSuggestionsFailed}
            </div>
          ) : suggestions?.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              {copy.noSuggestions}
            </div>
          ) : (
            <div className="space-y-2">
              {suggestions?.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="flex items-start justify-between rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setSelectedSuggestionId(suggestion.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={cn("shrink-0", priorityClass(suggestion.priority))}>
                        {priorityLabel(suggestion.priority, copy.priority)}
                      </Badge>
                      <Badge className={cn("shrink-0", suggestionStatusClass(suggestion.status))}>
                        {statusLabel(suggestion.status, copy.status)}
                      </Badge>
                      <span className="text-muted-foreground text-xs">{suggestion.type}</span>
                    </div>
                    <p className="text-sm">{suggestion.content}</p>
                    <div className="text-muted-foreground text-xs mt-1">
                      {copy.confidence}: {(suggestion.confidence * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Suggestion Detail Dialog */}
      <Dialog open={!!selectedSuggestionId} onOpenChange={() => setSelectedSuggestionId(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{copy.suggestionDetailsTitle}</DialogTitle>
          </DialogHeader>
          {selectedSuggestion && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge className={cn(priorityClass(selectedSuggestion.priority))}>
                  {priorityLabel(selectedSuggestion.priority, copy.priority)}
                </Badge>
                <Badge className={cn(suggestionStatusClass(selectedSuggestion.status))}>
                  {statusLabel(selectedSuggestion.status, copy.status)}
                </Badge>
                <span className="text-muted-foreground text-sm">{selectedSuggestion.type}</span>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">{copy.suggestionContent}</h4>
                <p className="text-sm">{selectedSuggestion.content}</p>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">{copy.evidenceSummary}</h4>
                <p className="text-sm text-muted-foreground">{selectedSuggestion.evidence_summary}</p>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">{copy.impactScope}</h4>
                <p className="text-sm text-muted-foreground">{selectedSuggestion.impact_scope}</p>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">{copy.confidence}</h4>
                <p className="text-sm text-muted-foreground">
                  {(selectedSuggestion.confidence * 100).toFixed(0)}%
                </p>
              </div>

              {selectedSuggestion.status === "pending" && (
                <div className="flex gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => handleDismiss(selectedSuggestion.id)}
                    disabled={dismissMutation.isPending}
                  >
                    {dismissMutation.isPending ? copy.processing : copy.dismiss}
                  </Button>
                  <Button
                    onClick={() => handleAccept(selectedSuggestion.id)}
                    disabled={acceptMutation.isPending}
                  >
                    {acceptMutation.isPending ? copy.processing : copy.accept}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
