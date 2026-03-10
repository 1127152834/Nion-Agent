"use client";

import { CheckCircle2Icon, ChevronDownIcon, PackageIcon, SparklesIcon, TestTube2Icon, Trash2Icon, UploadIcon, XCircleIcon, XIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemTitle,
  ItemContent,
  ItemDescription,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { pathOfNewThread, pathOfThread } from "@/core/threads/utils";
import {
  buildWorkbenchSlotRouteURL,
  ensurePluginTestThreadId,
  getInstalledPluginFiles,
  getInstalledPluginMetadataById,
  useInstallMarketplacePlugin,
  useInstalledPlugins,
  useWorkbenchMarketplacePluginDetail,
  useWorkbenchMarketplacePlugins,
  useInstallPlugin,
  useTestInstalledPlugin,
  useUninstallPlugin,
  useTogglePlugin,
  type WorkbenchPackageFile,
  type WorkbenchPluginManifestV2,
  type WorkbenchTargetRule,
} from "@/core/workbench";

import { ConfirmActionDialog } from "./confirm-action-dialog";
import { SettingsSection } from "./settings-section";

export function WorkbenchPluginsPage({ onClose }: { onClose?: () => void } = {}) {
  const { t } = useI18n();
  const { data: plugins, isLoading, error } = useInstalledPlugins();
  const copy = t.settings.workbenchPlugins;

  return (
    <SettingsSection
      title={copy.title}
      description={copy.description}
    >
      <div className="space-y-6">
        <section className="space-y-3 rounded-lg border p-4">
          {isLoading ? (
            <div className="text-muted-foreground text-sm">{t.common.loading}</div>
          ) : error ? (
            <div>{error.message}</div>
          ) : (
            <WorkbenchPluginsList plugins={plugins ?? []} onClose={onClose} />
          )}
        </section>
      </div>
    </SettingsSection>
  );
}

function WorkbenchPluginsList({
  plugins,
  onClose,
}: {
  plugins: Array<{
    manifest: {
      id: string;
      name: string;
      description?: string;
    };
    enabled: boolean;
    verified?: boolean;
    lastTestReport?: {
      summary: string;
      passed: boolean;
    } | null;
  }>;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const copy = t.settings.workbenchPlugins;
  const router = useRouter();
  const pathname = usePathname();
  const activeThreadId = useMemo(() => {
    const match = /\/workspace\/(?:agents\/[^/]+\/)?chats\/([^/?#]+)/.exec(pathname);
    if (!match?.[1]) {
      return undefined;
    }
    const decoded = decodeURIComponent(match[1]);
    return decoded === "new" ? undefined : decoded;
  }, [pathname]);
  const activeAgentRoute = useMemo(() => {
    const match = /\/workspace\/agents\/([^/]+)\/chats\/[^/?#]+/.exec(pathname);
    if (!match?.[1]) {
      return null;
    }
    return decodeURIComponent(match[1]);
  }, [pathname]);
  const [filter, setFilter] = useState<string>("installed");
  const [pendingDeletePluginId, setPendingDeletePluginId] = useState<string | null>(null);
  const [manualTestLoading, setManualTestLoading] = useState(false);
  const [selectedMarketplacePluginId, setSelectedMarketplacePluginId] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const { mutate: togglePlugin } = useTogglePlugin();
  const { mutate: uninstallPlugin, isPending: uninstallingPlugin } = useUninstallPlugin();
  const { mutate: installPlugin, isPending: installingPlugin } = useInstallPlugin();
  const { mutate: installMarketplacePlugin, isPending: installingMarketplacePlugin } = useInstallMarketplacePlugin();
  const { mutate: testPlugin, isPending: testingPlugin } = useTestInstalledPlugin();
  const {
    data: marketplacePlugins,
    isLoading: marketplaceLoading,
    error: marketplaceError,
  } = useWorkbenchMarketplacePlugins();
  const {
    data: marketplaceDetail,
    isLoading: marketplaceDetailLoading,
  } = useWorkbenchMarketplacePluginDetail(selectedMarketplacePluginId);

  const handleCreatePlugin = () => {
    onClose?.();
    router.push(`${pathOfNewThread()}?mode=plugin-assistant`);
  };

  const handleUploadMenuClick = () => {
    uploadInputRef.current?.click();
  };

  const handleUploadPluginFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    const filename = file.name.toLowerCase();
    if (!filename.endsWith(".nwp")) {
      toast.error(copy.uploadFormatError);
      return;
    }

    installPlugin(
      { file },
      {
        onSuccess: (result) => {
          toast.success(
            copy.pluginInstalled.replaceAll(
              "{name}",
              result.manifest.name,
            ),
          );
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : copy.uploadFailed,
          );
        },
      },
    );
  };

  const handleConfirmDeletePlugin = () => {
    if (!pendingDeletePluginId) {
      return;
    }
    uninstallPlugin(pendingDeletePluginId, {
      onSuccess: () => {
        toast.success(copy.pluginDeleted);
        setPendingDeletePluginId(null);
      },
      onError: (error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : copy.deleteFailed,
        );
      },
    });
  };

  const resolveThreadPath = (threadId: string) => {
    if (activeAgentRoute) {
      return `/workspace/agents/${encodeURIComponent(activeAgentRoute)}/chats/${encodeURIComponent(threadId)}`;
    }
    return pathOfThread(threadId);
  };

  const normalizePath = (path: string) => path.replace(/^\/+/, "");

  const extName = (path: string) => {
    const base = path.split("/").pop() ?? "";
    const idx = base.lastIndexOf(".");
    return idx > -1 ? base.slice(idx + 1).toLowerCase() : "";
  };

  const normalizeExtensions = (extensions?: string[]) =>
    new Set((extensions ?? []).map((ext) => ext.replace(/^\./, "").toLowerCase()));

  const pickTargetKind = (
    targets?: WorkbenchTargetRule[],
  ): "file" | "directory" | "project" => {
    if (!targets || targets.length === 0) return "file";
    if (targets.some((rule) => rule.kind === "file" || !rule.kind)) return "file";
    if (targets.some((rule) => rule.kind === "directory")) return "directory";
    if (targets.some((rule) => rule.kind === "project")) return "project";
    return "file";
  };

  const pickFixtureForPlugin = (
    manifest: WorkbenchPluginManifestV2,
    fixturePaths: string[],
  ) => {
    const extensionSet = new Set<string>();
    for (const rule of manifest.targets ?? []) {
      for (const ext of normalizeExtensions(rule.extensions)) {
        extensionSet.add(ext);
      }
    }
    const preferred = fixturePaths.find((fixture) => extensionSet.has(extName(fixture)));
    return preferred ?? fixturePaths[0] ?? null;
  };

  const decodePackageFile = (file: WorkbenchPackageFile): Blob => {
    if (file.encoding === "text") {
      return new Blob([file.content], { type: "text/plain;charset=utf-8" });
    }
    const binary = atob(file.content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: "application/octet-stream" });
  };

  const writeFixtureToThread = async (
    threadId: string,
    virtualPath: string,
    file: WorkbenchPackageFile,
  ) => {
    // Use artifacts API to materialize plugin fixture files into the sandbox workspace.
    const normalized = normalizePath(virtualPath);
    const response = await fetch(
      `${getBackendBaseURL()}/api/threads/${threadId}/artifacts/${normalized}`,
      {
        method: "PUT",
        body: decodePackageFile(file),
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Failed to write fixture: ${virtualPath}`);
    }
  };

  const ensureFallbackArtifact = async (
    threadId: string,
    manifest: WorkbenchPluginManifestV2,
  ) => {
    // If the plugin ships no fixtures, create a minimal file to open manually.
    const firstRule = manifest.targets?.find((rule) => rule.extensions?.length);
    const fallbackExt = firstRule?.extensions?.[0]?.replace(/^\./, "") || "txt";
    const fallbackPath = `/mnt/user-data/workspace/workbench-test.${fallbackExt}`;
    const content = `// Workbench plugin manual test\n// Plugin: ${manifest.name}\n`;
    await writeFixtureToThread(threadId, fallbackPath, {
      encoding: "text",
      content,
    });
    return fallbackPath;
  };

  const prepareManualTest = async (pluginId: string) => {
    const [metadata, files] = await Promise.all([
      getInstalledPluginMetadataById(pluginId),
      getInstalledPluginFiles(pluginId),
    ]);
    if (!metadata) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const manifest = metadata.manifest;
    const threadId = await ensurePluginTestThreadId();
    const fixturePaths = (manifest.fixtures ?? [])
      .map(normalizePath)
      .filter((fixture) => files.has(fixture));

    // Materialize all fixtures into the sandbox workspace for manual inspection.
    await Promise.all(
      fixturePaths.map((fixture) => {
        const file = files.get(fixture);
        if (!file) return Promise.resolve();
        const virtualPath = `/mnt/user-data/workspace/${fixture}`;
        return writeFixtureToThread(threadId, virtualPath, file);
      }),
    );

    const targetKind = pickTargetKind(manifest.targets);
    const fixture = pickFixtureForPlugin(manifest, fixturePaths);
    let artifactPath = fixture
      ? `/mnt/user-data/workspace/${fixture}`
      : await ensureFallbackArtifact(threadId, manifest);

    // Directory/project targets should open the containing folder, not a file.
    if (targetKind !== "file") {
      const parts = artifactPath.split("/");
      parts.pop();
      artifactPath = parts.join("/") || "/mnt/user-data/workspace";
    }

    return {
      threadId,
      artifactPath,
      pluginId: manifest.id,
      targetKind,
    };
  };

  const handleTestPlugin = async (pluginId: string, pluginName: string) => {
    testPlugin(
      { pluginId, threadId: activeThreadId },
      {
        onSuccess: (report) => {
          if (report.passed) {
            toast.success(copy.pluginTestPassed.replaceAll("{name}", pluginName));
          } else {
            toast.error(copy.pluginTestFailed.replaceAll("{name}", pluginName));
          }
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : copy.pluginTestRunFailed);
        },
      },
    );

    // Always open a manual test session in the right sidebar plugin slot.
    try {
      setManualTestLoading(true);
      const manual = await prepareManualTest(pluginId);
      const targetPath = resolveThreadPath(manual.threadId);
      const targetURL = buildWorkbenchSlotRouteURL({
        pathname: targetPath,
        pluginId: manual.pluginId,
        artifactPath: manual.artifactPath,
        targetKind: manual.targetKind,
      });
      onClose?.();
      router.push(targetURL);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.pluginTestRunFailed);
    } finally {
      setManualTestLoading(false);
    }
  };

  const handleInstallMarketplacePlugin = (pluginId: string, pluginName: string) => {
    installMarketplacePlugin(pluginId, {
      onSuccess: () => {
        toast.success(copy.marketplaceInstallSuccess.replaceAll("{name}", pluginName));
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : copy.marketplaceInstallFailed);
      },
    });
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex justify-between">
        <div className="flex gap-2">
          <Tabs defaultValue="installed" onValueChange={setFilter}>
            <TabsList variant="line">
              <TabsTrigger value="installed">
                {copy.installed}
              </TabsTrigger>
              <TabsTrigger value="marketplace">
                {copy.marketplace}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" disabled={installingPlugin}>
                <PackageIcon className="size-4" />
                {copy.addPlugin}
                <ChevronDownIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={handleCreatePlugin}>
                <SparklesIcon className="size-4 text-muted-foreground" />
                {copy.createViaSkill}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={handleUploadMenuClick}
                disabled={installingPlugin}
              >
                <UploadIcon className="size-4 text-muted-foreground" />
                {installingPlugin
                  ? copy.uploading
                  : copy.uploadPackage}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={uploadInputRef}
            type="file"
            accept=".nwp"
            className="hidden"
            onChange={handleUploadPluginFile}
          />
        </div>
      </header>
      {plugins.length === 0 && filter === "installed" && (
        <EmptyPlugin onCreatePlugin={handleCreatePlugin} />
      )}
      {plugins.length > 0 &&
        filter === "installed" &&
        plugins.map((plugin) => (
          <Item className="w-full" variant="outline" key={plugin.manifest.id}>
            <ItemContent>
              <ItemTitle>
                <div className="flex items-center gap-2">
                  {plugin.manifest.name}
                  {plugin.verified ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                      <CheckCircle2Icon className="size-3.5" />
                      {copy.verified}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
                      <XCircleIcon className="size-3.5" />
                      {copy.unverified}
                    </span>
                  )}
                </div>
              </ItemTitle>
              <ItemDescription className="line-clamp-4">
                {plugin.manifest.description ?? copy.noDescription}
                {plugin.lastTestReport?.summary ? ` • ${plugin.lastTestReport.summary}` : ""}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                size="sm"
                variant="ghost"
                disabled={testingPlugin || manualTestLoading}
                onClick={() => {
                  void handleTestPlugin(plugin.manifest.id, plugin.manifest.name);
                }}
              >
                <TestTube2Icon className="size-4" />
                {copy.testPluginAction}
              </Button>
              <Switch
                checked={plugin.enabled}
                onCheckedChange={(checked) =>
                  togglePlugin({
                    pluginId: plugin.manifest.id,
                    enabled: checked,
                  })
                }
              />
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-rose-600 hover:text-rose-600"
                disabled={uninstallingPlugin}
                onClick={() => {
                  setPendingDeletePluginId(plugin.manifest.id);
                }}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </ItemActions>
          </Item>
        ))}
      {filter === "marketplace" && (
        <div className="flex flex-col gap-3">
          {marketplaceLoading ? (
            <div className="text-muted-foreground text-sm">{t.common.loading}</div>
          ) : marketplaceError ? (
            <div className="text-sm text-rose-600">{marketplaceError.message}</div>
          ) : (marketplacePlugins?.length ?? 0) === 0 ? (
            <div className="text-muted-foreground text-sm">{copy.marketplaceEmpty}</div>
          ) : (
            marketplacePlugins?.map((item) => (
              <Item className="w-full" variant="outline" key={item.id}>
                <ItemContent>
                  <ItemTitle>
                    <div className="flex items-center gap-2">
                      <span>{item.name}</span>
                      <span className="text-muted-foreground text-xs">v{item.version}</span>
                    </div>
                  </ItemTitle>
                  <ItemDescription className="line-clamp-4">
                    {item.description}
                  </ItemDescription>
                  {item.tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.tags.map((tag) => (
                        <span
                          key={`${item.id}:${tag}`}
                          className="bg-muted inline-flex rounded px-1.5 py-0.5 text-[10px]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </ItemContent>
                <ItemActions>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedMarketplacePluginId(item.id)}
                  >
                    {copy.marketplaceDetailAction}
                  </Button>
                  <Button
                    size="sm"
                    disabled={installingMarketplacePlugin}
                    onClick={() => handleInstallMarketplacePlugin(item.id, item.name)}
                  >
                    {installingMarketplacePlugin ? copy.marketplaceInstalling : copy.marketplaceInstallAction}
                  </Button>
                </ItemActions>
              </Item>
            ))
          )}

          {selectedMarketplacePluginId ? (
            <section className="rounded-lg border p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">{copy.marketplaceDetailTitle}</h4>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setSelectedMarketplacePluginId(null)}
                >
                  <XIcon className="size-4" />
                </Button>
              </div>
              {marketplaceDetailLoading ? (
                <div className="text-muted-foreground text-sm">{t.common.loading}</div>
              ) : marketplaceDetail ? (
                <div className="space-y-3">
                  {marketplaceDetail.demoImageUrls.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {marketplaceDetail.demoImageUrls.map((url) => (
                        <img
                          key={url}
                          src={url}
                          alt={marketplaceDetail.name}
                          className="h-auto w-full rounded border"
                        />
                      ))}
                    </div>
                  ) : null}
                  <article className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {marketplaceDetail.readmeMarkdown}
                    </ReactMarkdown>
                  </article>
                </div>
              ) : (
                <div className="text-muted-foreground text-sm">{copy.marketplaceDetailEmpty}</div>
              )}
            </section>
          ) : null}
        </div>
      )}
      <ConfirmActionDialog
        open={pendingDeletePluginId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeletePluginId(null);
          }
        }}
        title={copy.deleteConfirmTitle}
        description={
          copy.deleteConfirmDescription.replaceAll(
            "{name}",
            plugins.find((p) => p.manifest.id === pendingDeletePluginId)?.manifest.name ?? "",
          )
        }
        cancelText={copy.cancelAction}
        confirmText={copy.confirmDeleteAction}
        confirmDisabled={uninstallingPlugin}
        onConfirm={handleConfirmDeletePlugin}
        confirmVariant="destructive"
      />
    </div>
  );
}

function EmptyPlugin({ onCreatePlugin }: { onCreatePlugin: () => void }) {
  const { t } = useI18n();
  const copy = t.settings.workbenchPlugins;
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PackageIcon />
        </EmptyMedia>
        <EmptyTitle>{copy.emptyTitle}</EmptyTitle>
        <EmptyDescription>
          {copy.emptyDescription}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onCreatePlugin}>
          {copy.emptyButton}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
