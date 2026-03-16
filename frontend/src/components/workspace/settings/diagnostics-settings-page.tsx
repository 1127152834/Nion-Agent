"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/core/i18n/hooks";
import { isElectron } from "@/core/platform";
import { getBackendBaseURL, getLangGraphBaseURL } from "@/core/config";
import { useRuntimeInfo } from "@/core/runtime-info/hooks";
import { useRuntimeTopology } from "@/core/runtime-topology/hooks";

function formatBool(value: boolean, copy: { booleanTrue: string; booleanFalse: string }) {
  return value ? copy.booleanTrue : copy.booleanFalse;
}

export function DiagnosticsSettingsPage() {
  const { t } = useI18n();
  const copy = t.settings.diagnostics;

  const runtimeTopology = useRuntimeTopology();
  const runtimeInfo = useRuntimeInfo();

  const platformType = isElectron() ? "electron" : "web";
  const windowOrigin = typeof window === "undefined" ? "-" : window.location.origin;
  const backendBaseUrl = getBackendBaseURL();
  const langgraphBaseUrl = getLangGraphBaseURL();

  const refresh = async () => {
    await Promise.all([runtimeTopology.refetch(), runtimeInfo.refetch()]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{copy.title}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{copy.description}</p>
        </div>
        <Button variant="outline" onClick={() => void refresh()}>
          {copy.refresh}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{copy.frontendTitle}</CardTitle>
          <p className="text-muted-foreground text-xs">{copy.frontendDescription}</p>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">{copy.platformType}</div>
            <div className="mt-1 font-mono">{platformType}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">{copy.windowOrigin}</div>
            <div className="mt-1 font-mono">{windowOrigin}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">{copy.backendBaseUrl}</div>
            <div className="mt-1 font-mono break-all">{backendBaseUrl}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">{copy.langgraphBaseUrl}</div>
            <div className="mt-1 font-mono break-all">{langgraphBaseUrl}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">{copy.gatewayTitle}</CardTitle>
            {runtimeTopology.data?.browser_should_use_gateway_facade ? (
              <Badge variant="secondary">{copy.gatewayFacadeBadge}</Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">{copy.gatewayDescription}</p>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {runtimeTopology.isLoading ? (
            <div className="text-muted-foreground text-sm">{copy.loading}</div>
          ) : runtimeTopology.error || !runtimeTopology.data ? (
            <div className="text-muted-foreground text-sm">{copy.unavailable}</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">{copy.runtimeMode}</div>
                <div className="mt-1 font-mono">{runtimeTopology.data.runtime_mode}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">{copy.langgraphUpstream}</div>
                <div className="mt-1 font-mono break-all">{runtimeTopology.data.langgraph_upstream}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">{copy.gatewayHost}</div>
                <div className="mt-1 font-mono">{runtimeTopology.data.gateway_host}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">{copy.gatewayPort}</div>
                <div className="mt-1 font-mono">{runtimeTopology.data.gateway_port}</div>
              </div>
              <div className="rounded-lg border p-3 sm:col-span-2">
                <div className="text-muted-foreground text-xs">{copy.gatewayFacadePath}</div>
                <div className="mt-1 font-mono break-all">{runtimeTopology.data.gateway_facade_path}</div>
              </div>
              <div className="rounded-lg border p-3 sm:col-span-2">
                <div className="text-muted-foreground text-xs">{copy.browserShouldUseGatewayFacade}</div>
                <div className="mt-1 font-mono">
                  {formatBool(runtimeTopology.data.browser_should_use_gateway_facade, copy)}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Runtime info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {runtimeInfo.isLoading ? (
            <div className="text-muted-foreground text-sm">{copy.loading}</div>
          ) : runtimeInfo.error || !runtimeInfo.data ? (
            <div className="text-muted-foreground text-sm">{copy.unavailable}</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">base_dir</div>
                <div className="mt-1 font-mono break-all">{runtimeInfo.data.base_dir}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">openviking_index_db</div>
                <div className="mt-1 font-mono break-all">{runtimeInfo.data.openviking_index_db}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">git_sha</div>
                <div className="mt-1 font-mono break-all">{runtimeInfo.data.git_sha ?? "-"}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">sentence-transformers</div>
                <div className="mt-1 font-mono">
                  {formatBool(runtimeInfo.data.sentence_transformers_available, copy)}
                </div>
              </div>
              <div className="rounded-lg border p-3 sm:col-span-2">
                <div className="text-muted-foreground text-xs">default_agent_normalized</div>
                <div className="mt-1 font-mono">
                  {runtimeInfo.data.default_agent_name} =&gt; {runtimeInfo.data.default_agent_normalized ?? "global(None)"}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

