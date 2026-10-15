"""Generate Veyvo app icons: a white rounded 'V' mark on a violet→coral gradient."""

from PIL import Image, ImageDraw, ImageFilter

import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "mobile", "assets")
SS = 4  # supersampling for smooth edges

VIOLET = (147, 133, 255)
DEEP = (98, 80, 230)
CORAL = (255, 143, 154)


def gradient(size: int) -> Image.Image:
    """Diagonal violet → coral gradient with a soft deep-violet corner."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            if t < 0.5:
                k = t / 0.5
                c = tuple(int(DEEP[i] + (VIOLET[i] - DEEP[i]) * k) for i in range(3))
            else:
                k = (t - 0.5) / 0.5
                c = tuple(int(VIOLET[i] + (CORAL[i] - VIOLET[i]) * k) for i in range(3))
            px[x, y] = c
    return img


def v_mark(size: int, color=(255, 255, 255, 255), scale: float = 1.0) -> Image.Image:
    """Transparent canvas with a bold rounded V and a small 'spark' dot, centred."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w = int(s * 0.115 * scale)  # stroke width
    cx = s / 2
    top = s * (0.5 - 0.22 * scale)
    bottom = s * (0.5 + 0.22 * scale)
    half = s * 0.2 * scale
    left = (cx - half, top)
    right = (cx + half, top)
    tip = (cx, bottom)
    d.line([left, tip], fill=color, width=w)
    d.line([tip, right], fill=color, width=w)
    r = w / 2
    for (x, y) in (left, right, tip):
        d.ellipse([x - r, y - r, x + r, y + r], fill=color)
    # spark: a small dot at upper right, like a 'live' indicator
    sr = w * 0.42
    sx, sy = cx + half + w * 0.95, top - w * 0.55
    d.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=color)
    return img.resize((size, size), Image.LANCZOS)


def rounded(img: Image.Image, radius_ratio: float) -> Image.Image:
    size = img.width
    mask = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size * SS - 1, size * SS - 1], radius=int(size * SS * radius_ratio), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def with_shadow(mark: Image.Image) -> Image.Image:
    shadow = Image.new("RGBA", mark.size, (0, 0, 0, 0))
    alpha = mark.split()[3].filter(ImageFilter.GaussianBlur(mark.width * 0.012))
    shadow.putalpha(alpha.point(lambda a: int(a * 0.28)))
    base = Image.new("RGBA", mark.size, (0, 0, 0, 0))
    base.paste((40, 20, 90, 255), (0, int(mark.width * 0.012)), shadow)
    return Image.alpha_composite(base, mark)


def main() -> None:
    # App icon (full bleed square; stores apply their own mask)
    icon = gradient(1024).convert("RGBA")
    icon = Image.alpha_composite(icon, with_shadow(v_mark(1024)))
    icon.convert("RGB").save(f"{OUT}/icon.png")

    # Android adaptive icon: background layer + foreground inside the 66% safe zone
    gradient(1024).save(f"{OUT}/android-icon-background.png")
    with_shadow(v_mark(1024, scale=0.72)).save(f"{OUT}/android-icon-foreground.png")
    v_mark(1024, scale=0.72).save(f"{OUT}/android-icon-monochrome.png")

    # Splash: rounded gradient tile with the mark (shown on the splash background colour)
    tile = gradient(512).convert("RGBA")
    tile = Image.alpha_composite(tile, with_shadow(v_mark(512)))
    rounded(tile, 0.24).save(f"{OUT}/splash-icon.png")

    # Web favicon
    rounded(icon, 0.24).resize((48, 48), Image.LANCZOS).save(f"{OUT}/favicon.png")
    print("icons written")


if __name__ == "__main__":
    main()
