"""Artifact groups router for thread-scoped artifact grouping CRUD."""

import io
import logging
import time
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.gateway.langgraph_client import (
    LangGraphThreadNotFoundError,
    LangGraphThreadNotReadyError,
    load_thread_state,
    update_thread_state,
)
from app.gateway.path_utils import resolve_thread_virtual_path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/threads/{thread_id}/artifact-groups", tags=["artifacts"])


class ArtifactGroupMetadata(BaseModel):
    task_id: str | None = None
    prompt: str | None = None
    tags: list[str] | None = None


class ArtifactGroup(BaseModel):
    id: str
    name: str
    description: str | None = None
    artifacts: list[str] = Field(default_factory=list)
    created_at: int
    metadata: ArtifactGroupMetadata | None = None


class ArtifactGroupsListResponse(BaseModel):
    groups: list[ArtifactGroup] = Field(default_factory=list)


class ArtifactGroupCreateRequest(BaseModel):
    name: str = Field(..., description="Group name")
    artifacts: list[str] = Field(default_factory=list, description="Artifact paths")
    description: str | None = None
    metadata: ArtifactGroupMetadata | None = None


class ArtifactGroupUpdateRequest(BaseModel):
    name: str | None = None
    artifacts: list[str] | None = None
    description: str | None = None
    metadata: ArtifactGroupMetadata | None = None


class ArtifactGroupsReplaceRequest(BaseModel):
    groups: list[ArtifactGroup] = Field(default_factory=list)


def _dedupe_artifacts(artifacts: list[str]) -> list[str]:
    return list(dict.fromkeys([artifact for artifact in artifacts if artifact]))


def _resolve_zip_entry_name(artifact_path: str, used_names: set[str]) -> str:
    stripped = artifact_path.lstrip("/")
    prefix = "mnt/user-data/"
    if stripped.startswith(prefix):
        base_name = stripped[len(prefix) :]
    else:
        base_name = Path(stripped).name

    candidate = base_name or "artifact"
    suffix = 1
    while candidate in used_names:
        stem = Path(base_name).stem or "artifact"
        ext = Path(base_name).suffix
        candidate = f"{stem}-{suffix}{ext}"
        suffix += 1

    used_names.add(candidate)
    return candidate


def _normalize_groups(raw_groups: Any) -> list[ArtifactGroup]:
    if not isinstance(raw_groups, list):
        return []

    normalized: list[ArtifactGroup] = []
    for group in raw_groups:
        if not isinstance(group, dict):
            continue
        try:
            normalized.append(ArtifactGroup.model_validate(group))
        except Exception:
            continue
    return normalized


async def _load_thread_artifact_groups(thread_id: str) -> list[ArtifactGroup]:
    values = await load_thread_state(thread_id)
    raw_groups = values.get("artifact_groups", []) if isinstance(values, dict) else []
    return _normalize_groups(raw_groups)


async def _save_thread_artifact_groups(thread_id: str, groups: list[ArtifactGroup]) -> None:
    await update_thread_state(
        thread_id,
        {"artifact_groups": [group.model_dump() for group in groups]},
    )


@router.get("", response_model=ArtifactGroupsListResponse, summary="List Artifact Groups")
async def list_artifact_groups(thread_id: str) -> ArtifactGroupsListResponse:
    try:
        groups = await _load_thread_artifact_groups(thread_id)
    except (LangGraphThreadNotFoundError, LangGraphThreadNotReadyError):
        groups = []
    return ArtifactGroupsListResponse(groups=groups)


@router.put(
    "",
    response_model=ArtifactGroupsListResponse,
    summary="Replace Artifact Groups",
)
async def replace_artifact_groups(
    thread_id: str,
    request: ArtifactGroupsReplaceRequest,
) -> ArtifactGroupsListResponse:
    normalized_groups = [
        ArtifactGroup(
            id=group.id,
            name=group.name.strip(),
            description=group.description,
            artifacts=_dedupe_artifacts(group.artifacts),
            created_at=group.created_at,
            metadata=group.metadata,
        )
        for group in request.groups
        if group.name.strip()
    ]
    await _save_thread_artifact_groups(thread_id, normalized_groups)
    return ArtifactGroupsListResponse(groups=normalized_groups)


@router.post("", response_model=ArtifactGroup, summary="Create Artifact Group")
async def create_artifact_group(
    thread_id: str,
    request: ArtifactGroupCreateRequest,
) -> ArtifactGroup:
    group_name = request.name.strip()
    if not group_name:
        raise HTTPException(status_code=422, detail="Group name cannot be empty")

    groups = await _load_thread_artifact_groups(thread_id)
    new_group = ArtifactGroup(
        id=str(uuid4()),
        name=group_name,
        description=request.description,
        artifacts=_dedupe_artifacts(request.artifacts),
        created_at=int(time.time() * 1000),
        metadata=request.metadata,
    )

    groups.append(new_group)
    await _save_thread_artifact_groups(thread_id, groups)
    return new_group


@router.put(
    "/{group_id}",
    response_model=ArtifactGroup,
    summary="Update Artifact Group",
)
async def update_artifact_group(
    thread_id: str,
    group_id: str,
    request: ArtifactGroupUpdateRequest,
) -> ArtifactGroup:
    groups = await _load_thread_artifact_groups(thread_id)
    updated_group: ArtifactGroup | None = None

    next_groups: list[ArtifactGroup] = []
    for group in groups:
        if group.id != group_id:
            next_groups.append(group)
            continue

        next_name = group.name
        if request.name is not None:
            stripped_name = request.name.strip()
            if not stripped_name:
                raise HTTPException(status_code=422, detail="Group name cannot be empty")
            next_name = stripped_name

        next_artifacts = group.artifacts
        if request.artifacts is not None:
            next_artifacts = _dedupe_artifacts(request.artifacts)

        updated_group = ArtifactGroup(
            id=group.id,
            name=next_name,
            description=request.description if request.description is not None else group.description,
            artifacts=next_artifacts,
            created_at=group.created_at,
            metadata=request.metadata if request.metadata is not None else group.metadata,
        )
        next_groups.append(updated_group)

    if updated_group is None:
        raise HTTPException(status_code=404, detail=f"Artifact group '{group_id}' not found")

    await _save_thread_artifact_groups(thread_id, next_groups)
    return updated_group


@router.delete(
    "/{group_id}",
    summary="Delete Artifact Group",
)
async def delete_artifact_group(thread_id: str, group_id: str) -> dict[str, bool]:
    groups = await _load_thread_artifact_groups(thread_id)
    next_groups = [group for group in groups if group.id != group_id]

    if len(next_groups) == len(groups):
        raise HTTPException(status_code=404, detail=f"Artifact group '{group_id}' not found")

    await _save_thread_artifact_groups(thread_id, next_groups)
    return {"success": True}


@router.get(
    "/{group_id}/download",
    summary="Download Artifact Group as ZIP",
)
async def download_artifact_group(thread_id: str, group_id: str) -> StreamingResponse:
    groups = await _load_thread_artifact_groups(thread_id)
    group = next((item for item in groups if item.id == group_id), None)
    if group is None:
        raise HTTPException(status_code=404, detail=f"Artifact group '{group_id}' not found")

    zip_buffer = io.BytesIO()
    used_names: set[str] = set()
    written_files = 0

    with zipfile.ZipFile(zip_buffer, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        for artifact_path in group.artifacts:
            try:
                actual_path = resolve_thread_virtual_path(thread_id, artifact_path)
            except HTTPException:
                logger.warning("Skipping invalid artifact path while zipping group", extra={"artifact_path": artifact_path, "group_id": group_id})
                continue

            if not actual_path.exists() or not actual_path.is_file():
                continue

            entry_name = _resolve_zip_entry_name(artifact_path, used_names)
            zip_file.write(actual_path, arcname=entry_name)
            written_files += 1

    if written_files == 0:
        raise HTTPException(status_code=404, detail="No downloadable artifacts found in this group")

    safe_group_name = "".join(char if char.isalnum() or char in ("-", "_") else "-" for char in group.name).strip("-") or "artifact-group"
    filename = f"{safe_group_name}.zip"
    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        },
    )
