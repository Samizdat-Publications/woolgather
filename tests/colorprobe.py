"""Colour probe for look-dev: measures grass, path and water in lookdev shots taken at the bridge
(`node tests/lookdev.mjs --at -24,6 --times ...`), so the evening's colour arc can be tuned to
numbers instead of by eye.

    python tests/colorprobe.py test-results/probe-a t0_1 t0_4 t0_55 t0_95

Masks are built from the first (daylight) shot and reused for the others: the camera does not
move between shots because the lookdev run freezes time.
"""

import colorsys
import math
import os
import sys

from PIL import Image

# Boxes for the lookdev view from (-24, 6) with the 34-degree camera.
GRASS_BOXES = [(560, 560, 760, 660), (880, 400, 1040, 460)]
WATER_BOX = (200, 430, 320, 500)
PATH_REGION = (560, 220, 1280, 400)
# Grass in the shadow of the bush at the lower right.
SHADOW_BOX = (1050, 580, 1200, 640)
# Play area without HUD panels, for contrast.
FRAME_BOX = (300, 130, 1060, 640)


def hls(px):
    r, g, b = (c / 255 for c in px[:3])
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h * 360, l, s


def stats(img, pts):
    """Mean hue (saturation-weighted), luma (Rec. 709 on the sRGB values, closer to perceived
    brightness than HSL lightness, which rises for blues at equal brightness) and saturation."""
    xs = ys = 0.0
    sl = ss = 0.0
    for x, y in pts:
        px = img.getpixel((x, y))
        h, l, s = hls(px)
        a = math.radians(h)
        xs += math.cos(a) * s
        ys += math.sin(a) * s
        sl += (0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) / 255
        ss += s
    n = max(1, len(pts))
    hue = (math.degrees(math.atan2(ys, xs)) + 360) % 360
    return hue, sl / n, ss / n


def main():
    folder = sys.argv[1]
    names = sys.argv[2:]
    base = Image.open(os.path.join(folder, names[0] + ".png")).convert("RGB")
    grass = [(x, y) for (x0, y0, x1, y1) in GRASS_BOXES for x in range(x0, x1, 3) for y in range(y0, y1, 3)]
    water = [(x, y) for x in range(WATER_BOX[0], WATER_BOX[2], 3) for y in range(WATER_BOX[1], WATER_BOX[3], 3)]
    path = []
    x0, y0, x1, y1 = PATH_REGION
    for x in range(x0, x1, 3):
        for y in range(y0, y1, 3):
            h, l, s = hls(base.getpixel((x, y)))
            if 20 <= h <= 48 and s > 0.22 and 0.25 < l < 0.7:
                path.append((x, y))
    shadow = [(x, y) for x in range(SHADOW_BOX[0], SHADOW_BOX[2], 3) for y in range(SHADOW_BOX[1], SHADOW_BOX[3], 3)]
    frame = [(x, y) for x in range(FRAME_BOX[0], FRAME_BOX[2], 4) for y in range(FRAME_BOX[1], FRAME_BOX[3], 4)]
    print(f"samples: grass {len(grass)} water {len(water)} path {len(path)} shadow {len(shadow)}")
    print(f"{'shot':8} {'grass h/Y/S':>17} {'shadow h/Y/S':>17} {'path h/Y/S':>17} {'water h/Y/S':>17} w/g  Y P5-P95        mean h/S/V")
    for n in names:
        img = Image.open(os.path.join(folder, n + ".png")).convert("RGB")
        g = stats(img, grass)
        sh = stats(img, shadow)
        p = stats(img, path)
        w = stats(img, water)
        cols = [img.getpixel(q) for q in frame]
        ys = sorted((0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) for c in cols)
        # The mean colour of the play area as a whole (hue and HSV saturation of the average).
        mr, mg, mb = (sum(c[i] for c in cols) / len(cols) / 255 for i in range(3))
        mh, ms, mv = colorsys.rgb_to_hsv(mr, mg, mb)
        # How monochrome the frame is: the share of coloured pixels within 20 degrees of the most
        # common hue, and the share that reads as rose (hue 330-20, some saturation).
        hues = []
        rose = 0
        for c in cols:
            hh, ss_, vv = colorsys.rgb_to_hsv(*(v / 255 for v in c))
            if ss_ > 0.12 and vv > 0.08:
                hues.append(hh * 360)
                if (hh * 360 >= 330 or hh * 360 <= 20) and ss_ > 0.2:
                    rose += 1
        best = 0
        for centre in range(0, 360, 5):
            cnt = sum(1 for hh in hues if abs(((hh - centre + 180) % 360) - 180) <= 20)
            best = max(best, cnt)
        mono = best / max(1, len(hues))
        rosy = rose / max(1, len(cols))
        p5 = ys[int(len(ys) * 0.05)]
        p95 = ys[int(len(ys) * 0.95)]
        fmt = lambda t: f"{t[0]:4.0f} {t[1]:.3f} {t[2]:.2f}"
        print(f"{n:8} {fmt(g):>17} {fmt(sh):>17} {fmt(p):>17} {fmt(w):>17} {w[1] / max(g[1], 1e-3):.2f} {p5:3.0f}-{p95:3.0f} ({p95 - p5:3.0f})  mean {mh * 360:4.0f} {ms:.2f} {mv:.2f}  mono {mono:.2f} rose {rosy:.2f}  Ymean {sum(ys) / len(ys):5.1f}")


main()
