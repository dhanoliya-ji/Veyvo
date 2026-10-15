"""Play Store graphics: 512px icon and 1024x500 feature graphic, in Veyvo's violet→coral style (no people)."""

import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
from make_icons import gradient, v_mark, with_shadow  # noqa: E402

OUT = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)

DEEP = (98, 80, 230)
VIOLET = (147, 133, 255)
CORAL = (255, 143, 154)


def font(size: int, bold: bool = True):
    for name in (["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def h_gradient(w: int, h: int) -> Image.Image:
    img = Image.new("RGB", (w, h))
    px = img.load()
    for x in range(w):
        t = x / (w - 1)
        if t < 0.55:
            k = t / 0.55
            c = tuple(int(DEEP[i] + (VIOLET[i] - DEEP[i]) * k) for i in range(3))
        else:
            k = (t - 0.55) / 0.45
            c = tuple(int(VIOLET[i] + (CORAL[i] - VIOLET[i]) * k) for i in range(3))
        for y in range(h):
            px[x, y] = c
    return img


def bubble(draw: ImageDraw.ImageDraw, box, fill, radius=28):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def main() -> None:
    # 512x512 hi-res icon (Play requires 32-bit PNG, 512x512)
    icon = gradient(512).convert("RGBA")
    icon = Image.alpha_composite(icon, with_shadow(v_mark(512)))
    icon.save(f"{OUT}/icon-512.png")

    # 1024x500 feature graphic
    w, h = 1024, 500
    bg = h_gradient(w, h).convert("RGBA")
    # soft glow circles
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    for cx, cy, r, a in ((820, 90, 220, 50), (930, 430, 160, 40), (120, 460, 180, 35)):
        g.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, a))
    bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(40)))

    # app mark tile on the left
    tile = gradient(180).convert("RGBA")
    tile = Image.alpha_composite(tile, with_shadow(v_mark(180)))
    mask = Image.new("L", (180, 180), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, 179, 179], radius=42, fill=255)
    tile.putalpha(mask)
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([70, 92, 250, 272], radius=42, fill=(30, 10, 80, 90))
    bg = Image.alpha_composite(bg, shadow.filter(ImageFilter.GaussianBlur(14)))
    bg.alpha_composite(tile, (64, 80))

    d = ImageDraw.Draw(bg)
    d.text((64, 290), "Veyvo", font=font(76), fill="white")
    d.text((66, 385), "Meet your people. Find your vibe.", font=font(30, bold=False), fill=(255, 255, 255, 235))
    d.text((66, 425), "Hang out together.", font=font(30, bold=False), fill=(255, 255, 255, 235))

    # right side: abstract UI chips (no people)
    chips = [(70, "It's a match! You're friends now", 0), (165, "Video room · 6 inside", 40), (260, "Chess with voice & faces", 0), (355, "A letter just arrived", 60)]
    f = font(25)
    for top, text, inset in chips:
        tw = d.textlength(text, font=f)
        right = 980 - inset
        left = int(right - tw - 100)
        box = (left, top, right, top + 70)
        bubble(d, box, (255, 255, 255, 235))
        d.ellipse([left + 18, top + 17, left + 54, top + 53], fill=VIOLET)
        d.text((left + 72, top + 20), text, font=f, fill=(40, 30, 90))
    bg.convert("RGB").save(f"{OUT}/feature-graphic.png")
    print("store graphics written")


if __name__ == "__main__":
    main()
