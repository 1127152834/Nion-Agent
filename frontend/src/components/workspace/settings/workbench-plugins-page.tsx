"use client";

import { ChevronDownIcon, PackageIcon, SparklesIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";
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
import { useI18n } from "@/core/i18n/hooks";
import {
  useInstalledPlugins,
  useInstallPlugin,
  useUninstallPlugin,
  useTogglePlugin,
} from "@/core/workbench";

import { ConfirmActionDialog } from "./confirm-action-dialog";
import { SettingsSection } from "./settings-section";

export function WorkbenchPluginsPage({ onClose }: { onClose?: () => void } = {}) {
  const { t } = useI18n();
  const { data: plugins, isLoading, error } = useInstalledPlugins();

  return (
    <SettingsSection
      title={t.settings.workbenchPlugins?.title ?? "Workbench Plugins"}
      description={
        t.settings.workbenchPlugins?.description
        ?? "Manage workbench plugins for different artifact types"
      }
    >
      <div className="space-y-6">
        <section className="space-y-3 rounded-lg border p-4">
          {isLoading ? (
            <div className="text-muted-foreground text-sm">{t.common.loading}</div>
          ) : error ? (
            <div>Error: {error.message}</div>
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
      version: string;
      description?: string;
      author?: string;
    };
    enabled: boolean;
  }>;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const m = t.migration.settings?.workbenchPlugins;
  const router = useRouter();
  const [filter, setFilter] = useState<string>("installed");
  const [pendingDeletePluginId, setPendingDeletePluginId] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const { mutate: togglePlugin } = useTogglePlugin();
  const { mutate: uninstallPlugin, isPending: uninstallingPlugin } = useUninstallPlugin();
  const { mutate: installPlugin, isPending: installingPlugin } = useInstallPlugin();

  const handleCreatePlugin = () => {
    onClose?.();
    router.push("/workspace/chats/new?mode=workbench-plugin");
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
      toast.error(m?.uploadFormatError ?? "Please upload a .nwp package");
      return;
    }

    installPlugin(
      { file },
      {
        onSuccess: (result) => {
          toast.success(
            (m?.pluginInstalled ?? "Plugin \"{name}\" installed").replaceAll(
              "{name}",
              result.manifest.name,
            ),
          );
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : (m?.uploadFailed ?? "Failed to upload plugin"),
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
        toast.success(m?.pluginDeleted ?? "Plugin deleted");
        setPendingDeletePluginId(null);
      },
      onError: (error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : (m?.deleteFailed ?? "Failed to delete plugin"),
        );
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
                {m?.installed ?? "Installed"}
              </TabsTrigger>
              <TabsTrigger value="marketplace" disabled>
                {m?.marketplace ?? "Marketplace"}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" disabled={installingPlugin}>
                <PackageIcon className="size-4" />
                {m?.addPlugin ?? "Add Plugin"}
                <ChevronDownIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={handleCreatePlugin}>
                <SparklesIcon className="size-4 text-muted-foreground" />
                {m?.createViaSkill ?? "Create plugin via skill"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={handleUploadMenuClick}
                disabled={installingPlugin}
              >
                <UploadIcon className="size-4 text-muted-foreground" />
                {installingPlugin
                  ? (m?.uploading ?? "Uploading...")
                  : (m?.uploadPackage ?? "Upload .nwp package")}
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
                  <span className="text-muted-foreground text-xs">
                    v{plugin.manifest.version}
                  </span>
                </div>
              </ItemTitle>
              <ItemDescription className="line-clamp-4">
                {plugin.manifest.description ?? "No description"}
                {plugin.manifest.author && (
                  <span className="text-muted-foreground text-xs">
                    {" "}
                    • by {plugin.manifest.author}
                  </span>
                )}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
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
      <ConfirmActionDialog
        open={pendingDeletePluginId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeletePluginId(null);
          }
        }}
        title={m?.deleteConfirmTitle ?? "Confirm Plugin Deletion"}
        description={
          (
            m?.deleteConfirmDescription
            ?? "Delete plugin \"{name}\"? This action cannot be undone."
          ).replaceAll(
            "{name}",
            plugins.find((p) => p.manifest.id === pendingDeletePluginId)?.manifest.name ?? "",
          )
        }
        cancelText={m?.cancelAction ?? "Cancel"}
        confirmText={m?.confirmDeleteAction ?? "Delete"}
        confirmDisabled={uninstallingPlugin}
        onConfirm={handleConfirmDeletePlugin}
        confirmVariant="destructive"
      />
    </div>
  );
}

function EmptyPlugin({ onCreatePlugin }: { onCreatePlugin: () => void }) {
  const { t } = useI18n();
  const m = t.migration.settings?.workbenchPlugins;
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PackageIcon />
        </EmptyMedia>
        <EmptyTitle>{m?.emptyTitle ?? "No plugins installed"}</EmptyTitle>
        <EmptyDescription>
          {m?.emptyDescription
            ?? "Install workbench plugins to handle different artifact types"}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onCreatePlugin}>
          {m?.emptyButton ?? "Create your first plugin"}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
