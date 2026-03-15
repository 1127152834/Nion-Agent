"use client";

import { CameraIcon, UploadIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent, WheelEvent } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeleteAgentAvatar, useDeleteDefaultAgentAvatar, useUploadAgentAvatar, useUploadDefaultAgentAvatar } from "@/core/agents";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

const STAGE_SIZE = 320;
const OUTPUT_SIZE = 256;
const MASK_PADDING = 16;
const CROP_SIZE = STAGE_SIZE - MASK_PADDING * 2;
const CROP_CORNER_RADIUS = 20;

type CropTransform = {
  offsetX: number;
  offsetY: number;
  baseScale: number;
  zoom: number;
};

type DragState = {
  active: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  startOffsetX: number;
  startOffsetY: number;
};

interface AgentAvatarEditorProps {
  agentName: string;
  isDefault?: boolean;
  avatarUrl?: string | null;
  fallbackLabel: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const clampedRadius = clamp(radius, 0, Math.min(width, height) / 2);
  const right = x + width;
  const bottom = y + height;

  ctx.beginPath();
  ctx.moveTo(x + clampedRadius, y);
  ctx.lineTo(right - clampedRadius, y);
  ctx.arcTo(right, y, right, y + clampedRadius, clampedRadius);
  ctx.lineTo(right, bottom - clampedRadius);
  ctx.arcTo(right, bottom, right - clampedRadius, bottom, clampedRadius);
  ctx.lineTo(x + clampedRadius, bottom);
  ctx.arcTo(x, bottom, x, bottom - clampedRadius, clampedRadius);
  ctx.lineTo(x, y + clampedRadius);
  ctx.arcTo(x, y, x + clampedRadius, y, clampedRadius);
  ctx.closePath();
}

function resolveAvatarURL(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const value = raw.trim();
  if (!value) {
    return null;
  }

  const lower = value.toLowerCase();
  if (
    lower.startsWith("http://")
    || lower.startsWith("https://")
    || lower.startsWith("blob:")
    || lower.startsWith("data:")
  ) {
    return value;
  }

  // Backend returns relative avatar URLs like `/api/agents/<name>/avatar`.
  // In Electron we run frontend (3000) and gateway (8001) on different ports,
  // so we must pin the image request to the gateway origin.
  if (value.startsWith("/")) {
    return `${getBackendBaseURL()}${value}`;
  }

  return value;
}

function withAvatarCacheBust(url: string | null, nonce: number): string | null {
  if (!url) {
    return null;
  }

  const lower = url.toLowerCase();
  // `blob:` / `data:` URLs should not be mutated.
  if (lower.startsWith("blob:") || lower.startsWith("data:")) {
    return url;
  }

  try {
    const parsed = new URL(url);
    parsed.searchParams.set("v", String(nonce));
    return parsed.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}v=${nonce}`;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Ensure the resulting canvas remains readable when the avatar is loaded from
    // a different origin/port (e.g. frontend 3000 -> gateway 8001 in Electron).
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = src;
  });
}

function exportCroppedAvatar(image: HTMLImageElement, transform: CropTransform): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Promise.reject(new Error("Canvas context unavailable"));
  }

  ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  const scale = transform.baseScale * transform.zoom;
  const ratio = OUTPUT_SIZE / CROP_SIZE;

  buildRoundedRectPath(ctx, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE, Math.round(CROP_CORNER_RADIUS * ratio));
  ctx.clip();
  ctx.drawImage(
    image,
    (transform.offsetX - MASK_PADDING) * ratio,
    (transform.offsetY - MASK_PADDING) * ratio,
    image.width * scale * ratio,
    image.height * scale * ratio,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to export avatar"));
        return;
      }
      resolve(new File([blob], "avatar.png", { type: "image/png" }));
    }, "image/png");
  });
}

export function AgentAvatarEditor({
  agentName,
  isDefault = false,
  avatarUrl = null,
  fallbackLabel,
}: AgentAvatarEditorProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<DragState>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
  });

  const uploadAgentAvatar = useUploadAgentAvatar();
  const deleteAgentAvatar = useDeleteAgentAvatar();
  const uploadDefaultAvatar = useUploadDefaultAgentAvatar();
  const deleteDefaultAvatar = useDeleteDefaultAgentAvatar();

  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [transform, setTransform] = useState<CropTransform | null>(null);
  const [avatarNonce, setAvatarNonce] = useState(0);

  const isBusy = uploadAgentAvatar.isPending
    || deleteAgentAvatar.isPending
    || uploadDefaultAvatar.isPending
    || deleteDefaultAvatar.isPending;

  const avatarCopy = t.agents.avatar;
  const fallback = useMemo(() => fallbackLabel.slice(0, 1).toUpperCase(), [fallbackLabel]);
  const resolvedAvatarUrl = useMemo(() => resolveAvatarURL(avatarUrl), [avatarUrl]);
  const resolvedAvatarUrlWithNonce = useMemo(
    () => withAvatarCacheBust(resolvedAvatarUrl, avatarNonce),
    [avatarNonce, resolvedAvatarUrl],
  );

  const initializeTransform = useCallback((nextImage: HTMLImageElement) => {
    const baseScale = Math.max(CROP_SIZE / nextImage.width, CROP_SIZE / nextImage.height);
    setTransform({
      offsetX: MASK_PADDING + (CROP_SIZE - nextImage.width * baseScale) / 2,
      offsetY: MASK_PADDING + (CROP_SIZE - nextImage.height * baseScale) / 2,
      baseScale,
      zoom: 1,
    });
  }, []);

  const drawStage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, STAGE_SIZE, STAGE_SIZE);
    ctx.fillStyle = "hsl(var(--muted))";
    ctx.fillRect(0, 0, STAGE_SIZE, STAGE_SIZE);

    if (image && transform) {
      const scale = transform.baseScale * transform.zoom;
      ctx.drawImage(
        image,
        transform.offsetX,
        transform.offsetY,
        image.width * scale,
        image.height * scale,
      );
    } else {
      ctx.fillStyle = "hsl(var(--muted-foreground))";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(avatarCopy.emptyHint, STAGE_SIZE / 2, STAGE_SIZE / 2);
    }

    ctx.save();
    ctx.fillStyle = "rgba(16, 16, 16, 0.45)";
    ctx.fillRect(0, 0, STAGE_SIZE, STAGE_SIZE);
    ctx.globalCompositeOperation = "destination-out";
    buildRoundedRectPath(ctx, MASK_PADDING, MASK_PADDING, CROP_SIZE, CROP_SIZE, CROP_CORNER_RADIUS);
    ctx.fill();
    ctx.restore();

    buildRoundedRectPath(ctx, MASK_PADDING, MASK_PADDING, CROP_SIZE, CROP_SIZE, CROP_CORNER_RADIUS);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.96)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [avatarCopy.emptyHint, image, transform]);

  useEffect(() => {
    drawStage();
  }, [drawStage]);

  useEffect(() => {
    if (!open) {
      dragRef.current.active = false;
      dragRef.current.pointerId = null;
      return;
    }

    let cancelled = false;
    async function hydrate() {
      if (!resolvedAvatarUrlWithNonce) {
        setImage(null);
        setTransform(null);
        return;
      }
      try {
        const loaded = await loadImage(resolvedAvatarUrlWithNonce);
        if (cancelled) {
          return;
        }
        setImage(loaded);
        initializeTransform(loaded);
      } catch {
        if (cancelled) {
          return;
        }
        setImage(null);
        setTransform(null);
      }
    }
    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [initializeTransform, open, resolvedAvatarUrlWithNonce]);

  const applyZoom = useCallback((nextZoom: number) => {
    setTransform((prev) => {
      if (!prev) {
        return prev;
      }
      const clampedZoom = clamp(nextZoom, 1, 3);
      const prevScale = prev.baseScale * prev.zoom;
      const nextScale = prev.baseScale * clampedZoom;
      const ratio = nextScale / prevScale;
      const center = STAGE_SIZE / 2;
      return {
        ...prev,
        zoom: clampedZoom,
        offsetX: center - (center - prev.offsetX) * ratio,
        offsetY: center - (center - prev.offsetY) * ratio,
      };
    });
  }, []);

  const handleUploadSelection = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selected = event.target.files?.[0];
      event.target.value = "";
      if (!selected) {
        return;
      }
      if (!selected.type.startsWith("image/")) {
        toast.error(avatarCopy.unsupportedType);
        return;
      }

      const localUrl = URL.createObjectURL(selected);
      try {
        const loaded = await loadImage(localUrl);
        setImage(loaded);
        initializeTransform(loaded);
      } catch {
        toast.error(avatarCopy.loadFailed);
      } finally {
        URL.revokeObjectURL(localUrl);
      }
    },
    [avatarCopy.loadFailed, avatarCopy.unsupportedType, initializeTransform],
  );

  const handleApplyAvatar = useCallback(async () => {
    if (!image || !transform) {
      toast.error(avatarCopy.emptyHint);
      return;
    }
    try {
      const file = await exportCroppedAvatar(image, transform);
      if (isDefault) {
        await uploadDefaultAvatar.mutateAsync(file);
      } else {
        await uploadAgentAvatar.mutateAsync({ name: agentName, file });
      }
      setAvatarNonce(Date.now());
      toast.success(avatarCopy.uploadSuccess);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : avatarCopy.uploadFailed);
    }
  }, [
    agentName,
    avatarCopy.emptyHint,
    avatarCopy.uploadFailed,
    avatarCopy.uploadSuccess,
    image,
    isDefault,
    transform,
    uploadAgentAvatar,
    uploadDefaultAvatar,
  ]);

  const handleRemoveAvatar = useCallback(async () => {
    try {
      if (isDefault) {
        await deleteDefaultAvatar.mutateAsync();
      } else {
        await deleteAgentAvatar.mutateAsync(agentName);
      }
      setAvatarNonce(Date.now());
      toast.success(avatarCopy.deleteSuccess);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : avatarCopy.deleteFailed);
    }
  }, [
    agentName,
    avatarCopy.deleteFailed,
    avatarCopy.deleteSuccess,
    deleteAgentAvatar,
    deleteDefaultAvatar,
    isDefault,
  ]);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (!transform) {
        return;
      }
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      dragRef.current = {
        active: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startOffsetX: transform.offsetX,
        startOffsetY: transform.offsetY,
      };
    },
    [transform],
  );

  const handlePointerMove = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) {
      return;
    }
    setTransform((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        offsetX: drag.startOffsetX + (event.clientX - drag.startX),
        offsetY: drag.startOffsetY + (event.clientY - drag.startY),
      };
    });
  }, []);

  const stopDragging = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag.pointerId === event.pointerId) {
      dragRef.current.active = false;
      dragRef.current.pointerId = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      const currentZoom = transform?.zoom ?? 1;
      const next = currentZoom + (event.deltaY < 0 ? 0.08 : -0.08);
      applyZoom(next);
    },
    [applyZoom, transform?.zoom],
  );

  return (
    <>
      <button
        type="button"
        className="group/avatar relative rounded-lg"
        onClick={() => setOpen(true)}
        title={avatarCopy.edit}
      >
        <Avatar className="size-14 rounded-lg border-2 border-border/80 bg-muted/60 shadow-sm">
          <AvatarImage
            src={resolvedAvatarUrlWithNonce ?? undefined}
            alt={fallbackLabel}
            className="object-cover"
          />
          <AvatarFallback className="bg-primary/10 text-primary font-semibold">
            {fallback}
          </AvatarFallback>
        </Avatar>
        <span className="bg-foreground text-background absolute right-0 bottom-0 inline-flex size-5 items-center justify-center rounded-full border border-background text-[10px]">
          <CameraIcon className="size-3" />
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl p-0">
          <DialogHeader className="border-b px-6 pt-6 pb-4">
            <DialogTitle className="text-base">{avatarCopy.title}</DialogTitle>
            <DialogDescription>{avatarCopy.hint}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 px-6 py-5 md:grid-cols-[1fr_220px]">
            <div className="bg-muted/35 rounded-2xl border p-3">
              <canvas
                ref={canvasRef}
                width={STAGE_SIZE}
                height={STAGE_SIZE}
                className={cn(
                  "mx-auto aspect-square w-full max-w-[320px] rounded-xl border bg-muted/60",
                  dragRef.current.active ? "cursor-grabbing" : "cursor-grab",
                )}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={stopDragging}
                onPointerCancel={stopDragging}
                onWheel={handleWheel}
              />
            </div>

            <div className="space-y-4">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleUploadSelection}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => fileRef.current?.click()}
                disabled={isBusy}
              >
                <UploadIcon className="mr-2 size-4" />
                {avatarCopy.pick}
              </Button>

              <div className="rounded-xl border p-3">
                <p className="text-muted-foreground mb-2 text-xs">{avatarCopy.zoom}</p>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={transform?.zoom ?? 1}
                  onChange={(event) => applyZoom(Number(event.target.value))}
                  disabled={!transform || isBusy}
                  className="w-full"
                />
              </div>

              <Button
                type="button"
                variant="outline"
                className="text-destructive w-full justify-start"
                onClick={() => void handleRemoveAvatar()}
                disabled={isBusy}
              >
                {avatarCopy.remove}
              </Button>
            </div>
          </div>

          <DialogFooter className="border-t px-6 py-4">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isBusy}>
              {t.common.cancel}
            </Button>
            <Button onClick={() => void handleApplyAvatar()} disabled={isBusy}>
              {isBusy ? t.common.loading : avatarCopy.apply}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
