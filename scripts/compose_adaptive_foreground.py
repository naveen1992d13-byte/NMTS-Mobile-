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
# Minimum inset from the mask edge, in canvas pixels (~2% of 1024).
MASK_INSET = 20


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
    r = (CANVAS / 2) - MASK_INSET
    cx = cy = CANVAS / 2
    left = top = MASK_INSET
    right = bottom = CANVAS - 1 - MASK_INSET
    rad = 0.22 * (right - left)
    for x, y in points:
        px = ox + x * scale
        py = oy + y * scale
        if not in_circle(px, py, cx, cy, r):
            return False
        if not in_squircle(px, py, cx, cy, r):
            return False
        if not in_rounded_square(px, py, left, top, right, bottom, rad):
            return False
    return True


def compose(logo: Image.Image) -> Image.Image:
    points = opaque_points(logo)
    lw, lh = logo.size
    lo, hi = 0.05, min(CANVAS / lw, CANVAS / lh)
    best = lo
    for _ in range(24):
        mid = (lo + hi) / 2
        ox = (CANVAS - lw * mid) / 2
        oy = (CANVAS - lh * mid) / 2
        if fits(points, mid, ox, oy):
            best = mid
            lo = mid
        else:
            hi = mid
    ox = (CANVAS - lw * best) / 2
    oy = (CANVAS - lh * best) / 2
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    resized = logo.resize((max(1, round(lw * best)), max(1, round(lh * best))), Image.Resampling.LANCZOS)
    # Recentre using the resized visual bbox.
    rb = visual_bbox(resized)
    if rb:
        cropped = resized.crop(rb)
        x = (CANVAS - cropped.size[0]) // 2
        y = (CANVAS - cropped.size[1]) // 2
        canvas.alpha_composite(cropped, (x, y))
        used = cropped
    else:
        canvas.alpha_composite(resized, (round(ox), round(oy)))
        used = resized
    bbox = visual_bbox(canvas)
    print(
        f"scale={best:.4f} logo_px={used.size} fg_bbox={bbox} "
        f"frac=({(bbox[2]-bbox[0])/CANVAS:.3f}, {(bbox[3]-bbox[1])/CANVAS:.3f})"
    )
    return canvas


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
    """Common OEM teardrop: circle with a flattened/rounded bottom-right corner."""
    m = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(m)
    draw.ellipse((0, 0, size - 1, size - 1), fill=255)
    # Flatten lower-right into a soft cut (teardrop-ish).
    cut = int(size * 0.28)
    draw.polygon(
        [(size - 1, size // 2), (size - 1, size - 1), (size // 2, size - 1), (size - cut, size - cut)],
        fill=0,
    )
    # Soften with a rounded corner fill back for a teardrop lobe.
    draw.pieslice((size - cut * 2, size - cut * 2, size - 1, size - 1), 0, 90, fill=255)
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
    r = int(CANVAS * 66 / 108 / 2)
    c = CANVAS // 2
    d.ellipse((c - r, c - r, c + r, c + r), outline=(255, 255, 0, 220), width=4)
    d.ellipse((2, 2, CANVAS - 3, CANVAS - 3), outline=(0, 200, 255, 180), width=3)
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
    """mdpi–xxxhdpi legacy icons + Play Store 512."""
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
    # Also refresh top-level Expo icon assets used by app.json.
    launcher(comp, 1024).save(ROOT / "assets" / "icon.png")
    launcher(comp, 1024).save(ROOT / "assets" / "adaptive-icon.png")
    print("wrote legacy mipmaps + play-store 512")


def write_adaptive_xml_templates():
    """Document the adaptive XML Expo/Android prebuild will materialize."""
    res = ROOT / "assets" / "source" / "adaptive-xml"
    res.mkdir(parents=True, exist_ok=True)
    (res / "ic_launcher.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
""",
        encoding="utf-8",
    )
    (res / "ic_launcher_round.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
""",
        encoding="utf-8",
    )


def main():
    PREV.mkdir(parents=True, exist_ok=True)
    src = Image.open(SRC).convert("RGBA")
    old = Image.open(OLD_FG).convert("RGBA") if OLD_FG.exists() else None
    bg = Image.open(BG_PATH)
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
