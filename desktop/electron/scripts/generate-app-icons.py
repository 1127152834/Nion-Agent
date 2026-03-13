#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent.parent
SOURCE_IMAGE = REPO_ROOT / 'frontend' / 'public' / 'images' / 'nion-logo-v2.png'
BUILD_DIR = ROOT / 'build'
OUT_DIR = BUILD_DIR / 'icons'
ICONSET_DIR = OUT_DIR / 'app.iconset'
BASE_SIZE = 1024
CORNER_RADIUS = 220
# Dock/Finder 里图标的“视觉大小”主要由透明边距决定；加一点透明 padding
# 可以让我们的图标和多数第三方应用更接近同一套视觉基线。
OUTER_PADDING_RATIO = 0.06


def build_base_icon() -> Image.Image:
    source = Image.open(SOURCE_IMAGE).convert('RGBA')
    alpha_bbox = source.getchannel('A').getbbox()
    if alpha_bbox:
        source = source.crop(alpha_bbox)

    outer_padding = int(BASE_SIZE * OUTER_PADDING_RATIO)
    tile_size = BASE_SIZE - outer_padding * 2
    tile_corner_radius = int(CORNER_RADIUS * tile_size / BASE_SIZE)

    mask = Image.new('L', (tile_size, tile_size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(
        (0, 0, tile_size - 1, tile_size - 1),
        radius=tile_corner_radius,
        fill=255,
    )

    background = Image.new('RGBA', (tile_size, tile_size), (255, 255, 255, 255))
    icon_canvas = Image.new('RGBA', (tile_size, tile_size), (0, 0, 0, 0))
    icon_canvas.paste(background, (0, 0), mask)

    max_logo_size = int(tile_size * 0.72)
    source.thumbnail((max_logo_size, max_logo_size), resample=Image.Resampling.LANCZOS)

    logo_x = (tile_size - source.width) // 2
    logo_y = (tile_size - source.height) // 2 + int(tile_size * 0.03)
    icon_canvas.alpha_composite(source, (logo_x, logo_y))

    tile_icon = Image.new('RGBA', (tile_size, tile_size), (0, 0, 0, 0))
    tile_icon.paste(icon_canvas, (0, 0), mask)

    final_icon = Image.new('RGBA', (BASE_SIZE, BASE_SIZE), (0, 0, 0, 0))
    final_icon.alpha_composite(tile_icon, (outer_padding, outer_padding))
    return final_icon


def write_iconset(base: Image.Image) -> None:
    icon_specs: list[tuple[int, str]] = [
        (16, 'icon_16x16.png'),
        (32, 'icon_16x16@2x.png'),
        (32, 'icon_32x32.png'),
        (64, 'icon_32x32@2x.png'),
        (128, 'icon_128x128.png'),
        (256, 'icon_128x128@2x.png'),
        (256, 'icon_256x256.png'),
        (512, 'icon_256x256@2x.png'),
        (512, 'icon_512x512.png'),
        (1024, 'icon_512x512@2x.png'),
    ]

    if ICONSET_DIR.exists():
        shutil.rmtree(ICONSET_DIR)
    ICONSET_DIR.mkdir(parents=True, exist_ok=True)

    for size, filename in icon_specs:
        resized = base.resize((size, size), resample=Image.Resampling.LANCZOS)
        resized.save(ICONSET_DIR / filename)


def build_icns() -> None:
    iconutil_path = shutil.which('iconutil')
    if not iconutil_path:
        raise RuntimeError('iconutil not found. This script requires macOS to generate .icns files.')

    icns_path = BUILD_DIR / 'icon.icns'
    if icns_path.exists():
        icns_path.unlink()

    subprocess.run(
        [iconutil_path, '-c', 'icns', str(ICONSET_DIR), '-o', str(icns_path)],
        check=True,
    )
    shutil.copy2(icns_path, OUT_DIR / 'app-icon.icns')


def build_ico(base: Image.Image) -> None:
    ico_path = BUILD_DIR / 'icon.ico'
    if ico_path.exists():
        ico_path.unlink()
    base.save(
        ico_path,
        format='ICO',
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


def main() -> None:
    if not SOURCE_IMAGE.exists():
        raise FileNotFoundError(f'source image not found: {SOURCE_IMAGE}')

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    base = build_base_icon()
    base.save(BUILD_DIR / 'icon.png')
    base.save(OUT_DIR / 'app-icon.png')
    write_iconset(base)
    build_icns()
    build_ico(base)
    print(f'Generated icons in: {BUILD_DIR}')


if __name__ == '__main__':
    main()
