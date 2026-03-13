"use client";

import {
  ChevronDownIcon,
  DownloadIcon,
  PackageIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/core/i18n/hooks";
import { useAppRouter as useRouter } from "@/core/navigation";
import { pathOfPluginAssistant } from "@/core/threads/utils";
import {
  createPluginStudioSession,
  exportInstalledPluginPackage,
  getPluginStudioSession,
  importPluginStudioSessionSource,
  loadPluginPackage,
  updateInstalledPluginMetadata,
  useInstallPlugin,
  useInstalledPluginPackage,
  useInstalledPlugins,
  useTogglePlugin,
  useUninstallPlugin,
  type InstalledPlugin,
  type PluginStudioSession,
} from "@/core/workbench";
import { BUNDLED_WORKBENCH_PLUGINS } from "@/plugins";

import { ConfirmActionDialog } from "./confirm-action-dialog";
import { SettingsSection } from "./settings-section";
import {
  detectUploadConflict,
  splitWorkbenchPlugins,
  type UploadConflict,
} from "./workbench-plugins-utils";

const BUILT_IN_WORKBENCH_PLUGIN_IDS = new Set(
  BUNDLED_WORKBENCH_PLUGINS.map((plugin) => plugin.id),
);

function triggerBrowserDownload(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

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
  plugins: InstalledPlugin[];
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const copy = t.settings.workbenchPlugins;
  const router = useRouter();
  const [filter, setFilter] = useState<string>("installed");
  const [pendingDeletePluginId, setPendingDeletePluginId] = useState<string | null>(null);
  const [debuggingPluginId, setDebuggingPluginId] = useState<string | null>(null);
  const [selectedBuiltInPluginId, setSelectedBuiltInPluginId] = useState<string | null>(null);
  const [pendingUploadConflict, setPendingUploadConflict] = useState<{
    file: File;
    manifest: { id: string; name: string };
    conflict: UploadConflict;
  } | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const { mutate: togglePlugin } = useTogglePlugin();
  const { mutate: uninstallPlugin, isPending: uninstallingPlugin } = useUninstallPlugin();
  const { mutate: installPlugin, isPending: installingPlugin } = useInstallPlugin();
  const {
    data: builtInPackage,
    isLoading: builtInPackageLoading,
  } = useInstalledPluginPackage(selectedBuiltInPluginId ?? "");

  const installedPluginMap = useMemo(
    () => new Map(plugins.map((plugin) => [plugin.manifest.id, plugin] as const)),
    [plugins],
  );

  const { myPlugins } = useMemo(
    () => splitWorkbenchPlugins(plugins, BUILT_IN_WORKBENCH_PLUGIN_IDS),
    [plugins],
  );

  const builtInPlugins = useMemo(
    () =>
      BUNDLED_WORKBENCH_PLUGINS
        .map((bundled) => installedPluginMap.get(bundled.id))
        .filter(Boolean) as InstalledPlugin[],
    [installedPluginMap],
  );

  const selectedBuiltInPlugin = useMemo(() => {
    if (!selectedBuiltInPluginId) {
      return null;
    }
    return installedPluginMap.get(selectedBuiltInPluginId) ?? null;
  }, [installedPluginMap, selectedBuiltInPluginId]);

  const builtInDetailMarkdown = useMemo(() => {
    const readme = builtInPackage?.files.get("README.md");
    if (readme?.encoding === "text" && readme.content.trim()) {
      return readme.content;
    }
    if (!selectedBuiltInPlugin) {
      return "";
    }
    return `# ${selectedBuiltInPlugin.manifest.name}\n\n\`\`\`json\n${JSON.stringify(selectedBuiltInPlugin.manifest, null, 2)}\n\`\`\`\n`;
  }, [builtInPackage, selectedBuiltInPlugin]);

  const navigateFromSettings = (href: string) => {
    router.push(href);
    onClose?.();
  };

  const handleCreatePlugin = () => {
    navigateFromSettings(pathOfPluginAssistant());
  };

  const handleUploadMenuClick = () => {
    uploadInputRef.current?.click();
  };

  const installUploadedPlugin = (file: File) => {
    installPlugin(
      { file },
      {
        onSuccess: (result) => {
          toast.success(copy.pluginInstalled.replaceAll("{name}", result.manifest.name));
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : copy.uploadFailed);
        },
      },
    );
  };

  const handleUploadPluginFile = async (event: ChangeEvent<HTMLInputElement>) => {
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

    try {
      const parsed = await loadPluginPackage(file);
      const conflict = detectUploadConflict(plugins, {
        id: parsed.manifest.id,
        name: parsed.manifest.name,
      });
      if (conflict) {
        setPendingUploadConflict({
          file,
          manifest: { id: parsed.manifest.id, name: parsed.manifest.name },
          conflict,
        });
        return;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.uploadFailed);
      return;
    }

    installUploadedPlugin(file);
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
        toast.error(error instanceof Error ? error.message : copy.deleteFailed);
      },
    });
  };

  const handleDownloadInstalledPlugin = async (pluginId: string, pluginName: string) => {
    try {
      const artifact = await exportInstalledPluginPackage(pluginId);
      triggerBrowserDownload(artifact);
      toast.success(copy.pluginDownloadSuccess.replaceAll("{name}", pluginName));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.pluginDownloadFailed);
    }
  };

  const handleDebugPlugin = async (pluginId: string, pluginName: string) => {
    const plugin = installedPluginMap.get(pluginId);
    if (!plugin) {
      toast.error(copy.pluginTestRunFailed);
      return;
    }

    try {
      setDebuggingPluginId(pluginId);
      const packageFile = await exportInstalledPluginPackage(pluginId);
      const reusedSessionId = plugin.pluginStudioSessionId?.trim();
      let session: PluginStudioSession | null = null;
      if (reusedSessionId) {
        try {
          session = await getPluginStudioSession(reusedSessionId);
        } catch {
          session = null;
        }
      }
      session ??= await createPluginStudioSession({
          pluginName: plugin.manifest.name,
          pluginId: plugin.manifest.id,
          description: plugin.manifest.description ?? "",
        });
      const imported = await importPluginStudioSessionSource(session.sessionId, {
        file: packageFile,
        pluginId: plugin.manifest.id,
        pluginName: plugin.manifest.name,
        description: plugin.manifest.description ?? "",
        threadId: session.previewThreadId ?? undefined,
      });

      await updateInstalledPluginMetadata(pluginId, {
        pluginStudioSessionId: imported.sessionId,
      });
      navigateFromSettings(
        `${pathOfPluginAssistant()}?session_id=${encodeURIComponent(imported.sessionId)}&from=debug&plugin_id=${encodeURIComponent(pluginId)}`,
      );
      toast.success(copy.testPluginOpenAssistantSuccess.replaceAll("{name}", pluginName));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.pluginTestRunFailed);
    } finally {
      setDebuggingPluginId((current) => (current === pluginId ? null : current));
    }
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
        {filter === "installed" ? (
          <div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" loading={installingPlugin} disabled={installingPlugin}>
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
                  {installingPlugin ? copy.uploading : copy.uploadPackage}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".nwp"
              className="hidden"
              onChange={(event) => {
                void handleUploadPluginFile(event);
              }}
            />
          </div>
        ) : null}
      </header>
      {myPlugins.length === 0 && filter === "installed" && (
        <EmptyPlugin onCreatePlugin={handleCreatePlugin} />
      )}
      {myPlugins.length > 0 &&
        filter === "installed" &&
        myPlugins.map((plugin) => (
          <Item className="w-full" variant="outline" key={plugin.manifest.id}>
            <ItemContent>
              <ItemTitle>
                <div className="flex items-center gap-2">
                  <span>{plugin.manifest.name}</span>
                  <span className="text-muted-foreground text-xs">v{plugin.version}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {copy.installedState}
                  </Badge>
                </div>
              </ItemTitle>
              <ItemDescription className="line-clamp-4">
                {plugin.manifest.description ?? copy.noDescription}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                size="sm"
                variant="ghost"
                disabled={debuggingPluginId !== null}
                onClick={() => {
                  void handleDebugPlugin(plugin.manifest.id, plugin.manifest.name);
                }}
              >
                <WrenchIcon className="size-4" />
                {debuggingPluginId === plugin.manifest.id
                  ? t.common.loading
                  : copy.debugPluginAction}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void handleDownloadInstalledPlugin(plugin.manifest.id, plugin.manifest.name);
                }}
              >
                <DownloadIcon className="size-4" />
                {copy.downloadAction}
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
          {builtInPlugins.length === 0 ? (
            <div className="text-muted-foreground text-sm">{copy.marketplaceEmpty}</div>
          ) : (
            builtInPlugins.map((plugin) => (
              <Item className="w-full" variant="outline" key={plugin.manifest.id}>
                <ItemContent>
                  <ItemTitle>
                    <div className="flex items-center gap-2">
                      <span>{plugin.manifest.name}</span>
                      <span className="text-muted-foreground text-xs">v{plugin.version}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {copy.builtInState}
                      </Badge>
                    </div>
                  </ItemTitle>
                  <ItemDescription className="line-clamp-4">
                    {plugin.manifest.description ?? copy.noDescription}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedBuiltInPluginId(plugin.manifest.id)}
                  >
                    {copy.marketplaceDetailAction}
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
                </ItemActions>
              </Item>
            ))
          )}

          {selectedBuiltInPluginId ? (
            <section className="rounded-lg border p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">{copy.marketplaceDetailTitle}</h4>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setSelectedBuiltInPluginId(null)}
                >
                  <XIcon className="size-4" />
                </Button>
              </div>
              {builtInPackageLoading ? (
                <div className="text-muted-foreground text-sm">{t.common.loading}</div>
              ) : builtInPackage ? (
                <div className="space-y-3">
                  <article className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {builtInDetailMarkdown}
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
        open={pendingUploadConflict !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingUploadConflict(null);
          }
        }}
        title={pendingUploadConflict?.conflict.kind === "name"
          ? copy.uploadDuplicateNameTitle
          : copy.uploadOverwriteTitle}
        description={(() => {
          if (!pendingUploadConflict) {
            return "";
          }
          if (pendingUploadConflict.conflict.kind === "name") {
            return copy.uploadDuplicateNameDescription
              .replaceAll("{name}", pendingUploadConflict.conflict.existing.manifest.name)
              .replaceAll("{existingId}", pendingUploadConflict.conflict.existing.manifest.id)
              .replaceAll("{newId}", pendingUploadConflict.manifest.id);
          }
          return copy.uploadOverwriteDescription
            .replaceAll("{name}", pendingUploadConflict.conflict.existing.manifest.name)
            .replaceAll("{version}", pendingUploadConflict.conflict.existing.version);
        })()}
        cancelText={copy.cancelAction}
        confirmText={pendingUploadConflict?.conflict.kind === "name"
          ? copy.uploadDuplicateNameConfirm
          : copy.uploadOverwriteConfirm}
        confirmDisabled={installingPlugin}
        onConfirm={() => {
          if (!pendingUploadConflict) {
            return;
          }
          const file = pendingUploadConflict.file;
          setPendingUploadConflict(null);
          installUploadedPlugin(file);
        }}
      />
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
