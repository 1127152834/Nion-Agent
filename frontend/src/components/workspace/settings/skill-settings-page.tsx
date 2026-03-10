"use client";

import { ChevronDownIcon, DownloadIcon, SparklesIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
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
  useDeleteSkill,
  useEnableSkill,
  useSkills,
  useUploadSkillArchive,
} from "@/core/skills/hooks";
import { getLocalizedSkillDescription } from "@/core/skills/i18n";
import type { Skill } from "@/core/skills/type";
import { pathOfNewThread } from "@/core/threads/utils";
import { env } from "@/env";

import { ConfirmActionDialog } from "./confirm-action-dialog";
import { SettingsSection } from "./settings-section";
import { SkillImportDialog } from "./skill-import-dialog";

export function SkillSettingsPage({ onClose }: { onClose?: () => void } = {}) {
  const { t } = useI18n();
  const { skills, isLoading, error } = useSkills();

  return (
    <SettingsSection
      title={t.settings.skills.title}
      description={t.settings.skills.description}
    >
      <div className="space-y-6">
        <section className="space-y-3 rounded-lg border p-4">
          {isLoading ? (
            <div className="text-muted-foreground text-sm">{t.common.loading}</div>
          ) : error ? (
            <div>{error.message}</div>
          ) : (
            <SkillSettingsList skills={skills} onClose={onClose} />
          )}
        </section>
      </div>
    </SettingsSection>
  );
}

function SkillSettingsList({
  skills,
  onClose,
}: {
  skills: Skill[];
  onClose?: () => void;
}) {
  const { t, locale } = useI18n();
  const fallbackCopy = locale === "zh-CN"
    ? {
      createViaChat: "通过对话创建",
      uploadPackage: "上传包文件",
      importFromAgents: "从 Agents 导入",
      uploading: "上传中...",
      uploadFormatError: "请上传 .skill 或 .zip 文件",
      uploadFailed: "上传技能包失败",
      skillInstalled: "技能 \"{name}\" 已安装",
      skillDeleted: "技能已删除",
      deleteFailed: "删除技能失败",
      deleteConfirmTitle: "确认删除技能",
      deleteConfirmDescription: "删除技能 \"{name}\"？此操作不可撤销。",
      cancelAction: "取消",
      confirmDeleteAction: "删除",
    }
    : {
      createViaChat: "Create via chat",
      uploadPackage: "Upload package",
      importFromAgents: "Import from Agents",
      uploading: "Uploading...",
      uploadFormatError: "Please upload a .skill or .zip file",
      uploadFailed: "Failed to upload skill package",
      skillInstalled: "Skill \"{name}\" installed",
      skillDeleted: "Skill deleted",
      deleteFailed: "Failed to delete skill",
      deleteConfirmTitle: "Confirm skill deletion",
      deleteConfirmDescription: "Delete skill \"{name}\"? This action cannot be undone.",
      cancelAction: "Cancel",
      confirmDeleteAction: "Delete",
    };
  const settingsLike = t.settings as unknown as {
    skillPage?: Record<string, string>;
  };
  const copy = {
    ...fallbackCopy,
    ...(settingsLike.skillPage ?? {}),
  };
  const router = useRouter();
  const [filter, setFilter] = useState<string>("public");
  const [pendingDeleteSkillName, setPendingDeleteSkillName] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const { mutate: enableSkill } = useEnableSkill();
  const { mutate: deleteSkill, isPending: deletingSkill } = useDeleteSkill();
  const { mutate: uploadSkillArchive, isPending: uploadingSkillArchive } = useUploadSkillArchive();
  const filteredSkills = useMemo(
    () => skills.filter((skill) => skill.category === filter),
    [skills, filter],
  );
  const handleCreateSkill = () => {
    onClose?.();
    router.push(`${pathOfNewThread()}?mode=skill`);
  };
  const handleUploadMenuClick = () => {
    uploadInputRef.current?.click();
  };
  const handleUploadSkillFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    const filename = file.name.toLowerCase();
    if (!filename.endsWith(".skill") && !filename.endsWith(".zip")) {
      toast.error(copy.uploadFormatError);
      return;
    }

    uploadSkillArchive(
      { file },
      {
        onSuccess: (result) => {
          toast.success(
            copy.skillInstalled.replaceAll("{name}", result.skill_name),
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
  const handleConfirmDeleteSkill = () => {
    if (!pendingDeleteSkillName) {
      return;
    }
    deleteSkill(
      { skillName: pendingDeleteSkillName },
      {
        onSuccess: () => {
          toast.success(copy.skillDeleted);
          setPendingDeleteSkillName(null);
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : copy.deleteFailed,
          );
        },
      },
    );
  };
  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex justify-between">
        <div className="flex gap-2">
          <Tabs defaultValue="public" onValueChange={setFilter}>
            <TabsList variant="line">
              <TabsTrigger value="public">{t.common.public}</TabsTrigger>
              <TabsTrigger value="custom">{t.common.custom}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" disabled={uploadingSkillArchive}>
                <SparklesIcon className="size-4" />
                {t.settings.skills.createSkill}
                <ChevronDownIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={handleCreateSkill}>
                <SparklesIcon className="size-4 text-muted-foreground" />
                {copy.createViaChat}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={handleUploadMenuClick}
                disabled={uploadingSkillArchive}
              >
                <UploadIcon className="size-4 text-muted-foreground" />
                {uploadingSkillArchive
                  ? copy.uploading
                  : copy.uploadPackage}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setImportDialogOpen(true)}>
                <DownloadIcon className="size-4 text-muted-foreground" />
                {copy.importFromAgents}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={uploadInputRef}
            type="file"
            accept=".skill,.zip,application/zip"
            className="hidden"
            onChange={handleUploadSkillFile}
          />
        </div>
      </header>
      {filteredSkills.length === 0 && (
        <EmptySkill onCreateSkill={handleCreateSkill} />
      )}
      {filteredSkills.length > 0 &&
        filteredSkills.map((skill) => (
          <Item className="w-full" variant="outline" key={skill.name}>
            <ItemContent>
              <ItemTitle>
                <div className="flex items-center gap-2">{skill.name}</div>
              </ItemTitle>
              <ItemDescription className="line-clamp-4">
                {getLocalizedSkillDescription(skill, locale)}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch
                checked={skill.enabled}
                disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"}
                onCheckedChange={(checked) =>
                  enableSkill({ skillName: skill.name, enabled: checked })
                }
              />
              {skill.category === "custom" && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-rose-600 hover:text-rose-600"
                  disabled={
                    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"
                    || deletingSkill
                  }
                  onClick={() => {
                    setPendingDeleteSkillName(skill.name);
                  }}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              )}
            </ItemActions>
          </Item>
        ))}
      <ConfirmActionDialog
        open={pendingDeleteSkillName !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteSkillName(null);
          }
        }}
        title={copy.deleteConfirmTitle}
        description={
          copy.deleteConfirmDescription
            .replaceAll("{name}", pendingDeleteSkillName ?? "")
        }
        cancelText={copy.cancelAction}
        confirmText={copy.confirmDeleteAction}
        confirmDisabled={deletingSkill}
        onConfirm={handleConfirmDeleteSkill}
        confirmVariant="destructive"
      />
      <SkillImportDialog open={importDialogOpen} onOpenChange={setImportDialogOpen} />
    </div>
  );
}

function EmptySkill({ onCreateSkill }: { onCreateSkill: () => void }) {
  const { t } = useI18n();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SparklesIcon />
        </EmptyMedia>
        <EmptyTitle>{t.settings.skills.emptyTitle}</EmptyTitle>
        <EmptyDescription>
          {t.settings.skills.emptyDescription}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onCreateSkill}>{t.settings.skills.emptyButton}</Button>
      </EmptyContent>
    </Empty>
  );
}
