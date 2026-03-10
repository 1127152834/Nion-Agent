"use client";

import { ActivityIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getBackendBaseURL, getLangGraphBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { getPlatformType } from "@/core/platform";
import { useRuntimeTopology } from "@/core/runtime-topology";

import { SettingsSection } from "./settings-section";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 sm:grid-cols-[180px_1fr] sm:items-start">
      <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {label}
      </div>
      <div className="break-all font-mono text-xs leading-5 whitespace-pre-wrap">{value}</div>
    </div>
  );
}

export function RuntimeTopologySettingsPage() {
  const { t } = useI18n();
  const { data, isLoading, isFetching, error, refetch } = useRuntimeTopology();
  const [windowOrigin, setWindowOrigin] = useState("-");

  useEffect(() => {
    setWindowOrigin(window.location.origin);
  }, []);

  const frontendSnapshot = useMemo(
    () => ({
      platformType: getPlatformType(),
      backendBaseUrl: getBackendBaseURL(),
      langGraphBaseUrl: getLangGraphBaseURL(),
    }),
    [],
  );

  const boolText = (value: boolean) =>
    value ? t.settings.diagnostics.booleanTrue : t.settings.diagnostics.booleanFalse;

  return (
    <SettingsSection
      title={t.settings.diagnostics.title}
      description={t.settings.diagnostics.description}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1 rounded-full px-3 py-1 text-xs">
            <ActivityIcon className="size-3.5" />
            <span>{t.settings.diagnostics.gatewayFacadeBadge}</span>
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCwIcon className={isFetching ? "animate-spin" : ""} />
            <span>{t.settings.diagnostics.refresh}</span>
          </Button>
        </div>

        <Card className="border-border/70 py-0">
          <CardContent className="space-y-3 p-4">
            <div>
              <div className="text-sm font-semibold">{t.settings.diagnostics.frontendTitle}</div>
              <div className="text-muted-foreground mt-1 text-sm">
                {t.settings.diagnostics.frontendDescription}
              </div>
            </div>
            <DetailRow label={t.settings.diagnostics.platformType} value={frontendSnapshot.platformType} />
            <DetailRow label={t.settings.diagnostics.windowOrigin} value={windowOrigin} />
            <DetailRow label={t.settings.diagnostics.backendBaseUrl} value={frontendSnapshot.backendBaseUrl} />
            <DetailRow label={t.settings.diagnostics.langgraphBaseUrl} value={frontendSnapshot.langGraphBaseUrl} />
          </CardContent>
        </Card>

        <Card className="border-border/70 py-0">
          <CardContent className="space-y-3 p-4">
            <div>
              <div className="text-sm font-semibold">{t.settings.diagnostics.gatewayTitle}</div>
              <div className="text-muted-foreground mt-1 text-sm">
                {t.settings.diagnostics.gatewayDescription}
              </div>
            </div>

            {isLoading ? (
              <div className="text-muted-foreground text-sm">{t.settings.diagnostics.loading}</div>
            ) : error ? (
              <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                {error.message || t.settings.diagnostics.unavailable}
              </div>
            ) : data ? (
              <div className="space-y-3">
                <DetailRow label={t.settings.diagnostics.runtimeMode} value={data.runtime_mode} />
                <DetailRow label={t.settings.diagnostics.gatewayHost} value={data.gateway_host} />
                <DetailRow label={t.settings.diagnostics.gatewayPort} value={String(data.gateway_port)} />
                <DetailRow label={t.settings.diagnostics.gatewayFacadePath} value={data.gateway_facade_path} />
                <DetailRow label={t.settings.diagnostics.langgraphUpstream} value={data.langgraph_upstream} />
                <DetailRow label={t.settings.diagnostics.frontendAllowedOrigins} value={data.frontend_allowed_origins.join("\n") || "-"} />
                <DetailRow label={t.settings.diagnostics.corsRegex} value={data.cors_allow_origin_regex} />
                <DetailRow
                  label={t.settings.diagnostics.browserShouldUseGatewayFacade}
                  value={boolText(data.browser_should_use_gateway_facade)}
                />
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">{t.settings.diagnostics.unavailable}</div>
            )}
          </CardContent>
        </Card>
      </div>
    </SettingsSection>
  );
}
