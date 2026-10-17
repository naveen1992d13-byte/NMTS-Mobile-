#!/usr/bin/env python3
"""Compose a larger Android adaptive foreground and mask previews. Pillow only."""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(
    os.environ.get(
        "SLEEPINGSTOCK_LOGO_SRC",
        str(ROOT / "assets/source/sleeping-stock-logo-only-source.png"),
    )
)
OUT_FG = ROOT / "assets/source/adaptive-icon-foreground-logo-only.png"
BG_PATH = ROOT / "assets/source/adaptive-icon-background.png"
PREV = ROOT / "assets/source/previews"
OLD_FG = Path(os.environ.get("SLEEPINGSTOCK_OLD_FG", str(OUT_FG)))
CANVAS = 1024
ALPHA_T = 16
# Android adaptive icon full canvas = 108dp; keyline safe zone diameter = 66dp.
SAFE_ZONE_DIAMETER_FRAC = 66 / 108  # ≈ 0.6111
# Visible bbox must stay comfortably inside that keyline (margin on both axes).
MAX_BBOX_FRAC = 0.60
# Mask-shape inset from full-canvas edges so fits() uses a ~MAX_BBOX_FRAC box/circle.
MASK_INSET = int(round(CANVAS * (1.0 - MAX_BBOX_FRAC) / 2))  # ≈ 205
BG_COLOR = (5, 7, 13)  # #05070d


def visual_bbox(im: Image.Image, threshold: int = ALPHA_T):
    alpha = im.getchannel("A")
    mask = alpha.point(lambda p, t=threshold: 255 if p >= t else 0)
    return mask.getbbox()


def crop_logo(im: Image.Image) -> Image.Image:
    bbox = visual_bbox(im)
    if not bbox:
        raise SystemExit("source logo has no visible pixels")
    return im.crop(bbox)


def opaque_points(im: Image.Image, step: int = 2):
    alpha = im.getchannel("A")
    w, h = im.size
    pts = []
    for y in range(0, h, step):
        for x in range(0, w, step):
            if alpha.getpixel((x, y)) >= ALPHA_T:
                pts.append((x, y))
    # Always include bbox corners of remaining opaque area.
    bbox = visual_bbox(im)
    if bbox:
        pts.extend(
            [
                (bbox[0], bbox[1]),
                (bbox[2] - 1, bbox[1]),
                (bbox[0], bbox[3] - 1),
                (bbox[2] - 1, bbox[3] - 1),
            ]
        )
    return pts


def in_circle(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def in_rounded_square(x, y, left, top, right, bottom, rad):
    if x < left or x > right or y < top or y > bottom:
        return False
    # Interior of the rectangle excluding corner circles.
    if left + rad <= x <= right - rad or top + rad <= y <= bottom - rad:
        return True
    corners = (
        (left + rad, top + rad),
        (right - rad, top + rad),
        (left + rad, bottom - rad),
        (right - rad, bottom - rad),
    )
    return any(in_circle(x, y, cx, cy, rad) for cx, cy in corners)


def in_squircle(x, y, cx, cy, r):
    nx = abs(x - cx) / r
    ny = abs(y - cy) / r
    return nx**4 + ny**4 <= 1.0


def fits(points, scale, ox, oy):
    """Strict mask fit: circle + squircle + rounded square inside MAX_BBOX_FRAC."""
    r = (CANVAS / 2) - MASK_INSET
    cx = cy = CANVAS / 2
    left = top = MASK_INSET
    right = bottom = CANVAS - 1 - MASK_INSET
    rad = 0.22 * (right - left)
    # Also enforce axis-aligned bbox ceiling (extra margin vs 66dp keyline).
    max_extent = CANVAS * MAX_BBOX_FRAC
    for x, y in points:
        px = ox + x * scale
        py = oy + y * scale
        if abs(px - cx) * 2 > max_extent or abs(py - cy) * 2 > max_extent:
            return False
        if not in_circle(px, py, cx, cy, r):
            return False
        if not in_squircle(px, py, cx, cy, r):
            return False
        if not in_rounded_square(px, py, left, top, right, bottom, rad):
            return False
    return True


def place_centered(logo: Image.Image, scale: float) -> Image.Image:
    """Resize logo and centre by its visible bounds on a transparent canvas."""
    lw, lh = logo.size
    resized = logo.resize(
        (max(1, round(lw * scale)), max(1, round(lh * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    rb = visual_bbox(resized)
    if rb:
        cropped = resized.crop(rb)
    else:
        cropped = resized
    x = (CANVAS - cropped.size[0]) // 2
    y = (CANVAS - cropped.size[1]) // 2
    canvas.alpha_composite(cropped, (x, y))
    return canvas


def compose(logo: Image.Image) -> Image.Image:
    points = opaque_points(logo)
    lw, lh = logo.size
    lo, hi = 0.05, min(CANVAS / lw, CANVAS / lh, MAX_BBOX_FRAC)
    best = lo
    for _ in range(28):
        mid = (lo + hi) / 2
        ox = (CANVAS - lw * mid) / 2
        oy = (CANVAS - lh * mid) / 2
        if fits(points, mid, ox, oy):
            best = mid
            lo = mid
        else:
            hi = mid

    canvas = place_centered(logo, best)
    bbox = visual_bbox(canvas)
    if not bbox:
        raise SystemExit("composed foreground has no visible pixels")

    # Enforce MAX_BBOX_FRAC after LANCZOS + integer centring (shrink if needed).
    fw = bbox[2] - bbox[0]
    fh = bbox[3] - bbox[1]
    frac_w = fw / CANVAS
    frac_h = fh / CANVAS
    if frac_w > MAX_BBOX_FRAC or frac_h > MAX_BBOX_FRAC:
        shrink = min(MAX_BBOX_FRAC / frac_w, MAX_BBOX_FRAC / frac_h) * 0.995
        best *= shrink
        canvas = place_centered(logo, best)
        bbox = visual_bbox(canvas)
        fw = bbox[2] - bbox[0]
        fh = bbox[3] - bbox[1]
        frac_w = fw / CANVAS
        frac_h = fh / CANVAS

    used = canvas.crop(bbox)
    print(
        f"scale={best:.4f} logo_px={used.size} fg_bbox={bbox} "
        f"frac=({frac_w:.3f}, {frac_h:.3f}) "
        f"max_frac={MAX_BBOX_FRAC} mask_inset={MASK_INSET} "
        f"safe_zone_diam={SAFE_ZONE_DIAMETER_FRAC:.3f}"
    )
    if frac_w > MAX_BBOX_FRAC or frac_h > MAX_BBOX_FRAC:
        raise SystemExit(
            f"foreground bbox fractions ({frac_w:.3f}, {frac_h:.3f}) exceed {MAX_BBOX_FRAC}"
        )
    return canvas


def write_solid_background() -> Image.Image:
    """Full-bleed solid adaptive background (#05070d)."""
    bg = Image.new("RGB", (CANVAS, CANVAS), BG_COLOR)
    BG_PATH.parent.mkdir(parents=True, exist_ok=True)
    bg.save(BG_PATH, "PNG")
    print(f"wrote solid background {BG_PATH} color=#{BG_COLOR[0]:02x}{BG_COLOR[1]:02x}{BG_COLOR[2]:02x}")
    return bg


def roundrect_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m


def squircle_mask(size):
    m = Image.new("L", (size, size), 0)
    px = m.load()
    c = (size - 1) / 2
    r = c
    for y in range(size):
        for x in range(size):
            if in_squircle(x, y, c, c, r):
                px[x, y] = 255
    return m


def circle_mask(size):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
    return m


def square_mask(size):
    return Image.new("L", (size, size), 255)


def teardrop_mask(size):
    """OEM-style teardrop: circle with a pointed bottom-right lobe (no hard triangle cut)."""
    m = Image.new("L", (size, size), 0)
    px = m.load()
    c = (size - 1) / 2.0
    r = c
    # Tip sits slightly outside the circle on the lower-right diagonal.
    tip_x = c + r * 0.92
    tip_y = c + r * 0.92
    for y in range(size):
        for x in range(size):
            in_c = (x - c) ** 2 + (y - c) ** 2 <= r * r
            # Soft lobe: points near the tip that stay inside a rounded cone from center.
            dx, dy = x - c, y - c
            toward_tip = dx + dy > 0
            lobe = toward_tip and ((x - tip_x) ** 2 + (y - tip_y) ** 2) <= (r * 0.55) ** 2
            if in_c or lobe:
                px[x, y] = 255
    return m


def composite(fg, bg):
    bg_r = bg.convert("RGBA").resize((CANVAS, CANVAS), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (CANVAS, CANVAS))
    out.alpha_composite(bg_r)
    out.alpha_composite(fg)
    return out


def apply_mask(im, mask):
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.paste(im, mask=mask)
    return out


def overlay_safe_zone(im):
    vis = im.copy()
    d = ImageDraw.Draw(vis)
    r = int(CANVAS * SAFE_ZONE_DIAMETER_FRAC / 2)
    c = CANVAS // 2
    d.ellipse((c - r, c - r, c + r, c + r), outline=(255, 255, 0, 220), width=4)
    d.ellipse((2, 2, CANVAS - 3, CANVAS - 3), outline=(0, 200, 255, 180), width=3)
    # Target max-bbox rectangle (0.60 of canvas), for visual QA.
    inset = MASK_INSET
    d.rectangle(
        (inset, inset, CANVAS - 1 - inset, CANVAS - 1 - inset),
        outline=(255, 120, 40, 200),
        width=3,
    )
    return vis


def launcher(im, px):
    return im.resize((px, px), Image.Resampling.LANCZOS)


def make_monochrome(fg: Image.Image) -> Image.Image:
    """White silhouette on transparent for Android 13+ themed icons."""
    alpha = fg.getchannel("A")
    out = Image.new("RGBA", fg.size, (0, 0, 0, 0))
    white = Image.new("RGBA", fg.size, (255, 255, 255, 255))
    out.paste(white, mask=alpha)
    return out


def write_legacy_mipmaps(comp: Image.Image):
    """mdpi–xxxhdpi legacy icons + Play Store 512 + Expo icon assets."""
    densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    legacy_root = ROOT / "assets" / "source" / "legacy-launcher"
    legacy_root.mkdir(parents=True, exist_ok=True)
    for folder, px in densities.items():
        d = legacy_root / folder
        d.mkdir(parents=True, exist_ok=True)
        launcher(comp, px).save(d / "ic_launcher.png")
        apply_mask(launcher(comp, px), circle_mask(px)).save(d / "ic_launcher_round.png")
    play = ROOT / "assets" / "source" / "play-store-icon-512.png"
    launcher(comp, 512).save(play)
    # Safe-zone composite for legacy android.icon (padded logo, not full-bleed fg).
    safe_zone = ROOT / "assets" / "source" / "sleeping-stock-app-icon-safe-zone.png"
    launcher(comp, 1024).save(safe_zone)
    # Also refresh top-level Expo icon assets used by app.json.
    launcher(comp, 1024).save(ROOT / "assets" / "icon.png")
    launcher(comp, 1024).save(ROOT / "assets" / "adaptive-icon.png")
    print("wrote legacy mipmaps + play-store 512 + safe-zone android.icon")


def write_adaptive_xml_templates():
    """Document the adaptive XML Expo/Android prebuild will materialize."""
    res = ROOT / "assets" / "source" / "adaptive-xml"
    res.mkdir(parents=True, exist_ok=True)
    xml = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/iconBackground"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
"""
    (res / "ic_launcher.xml").write_text(xml, encoding="utf-8")
    (res / "ic_launcher_round.xml").write_text(xml, encoding="utf-8")


def main():
    PREV.mkdir(parents=True, exist_ok=True)
    src = Image.open(SRC).convert("RGBA")
    old = Image.open(OLD_FG).convert("RGBA") if OLD_FG.exists() else None
    bg = write_solid_background()
    logo = crop_logo(src)
    fg = compose(logo)
    OUT_FG.parent.mkdir(parents=True, exist_ok=True)
    fg.save(OUT_FG, "PNG")
    mono = make_monochrome(fg)
    mono_path = ROOT / "assets" / "source" / "adaptive-icon-monochrome.png"
    mono.save(mono_path, "PNG")

    comp = composite(fg, bg)
    comp.save(PREV / "adaptive-composite.png")
    apply_mask(comp, circle_mask(CANVAS)).save(PREV / "circle.png")
    apply_mask(comp, squircle_mask(CANVAS)).save(PREV / "squircle.png")
    apply_mask(comp, roundrect_mask(CANVAS, int(CANVAS * 0.22))).save(PREV / "rounded-square.png")
    apply_mask(comp, teardrop_mask(CANVAS)).save(PREV / "teardrop.png")
    apply_mask(comp, square_mask(CANVAS)).save(PREV / "square.png")
    overlay_safe_zone(comp).save(PREV / "safe-zone-overlay.png")
    launcher(comp, 48).save(PREV / "launcher-48.png")
    launcher(comp, 192).save(PREV / "launcher-192.png")
    write_legacy_mipmaps(comp)
    write_adaptive_xml_templates()
    if old is not None:
        old_comp = composite(old, bg)
        launcher(old_comp, 48).save(PREV / "launcher-48-before.png")
        launcher(old_comp, 192).save(PREV / "launcher-192-before.png")
        ob = visual_bbox(old)
        nb = visual_bbox(fg)
        old_h = ob[3] - ob[1]
        new_h = nb[3] - nb[1]
        print(f"before_bbox_h={old_h} after_bbox_h={new_h} ratio={new_h/old_h:.2f}")
        print(f"before_frac_h={old_h/CANVAS:.3f} after_frac_h={new_h/CANVAS:.3f}")
    print("wrote", OUT_FG)
    print("wrote", mono_path)
    print("previews", PREV)


if __name__ == "__main__":
    main()
