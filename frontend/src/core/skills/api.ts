import { apiFetch, apiFetchVoid } from "@/core/api";

import type { Skill } from "./type";

export async function loadSkills() {
  const json = await apiFetch<{ skills: Skill[] }>("/api/skills");
  return json.skills;
}

export async function enableSkill(skillName: string, enabled: boolean) {
  return apiFetch<unknown>(`/api/skills/${skillName}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      enabled,
    }),
  });
}

export async function deleteSkill(skillName: string): Promise<void> {
  return apiFetchVoid(`/api/skills/${skillName}`, {
    method: "DELETE",
  });
}

export interface InstallSkillRequest {
  thread_id: string;
  path: string;
}

export interface InstallSkillResponse {
  success: boolean;
  skill_name: string;
  message: string;
}

export interface UploadSkillArchiveResponse {
  success: boolean;
  skill_name: string;
  message: string;
}

export async function installSkill(
  request: InstallSkillRequest,
): Promise<InstallSkillResponse> {
  try {
    return await apiFetch<InstallSkillResponse>("/api/skills/install", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  } catch {
    return {
      success: false,
      skill_name: "",
      message: "Failed to install skill",
    };
  }
}

export async function uploadSkillArchive(
  file: File,
): Promise<UploadSkillArchiveResponse> {
  const formData = new FormData();
  formData.append("file", file);

  return apiFetch<UploadSkillArchiveResponse>("/api/skills/upload", {
    method: "POST",
    body: formData,
  });
}
