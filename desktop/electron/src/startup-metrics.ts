import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type StartupFailureCode =
  | "none"
  | "network"
  | "port_conflict"
  | "python_dependency_missing"
  | "unknown";

export interface StartupStageMetric {
  name: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  status: "running" | "success" | "failed";
  retryCount: number;
  errorCode: StartupFailureCode | null;
  errorMessage: string | null;
}

export interface StartupSessionMetric {
  id: string;
  appVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: "running" | "success" | "failed";
  failureCode: StartupFailureCode | null;
  failureMessage: string | null;
  retryCount: number;
  stages: StartupStageMetric[];
}

export class StartupMetricsRecorder {
  private metricsPath: string;
  private currentSession: StartupSessionMetric | null = null;
  private maxSessions: number = 80;

  constructor(appDataDir: string) {
    this.metricsPath = path.join(appDataDir, "startup-metrics.json");
  }

  startSession(appVersion: string): string {
    const sessionId = `session-${Date.now()}`;

    this.currentSession = {
      id: sessionId,
      appVersion,
      platform: process.platform,
      arch: process.arch,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null,
      status: "running",
      failureCode: null,
      failureMessage: null,
      retryCount: 0,
      stages: []
    };

    return sessionId;
  }

  startStage(name: string): void {
    if (!this.currentSession) return;

    this.currentSession.stages.push({
      name,
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: null,
      status: "running",
      retryCount: 0,
      errorCode: null,
      errorMessage: null
    });
  }

  completeStage(name: string): void {
    if (!this.currentSession) return;

    const stage = this.currentSession.stages.find(s => s.name === name && s.status === "running");
    if (stage) {
      stage.endedAt = new Date().toISOString();
      stage.durationMs = new Date(stage.endedAt).getTime() - new Date(stage.startedAt).getTime();
      stage.status = "success";
    }
  }

  failStage(name: string, error: Error): void {
    if (!this.currentSession) return;

    const stage = this.currentSession.stages.find(s => s.name === name && s.status === "running");
    if (stage) {
      stage.endedAt = new Date().toISOString();
      stage.durationMs = new Date(stage.endedAt).getTime() - new Date(stage.startedAt).getTime();
      stage.status = "failed";
      stage.errorCode = this.classifyError(error);
      stage.errorMessage = error.message;
    }
  }

  completeSession(): void {
    if (!this.currentSession) return;

    this.currentSession.finishedAt = new Date().toISOString();
    this.currentSession.durationMs = new Date(this.currentSession.finishedAt).getTime() -
                                      new Date(this.currentSession.startedAt).getTime();
    this.currentSession.status = "success";

    this.saveSession();
    this.currentSession = null;
  }

  failSession(error: Error): void {
    if (!this.currentSession) return;

    this.currentSession.finishedAt = new Date().toISOString();
    this.currentSession.durationMs = new Date(this.currentSession.finishedAt).getTime() -
                                      new Date(this.currentSession.startedAt).getTime();
    this.currentSession.status = "failed";
    this.currentSession.failureCode = this.classifyError(error);
    this.currentSession.failureMessage = error.message;

    this.saveSession();
    this.currentSession = null;
  }

  getRecentSessions(limit: number = 10): StartupSessionMetric[] {
    const sessions = this.loadSessions();
    return sessions.slice(-limit).reverse();
  }

  private classifyError(error: Error): StartupFailureCode {
    const message = error.message.toLowerCase();

    if (message.includes("port") && message.includes("conflict")) {
      return "port_conflict";
    }
    if (message.includes("enotfound") || message.includes("econnrefused") ||
        message.includes("network") || message.includes("timeout")) {
      return "network";
    }
    if (message.includes("uv not found") || message.includes("pnpm not found") ||
        message.includes("python") || message.includes("dependency")) {
      return "python_dependency_missing";
    }

    return "unknown";
  }

  private saveSession(): void {
    if (!this.currentSession) return;

    const sessions = this.loadSessions();
    sessions.push(this.currentSession);

    // Keep only recent sessions
    const trimmed = sessions.slice(-this.maxSessions);

    writeFileSync(this.metricsPath, JSON.stringify(trimmed, null, 2));
  }

  private loadSessions(): StartupSessionMetric[] {
    if (existsSync(this.metricsPath)) {
      return JSON.parse(readFileSync(this.metricsPath, "utf-8"));
    }
    return [];
  }
}
