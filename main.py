#!/usr/bin/env python3
"""SOLAR JUICER — ai-excited-01 entry.

A colossal black citrus press bolted to Earth's curved blue horizon
squeezes the sun into a white-hot S-shaped torrent, crashing into a
broad foreground splash pool.

Pure standard library. Deterministic: fixed coordinates and sampled
curves, no randomness, no clock, no network. Renders at 2x and
downsamples to 1024x1024. Writes exactly one file: entry.png.
"""

import math
import os
import struct
import zlib

W = 1024
H = 1024
SS = 2                      # supersample factor
RW = W * SS                 # render width
RH = H * SS                 # render height

canvas = bytearray(RW * RH * 3)


# ---------------------------------------------------------------- palette

def hx(s):
    """'#rrggbb' -> (r, g, b)."""
    return (int(s[1:3], 16), int(s[3:5], 16), int(s[5:7], 16))


SKY_TOP = hx("#04060e")
SKY_BOT = hx("#0c1434")
EARTH_TOP = hx("#0e3a7d")
EARTH_BOT = hx("#061a3d")
RIM = hx("#38b6ff")
PRESS = hx("#0a0d13")
PRESS_EDGE = hx("#1a2230")
GOLD_LINE = hx("#ffcf5c")
GLOW = hx("#ff6a00")
ORANGE = hx("#ff8c1a")
GOLD = hx("#ffb300")
YELLOW = hx("#ffd94d")
PALE = hx("#fff3b0")
WHITE = hx("#ffffff")
POOL_SHADOW = hx("#160b00")


def lerp(a, b, t):
    return (round(a[0] + (b[0] - a[0]) * t),
            round(a[1] + (b[1] - a[1]) * t),
            round(a[2] + (b[2] - a[2]) * t))


# ------------------------------------------------------------ rasterizer
# All scene geometry is in 1024-space; the fill helpers scale by SS.

def fill_poly(pts, color):
    """Scanline-fill a polygon (solid colour). pts in 1024-space."""
    if len(pts) < 3:
        return
    sp = [(x * SS, y * SS) for x, y in pts]
    ys = [p[1] for p in sp]
    y0 = max(0, int(math.floor(min(ys))))
    y1 = min(RH - 1, int(math.ceil(max(ys))))
    fill = bytes(color)
    n = len(sp)
    for y in range(y0, y1 + 1):
        yc = y + 0.5
        xs = []
        for i in range(n):
            x0, yy0 = sp[i]
            x1, yy1 = sp[(i + 1) % n]
            if (yy0 <= yc < yy1) or (yy1 <= yc < yy0):
                t = (yc - yy0) / (yy1 - yy0)
                xs.append(x0 + t * (x1 - x0))
        if len(xs) < 2:
            continue
        xs.sort()
        base = y * RW * 3
        for k in range(0, len(xs) - 1, 2):
            xa = max(0, int(math.ceil(xs[k])))
            xb = min(RW, int(math.floor(xs[k + 1])))
            if xb > xa:
                canvas[base + xa * 3:base + xb * 3] = fill * (xb - xa)


def fill_poly_vgrad(pts, c_top, c_bot, y_top, y_bot):
    """Polygon filled with a vertical gradient (1024-space y range)."""
    if len(pts) < 3:
        return
    sp = [(x * SS, y * SS) for x, y in pts]
    ys = [p[1] for p in sp]
    y0 = max(0, int(math.floor(min(ys))))
    y1 = min(RH - 1, int(math.ceil(max(ys))))
    n = len(sp)
    span = max(1.0, (y_bot - y_top) * SS)
    for y in range(y0, y1 + 1):
        yc = y + 0.5
        xs = []
        for i in range(n):
            x0, yy0 = sp[i]
            x1, yy1 = sp[(i + 1) % n]
            if (yy0 <= yc < yy1) or (yy1 <= yc < yy0):
                t = (yc - yy0) / (yy1 - yy0)
                xs.append(x0 + t * (x1 - x0))
        if len(xs) < 2:
            continue
        xs.sort()
        t = (y - y_top * SS) / span
        fill = bytes(lerp(c_top, c_bot, max(0.0, min(1.0, t))))
        base = y * RW * 3
        for k in range(0, len(xs) - 1, 2):
            xa = max(0, int(math.ceil(xs[k])))
            xb = min(RW, int(math.floor(xs[k + 1])))
            if xb > xa:
                canvas[base + xa * 3:base + xb * 3] = fill * (xb - xa)


def fill_ellipse(cx, cy, rx, ry, color):
    """Solid ellipse, 1024-space centre and radii."""
    cx *= SS
    cy *= SS
    rx *= SS
    ry *= SS
    y0 = max(0, int(math.floor(cy - ry)))
    y1 = min(RH - 1, int(math.ceil(cy + ry)))
    fill = bytes(color)
    for y in range(y0, y1 + 1):
        yn = (y + 0.5 - cy) / ry
        if abs(yn) >= 1.0:
            continue
        dx = rx * math.sqrt(1.0 - yn * yn)
        xa = max(0, int(math.ceil(cx - dx)))
        xb = min(RW, int(math.floor(cx + dx)))
        if xb > xa:
            base = y * RW * 3
            canvas[base + xa * 3:base + xb * 3] = fill * (xb - xa)


def fill_ellipse_rgrad(cx, cy, rx, ry, c_inner, c_outer, rings=26):
    """Ellipse with a radial gradient, built from concentric rings."""
    for k in range(rings, 0, -1):
        t = k / rings
        fill_ellipse(cx, cy, rx * t, ry * t, lerp(c_inner, c_outer, t))


def thick_line(x0, y0, x1, y1, w, color):
    """A straight thick line as a quad polygon."""
    dx, dy = x1 - x0, y1 - y0
    ln = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / ln * w / 2.0, dx / ln * w / 2.0
    fill_poly([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny),
               (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)], color)


# ---------------------------------------------------------------- curves

def cubic(p0, p1, p2, p3, t):
    u = 1.0 - t
    return (u * u * u * p0[0] + 3 * u * u * t * p1[0]
            + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1]
            + 3 * u * t * t * p2[1] + t * t * t * p3[1])


def stroke_path(segments, width_fn, color, samples=44):
    """Fill a variable-width stroke along cubic Bezier segments.

    segments: list of (p0, p1, p2, p3) control tuples.
    width_fn(s): full width at arc position s in [0, 1].
    """
    pts = []
    for seg in segments:
        for i in range(samples + 1):
            pts.append(cubic(seg[0], seg[1], seg[2], seg[3], i / samples))
    n = len(pts)
    left, right = [], []
    for i, p in enumerate(pts):
        pa = pts[max(0, i - 1)]
        pb = pts[min(n - 1, i + 1)]
        dx, dy = pb[0] - pa[0], pb[1] - pa[1]
        ln = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / ln, dx / ln
        hw = width_fn(i / (n - 1)) / 2.0
        left.append((p[0] + nx * hw, p[1] + ny * hw))
        right.append((p[0] - nx * hw, p[1] - ny * hw))
    fill_poly(left + right[::-1], color)


def spike(x, base_y, height, half_w, lean, color, tip_color):
    """A curved splash spike: concave sides, leaning tip, bright core.

    Two-tone: a gold spike with a smaller pale spike riding its upper
    half, so the splash reads as liquid, not a flat triangle.
    """
    tip = (x + lean, base_y - height)
    left = (x - half_w, base_y)
    right = (x + half_w, base_y)
    mid_l = (x - half_w * 0.42 + lean * 0.35, base_y - height * 0.55)
    mid_r = (x + half_w * 0.42 + lean * 0.35, base_y - height * 0.55)
    fill_poly([left, mid_l, tip, mid_r, right], color)
    inner_h = height * 0.62
    inner_w = half_w * 0.45
    tip2 = (x + lean * 0.82, base_y - inner_h)
    fill_poly([(x - inner_w + lean * 0.25, base_y - height * 0.12),
               (x - inner_w * 0.4 + lean * 0.6, base_y - inner_h * 0.6),
               tip2,
               (x + inner_w * 0.4 + lean * 0.6, base_y - inner_h * 0.6),
               (x + inner_w + lean * 0.25, base_y - height * 0.12)],
              tip_color)


# ---------------------------------------------------------------- scene

def draw_sky():
    fill_poly_vgrad([(0, 0), (W, 0), (W, H), (0, H)], SKY_TOP, SKY_BOT, 0, H)
    # Stars: two incommensurate lattices, fixed positions, upper sky only.
    # (0.618 and 0.382 sum to 1, which draws a diagonal — avoided here.)
    for i in range(1, 37):
        x = (i * 0.618033988749895) % 1.0 * W
        y = (i * 0.754877666246693) % 1.0 * 540
        r = 0.9 + (i % 3) * 0.55
        bright = 150 + (i * 37) % 105
        fill_ellipse(x, y, r, r, (bright, bright, min(255, bright + 25)))


def draw_earth():
    # Cyan atmospheric rim: a slightly larger disc behind the Earth disc.
    fill_ellipse(512, 2050, 1408, 1408, RIM)
    # Earth disc, painted row by row with a vertical gradient so the
    # curved horizon stays an arc (no full-width bands: the sky must
    # show below y=650 at the frame's left and right edges).
    cx, cy, rr = 512.0, 2050.0, 1400.0
    y0 = max(0, int(math.floor((cy - rr) * SS)))
    for y in range(y0, RH):
        yn = (y + 0.5) / SS
        dy = (yn - cy) / rr
        if abs(dy) >= 1.0:
            continue
        dx = rr * math.sqrt(1.0 - dy * dy)
        xa = max(0, int(math.ceil((cx - dx) * SS)))
        xb = min(RW, int(math.floor((cx + dx) * SS)))
        t = (yn - 650) / (H - 650)
        fill = bytes(lerp(EARTH_TOP, EARTH_BOT, max(0.0, min(1.0, t))))
        base = y * RW * 3
        if xb > xa:
            canvas[base + xa * 3:base + xb * 3] = fill * (xb - xa)


def draw_press_frame():
    # Back plate: tall dark slab, slightly tapered, upper left.
    fill_poly([(92, 58), (218, 58), (206, 566), (104, 566)], PRESS)
    # Silhouette edges so the machine reads against the dark sky.
    thick_line(92, 58, 104, 566, 3, PRESS_EDGE)
    thick_line(92, 58, 218, 58, 3, PRESS_EDGE)
    thick_line(212, 70, 201, 556, 3, PRESS_EDGE)
    # Bolts on the plate.
    for bx, by in ((140, 120), (140, 300), (140, 500)):
        fill_ellipse(bx, by, 9, 9, hx("#05070a"))
        fill_ellipse(bx - 3, by - 3, 3, 3, hx("#3a465c"))


def draw_sun():
    # Soft outer glow fading into the sky, then the flattened stellar
    # disc, layer by layer. Compact, with a clearly stellar white core.
    fill_ellipse_rgrad(420, 335, 280, 160, hx("#ff9d00"), hx("#070b18"),
                       rings=22)
    fill_ellipse(420, 335, 228, 138, ORANGE)
    fill_ellipse(420, 335, 205, 122, GOLD)
    fill_ellipse(420, 335, 168, 100, YELLOW)
    fill_ellipse(420, 335, 132, 76, PALE)
    fill_ellipse(420, 335, 95, 50, WHITE)


def draw_press_jaws():
    # Top beam: thick bar pressing down on the sun, slight perspective.
    fill_poly([(84, 148), (648, 118), (648, 198), (84, 232)], PRESS)
    # Beam silhouette: top edge + end cap so the arm reads as machinery.
    thick_line(84, 148, 648, 118, 3, PRESS_EDGE)
    fill_poly([(622, 120), (648, 118), (648, 212), (622, 214)], PRESS_EDGE)
    # Screw stem + T-handle above the beam, with edge definition.
    fill_poly([(332, 34), (372, 34), (372, 152), (332, 152)], PRESS)
    thick_line(332, 34, 332, 152, 3, PRESS_EDGE)
    thick_line(372, 34, 372, 152, 3, PRESS_EDGE)
    fill_poly([(262, 28), (442, 28), (442, 56), (262, 56)], PRESS)
    thick_line(262, 28, 442, 28, 3, PRESS_EDGE)
    thick_line(262, 56, 442, 56, 3, PRESS_EDGE)
    fill_ellipse(352, 42, 15, 14, PRESS)
    # Lower jaw: thick bar under the sun.
    fill_poly([(168, 478), (596, 452), (606, 532), (178, 558)], PRESS)
    thick_line(178, 558, 606, 532, 3, PRESS_EDGE)
    # Gold rim light where the sun's light catches the metal.
    thick_line(90, 224, 640, 192, 4, GOLD_LINE)
    thick_line(176, 484, 592, 458, 4, GOLD_LINE)
    # Outlet lip: the jaw's right end, where the torrent escapes.
    fill_poly([(560, 452), (606, 448), (610, 486), (566, 490)], PRESS_EDGE)


def draw_torrent():
    # S-curve: out of the outlet, sweeping right, then curling down
    # into the pool. Width narrows mid-flight (accelerating flow).
    segs = [((598, 470), (838, 468), (884, 620), (806, 742)),
            ((806, 742), (736, 838), (686, 862), (644, 892))]

    def width(s):
        # 96 at the outlet, 58 at the fastest middle, 88 at impact.
        return 96.0 - 76.0 * math.sin(math.pi * min(1.0, s * 1.15)) \
            + 30.0 * max(0.0, s - 0.8) * 5.0

    stroke_path(segs, width, GLOW)
    stroke_path(segs, lambda s: width(s) * 0.76, ORANGE)
    stroke_path(segs, lambda s: width(s) * 0.54, GOLD)
    stroke_path(segs, lambda s: width(s) * 0.34, YELLOW)
    stroke_path(segs, lambda s: width(s) * 0.22, WHITE)
    # One pale speed streak hugging the flow's inner curve.
    pts = []
    for seg in segs:
        for i in range(45):
            pts.append(cubic(seg[0], seg[1], seg[2], seg[3], i / 44))
    shifted = []
    for i, p in enumerate(pts):
        pa = pts[max(0, i - 1)]
        pb = pts[min(len(pts) - 1, i + 1)]
        dx, dy = pb[0] - pa[0], pb[1] - pa[1]
        ln = math.hypot(dx, dy) or 1.0
        shifted.append((p[0] + dy / ln * 8, p[1] - dx / ln * 8))
    for i in range(len(shifted) - 1):
        x0, y0 = shifted[i]
        x1, y1 = shifted[i + 1]
        thick_line(x0, y0, x1, y1, 3, PALE)
    # Nozzle glow where the flow leaves the press.
    fill_ellipse(600, 470, 26, 18, YELLOW)
    fill_ellipse(600, 470, 15, 10, WHITE)


def draw_droplets():
    # Small vertical teardrops torn off the flow, hugging the torrent's
    # outer edge and falling straight down — spray, never floaters.
    drops = [
        (872, 580, 7, 18), (868, 690, 8, 22),
        (852, 790, 6, 16), (742, 830, 7, 18),
    ]
    for x, y, rx, ry in drops:
        fill_ellipse(x, y, rx, ry, GOLD)
        fill_poly([(x - rx * 0.55, y - ry * 0.7),
                   (x + rx * 0.55, y - ry * 0.7),
                   (x, y - ry * 1.7)], PALE)
        fill_ellipse(x, y + ry * 0.25, rx * 0.45, ry * 0.4, PALE)


def draw_pool():
    # Ground shadow, then the molten pool, then the crown splash.
    fill_ellipse(640, 934, 366, 66, POOL_SHADOW)
    fill_ellipse(640, 918, 344, 62, ORANGE)
    fill_ellipse(640, 916, 312, 54, GOLD)
    fill_ellipse(640, 914, 252, 42, YELLOW)
    fill_ellipse(640, 912, 188, 30, PALE)
    fill_ellipse(655, 910, 86, 14, WHITE)
    # Splash spikes: tallest at the impact point, leaning outward,
    # heights varied so the crown reads as one violent splash.
    spikes = [
        (348, 884, 54, 15, -20), (442, 884, 92, 19, -12),
        (540, 886, 122, 22, -6), (652, 886, 150, 24, 2),
        (752, 886, 104, 21, 10), (838, 884, 66, 17, 18),
    ]
    for x, by, hgt, hw, lean in spikes:
        spike(x, by, hgt, hw, lean, GOLD, PALE)
    # Impact burst: a bright star where the torrent lands.
    ix, iy = 650, 880
    for ang in range(0, 360, 45):
        a = math.radians(ang)
        ln = 40 if ang % 90 == 0 else 22
        thick_line(ix, iy, ix + math.cos(a) * ln, iy + math.sin(a) * ln,
                   5, WHITE)
    fill_ellipse(ix, iy, 10, 10, WHITE)


# ---------------------------------------------------------------- output

def downsample():
    """2x2 box average from the render buffer to 1024x1024."""
    out = bytearray(W * H * 3)
    for oy in range(H):
        sy = oy * SS
        orow = oy * W * 3
        r0 = sy * RW * 3
        r1 = (sy + 1) * RW * 3
        for ox in range(W):
            sx = ox * SS * 3
            o = orow + ox * 3
            for c in range(3):
                out[o + c] = (canvas[r0 + sx + c] + canvas[r0 + sx + 3 + c]
                              + canvas[r1 + sx + c]
                              + canvas[r1 + sx + 3 + c] + 2) // 4
    return out


def chunk(ctype, data):
    c = struct.pack(">I", len(data)) + ctype + data
    return c + struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF)


def write_png(path, data):
    raw = bytearray()
    stride = W * 3
    for y in range(H):
        raw.append(0)
        raw += data[y * stride:(y + 1) * stride]
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    draw_sky()
    draw_earth()
    draw_press_frame()
    draw_sun()
    draw_press_jaws()
    draw_torrent()
    draw_droplets()
    draw_pool()
    out = downsample()
    outdir = os.environ.get("MAKEFUN_OUTPUT_DIR", "/output")
    os.makedirs(outdir, exist_ok=True)
    write_png(os.path.join(outdir, "entry.png"), out)


if __name__ == "__main__":
    main()
