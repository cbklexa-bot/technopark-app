#!/usr/bin/env python3
"""Generate branded source images consumed by @capacitor/assets.

The native resources are generated in CI after Capacitor creates its Android
project. This keeps the app icon and launch screen consistent and repeatable.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)

DARK = (25, 43, 37)
DARK_LIGHT = (35, 57, 47)
LIME = (215, 237, 145)
INK = (25, 43, 37)
AMBER = (230, 145, 64)
CREAM = (247, 249, 241)
MUTED = (181, 198, 183)


def font(size: int, bold: bool = True):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


def draw_mark(canvas: Image.Image, center: tuple[int, int], side: int, transparent: bool = False):
    """Draw the same lime monogram tile as the current web UI."""
    draw = ImageDraw.Draw(canvas)
    cx, cy = center
    margin = int(side * 0.09)
    left, top = cx - side // 2 + margin, cy - side // 2 + margin
    right, bottom = cx + side // 2 - margin, cy + side // 2 - margin
    tile_radius = int((right - left) * 0.17)
    draw.rounded_rectangle((left, top, right, bottom), radius=tile_radius, fill=LIME)

    tile_w = right - left
    # Amber smoke strokes are intentionally small so the mark remains legible
    # as an Android launcher icon at 48 dp.
    stroke = max(3, int(side * 0.014))
    arc_boxes = [
        (left + int(tile_w * 0.46), top + int(tile_w * 0.12),
         left + int(tile_w * 0.66), top + int(tile_w * 0.37)),
        (left + int(tile_w * 0.54), top + int(tile_w * 0.08),
         left + int(tile_w * 0.76), top + int(tile_w * 0.31)),
    ]
    draw.arc(arc_boxes[0], start=195, end=520, fill=AMBER, width=stroke)
    draw.arc(arc_boxes[1], start=205, end=515, fill=AMBER, width=stroke)

    letter = "К"
    letter_font = font(int(tile_w * 0.57), bold=True)
    text_y = top + int(tile_w * 0.56)
    draw.text((cx, text_y), letter, font=letter_font, fill=INK, anchor="mm")


def background(size: int, dark: bool = False) -> Image.Image:
    color = DARK if dark else DARK
    image = Image.new("RGB", (size, size), color)
    draw = ImageDraw.Draw(image)
    # Low-contrast nested fields create depth without affecting the brand mark.
    for step in range(18, 0, -1):
        inset = int(size * (0.10 + step * 0.012))
        draw.ellipse((inset, inset, size - inset, size - inset), fill=DARK_LIGHT if step < 10 else DARK)
    return image


def make_icon(path: Path, canvas_size: int, mark_size: int, bg_color=None):
    if bg_color is None:
        image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    else:
        image = Image.new("RGBA", (canvas_size, canvas_size), (*bg_color, 255))
    draw_mark(image, (canvas_size // 2, canvas_size // 2), mark_size)
    image.save(path, "PNG", optimize=True)


def make_splash(path: Path, dark: bool):
    size = 2732
    image = background(size, dark).convert("RGBA")
    mark_size = 720
    draw_mark(image, (size // 2, int(size * 0.39)), mark_size)
    draw = ImageDraw.Draw(image)
    title_font = font(190, bold=True)
    subtitle_font = font(62, bold=True)
    draw.text((size // 2, int(size * 0.58)), "Коптильня", font=title_font, fill=CREAM, anchor="mm")
    draw.text((size // 2, int(size * 0.625)), "УЧЁТ ПРОИЗВОДСТВА", font=subtitle_font, fill=MUTED, anchor="mm")
    image.convert("RGB").save(path, "PNG", optimize=True)


def main():
    make_icon(ASSETS / "icon-only.png", 1024, 760, None)
    # Keep the entire adaptive mark well inside Android's central safe area.
    make_icon(ASSETS / "icon-foreground.png", 1024, 700, None)
    Image.new("RGB", (1024, 1024), DARK).save(ASSETS / "icon-background.png", "PNG", optimize=True)
    make_splash(ASSETS / "splash.png", dark=False)
    make_splash(ASSETS / "splash-dark.png", dark=True)
    for name in ["icon-only.png","icon-foreground.png","icon-background.png","splash.png","splash-dark.png"]:
        image = Image.open(ASSETS / name)
        expected = (2732, 2732) if name.startswith("splash") else (1024, 1024)
        if image.size != expected:
            raise RuntimeError(f"{name}: expected {expected}, got {image.size}")
    print("Generated branded app icon and splash assets in", ASSETS)


if __name__ == "__main__":
    main()
