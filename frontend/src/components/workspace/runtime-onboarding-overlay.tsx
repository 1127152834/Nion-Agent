"use client";

import { Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { isElectron } from "@/core/platform";

type ComponentStatus = "not_downloaded" | "downloading" | "downloaded" | "failed" | "skipped";

interface RuntimeComponentStatus {
  name: string;
  description: string;
  assetName: string;
  status: ComponentStatus;
  error?: string;
}

interface RuntimeStatusPayload {
  coreReady: boolean;
  onboardingCompleted: boolean;
  version: string;
  platform: string;
  arch: string;
  optionalComponents: RuntimeComponentStatus[];
}

interface RuntimeProgressPayload {
  name: string;
  progress: number;
}

function statusText(status: ComponentStatus): string {
  switch (status) {
    case "not_downloaded":
      return "未下载";
    case "downloading":
      return "下载中";
    case "downloaded":
      return "已就绪";
    case "failed":
      return "下载失败";
    case "skipped":
      return "已跳过";
    default:
      return "未知";
  }
}

function badgeVariant(status: ComponentStatus): "secondary" | "outline" | "destructive" {
  switch (status) {
    case "downloaded":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

export function RuntimeOnboardingOverlay() {
  const [status, setStatus] = useState<RuntimeStatusPayload | null>(null);
  const [busyComponent, setBusyComponent] = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const visible = useMemo(() => {
    if (!status) return false;
    return !status.onboardingCompleted;
  }, [status]);

  useEffect(() => {
    if (!isElectron() || !window.electronAPI) {
      setLoading(false);
      return;
    }

    let mounted = true;
    window.electronAPI
      .getRuntimeStatus()
      .then((payload) => {
        if (mounted) {
          setStatus(payload as RuntimeStatusPayload);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    window.electronAPI.onRuntimeDownloadProgress((payload: RuntimeProgressPayload) => {
      if (!mounted) return;
      setProgressMap((prev) => ({
        ...prev,
        [payload.name]: Math.max(0, Math.min(100, Math.round((payload.progress ?? 0) * 100))),
      }));
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (!isElectron() || loading || !status || !visible) {
    return null;
  }

  const refreshStatus = async () => {
    const latest = (await window.electronAPI?.getRuntimeStatus()) as RuntimeStatusPayload;
    setStatus(latest);
  };

  const handleDownload = async (name: string) => {
    try {
      setBusyComponent(name);
      setProgressMap((prev) => ({ ...prev, [name]: 0 }));
      await window.electronAPI?.downloadRuntimeComponent(name);
      await refreshStatus();
    } finally {
      setBusyComponent(null);
    }
  };

  const handleRetry = async (name: string) => {
    try {
      setBusyComponent(name);
      setProgressMap((prev) => ({ ...prev, [name]: 0 }));
      await window.electronAPI?.retryRuntimeComponent(name);
      await refreshStatus();
    } finally {
      setBusyComponent(null);
    }
  };

  const handleSkip = async (name: string) => {
    await window.electronAPI?.skipRuntimeComponent(name);
    await refreshStatus();
  };

  const handleContinue = async () => {
    await window.electronAPI?.completeRuntimeOnboarding();
    await refreshStatus();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6">
      <Card className="w-full max-w-3xl border-foreground/10">
        <CardHeader className="space-y-3">
          <CardTitle className="text-2xl">首次运行初始化</CardTitle>
          <p className="text-muted-foreground text-sm">
            核心运行时已就绪，可选组件可按需下载。你也可以先跳过，稍后在设置中继续安装。
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant={status.coreReady ? "secondary" : "destructive"}>
              核心状态: {status.coreReady ? "已就绪" : "未就绪"}
            </Badge>
            <Badge variant="outline">版本: {status.version}</Badge>
            <Badge variant="outline">
              平台: {status.platform}/{status.arch}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {status.optionalComponents.length === 0 ? (
            <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
              当前版本没有可选运行时组件，点击“继续进入工作区”即可。
            </div>
          ) : (
            status.optionalComponents.map((component) => {
              const progress = progressMap[component.name] ?? (component.status === "downloaded" ? 100 : 0);
              const isBusy = busyComponent === component.name;
              const canDownload = component.status === "not_downloaded" || component.status === "skipped";
              const canRetry = component.status === "failed";

              return (
                <div key={component.name} className="space-y-3 rounded-lg border border-foreground/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{component.description}</div>
                      <div className="text-muted-foreground mt-1 text-xs font-mono">{component.assetName}</div>
                    </div>
                    <Badge variant={badgeVariant(component.status)}>{statusText(component.status)}</Badge>
                  </div>
                  {(component.status === "downloading" || isBusy || progress > 0) && (
                    <Progress value={progress} className="h-2" />
                  )}
                  {component.error && component.status === "failed" && (
                    <div className="text-xs text-red-500">{component.error}</div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {canDownload && (
                      <Button
                        size="sm"
                        onClick={() => handleDownload(component.name)}
                        disabled={isBusy}
                      >
                        {isBusy ? <Loader2Icon className="mr-2 size-4 animate-spin" /> : null}
                        下载组件
                      </Button>
                    )}
                    {canRetry && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleRetry(component.name)}
                        disabled={isBusy}
                      >
                        {isBusy ? <Loader2Icon className="mr-2 size-4 animate-spin" /> : null}
                        重试
                      </Button>
                    )}
                    {component.status !== "downloaded" && component.status !== "downloading" && (
                      <Button size="sm" variant="ghost" onClick={() => handleSkip(component.name)} disabled={isBusy}>
                        跳过
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleContinue}>
              稍后处理
            </Button>
            <Button onClick={handleContinue}>继续进入工作区</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
