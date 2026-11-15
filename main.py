#!/usr/bin/env python3
"""Solar Juicer -- ai-excited-01 entry.

A colossal black citrus press, bolted to Earth's curved blue horizon,
squeezes the sun into a white-hot S-shaped torrent that lashes toward
the viewer and crashes into a broad foreground splash.

Pure standard library. Deterministic: fixed coordinates, sampled curves,
no randomness, no time, no network. Renders internally at 2048x2048 and
box-downsamples to 1024x1024. Writes /output/entry.png (or
$MAKEFUN_OUTPUT_DIR/entry.png).
"""

import os
import struct
import zlib
from math import isqrt, sqrt

S = 1024          # output size
SS = 2            # supersample factor
W = S * SS        # render size (2048)


# ---------------------------------------------------------------- canvas
class Canvas:
    def __init__(self):
        self.buf = bytearray(W * W * 3)

    def span(self, y, x0, x1, rgb):
        """Fill horizontal span [x0, x1) on row y (2048-space)."""
        if y < 0 or y >= W:
            return
        if x0 < 0:
            x0 = 0
        if x1 > W:
            x1 = W
        if x1 <= x0:
            return
        b = bytes(rgb)
        i0 = (y * W + x0) * 3
        self.buf[i0:(y * W + x1) * 3] = b * (x1 - x0)

    def disc(self, cx, cy, r, rgb):
        cx, cy, r = int(cx), int(cy), int(r)
        if r <= 0:
            return
        r2 = r * r
        for dy in range(-r, r + 1):
            y = cy + dy
            if 0 <= y < W:
                dx = isqrt(r2 - dy * dy)
                self.span(y, cx - dx, cx + dx + 1, rgb)

    def ellipse(self, cx, cy, rx, ry, rgb):
        cx, cy, rx, ry = int(cx), int(cy), int(rx), int(ry)
        if rx <= 0 or ry <= 0:
            return
        ry2 = ry * ry
        for dy in range(-ry, ry + 1):
            y = cy + dy
            if 0 <= y < W:
                t = isqrt(ry2 - dy * dy)
                dx = (rx * t) // ry
                self.span(y, cx - dx, cx + dx + 1, rgb)

    def disc_grad(self, cx, cy, r, top, bot):
        """Disc with a vertical gradient from top colour to bottom colour."""
        r2 = r * r
        for dy in range(-r, r + 1):
            y = cy + dy
            if 0 <= y < W:
                f = (dy + r) / (2.0 * r)
                rgb = tuple(int(top[i] + (bot[i] - top[i]) * f) for i in range(3))
                dx = isqrt(r2 - dy * dy)
                self.span(y, cx - dx, cx + dx + 1, rgb)

    def poly(self, pts, rgb):
        """Fill a convex polygon (list of (x, y) in 2048-space)."""
        pts = [(int(x), int(y)) for (x, y) in pts]
        ys = [p[1] for p in pts]
        y0, y1 = min(ys), max(ys)
        n = len(pts)
        for y in range(y0, y1 + 1):
            if y < 0 or y >= W:
                continue
            xs = []
            for i in range(n):
                x0, ya = pts[i]
                x1, yb = pts[(i + 1) % n]
                if (ya <= y < yb) or (yb <= y < ya):
                    xs.append(x0 + (y - ya) * (x1 - x0) / (yb - ya))
            if len(xs) >= 2:
                self.span(y, int(min(xs)), int(max(xs)) + 1, rgb)

    def chain(self, pts, radii, rgb):
        """Union of discs along a sampled curve: a smooth liquid band."""
        for (x, y), r in zip(pts, radii):
            self.disc(x, y, r, rgb)


# 1024-space wrappers: design in 1024 coordinates, rasterise at 2048.
def D(cv, cx, cy, r, rgb):
    cv.disc(cx * SS, cy * SS, r * SS, rgb)


def E(cv, cx, cy, rx, ry, rgb):
    cv.ellipse(cx * SS, cy * SS, rx * SS, ry * SS, rgb)


def P(cv, pts, rgb):
    cv.poly([(x * SS, y * SS) for (x, y) in pts], rgb)


def CH(cv, pts, radii, rgb):
    cv.chain([(x * SS, y * SS) for (x, y) in pts],
             [r * SS for r in radii], rgb)


def bezier(p0, p1, p2, p3, n):
    """Sample a cubic Bezier curve at n+1 fixed points."""
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1.0 - t
        x = (u ** 3 * p0[0] + 3 * u * u * t * p1[0]
             + 3 * u * t * t * p2[0] + t ** 3 * p3[0])
        y = (u ** 3 * p0[1] + 3 * u * u * t * p1[1]
             + 3 * u * t * t * p2[1] + t ** 3 * p3[1])
        pts.append((x, y))
    return pts


def lerp(a, b, f):
    return tuple(int(a[i] + (b[i] - a[i]) * f) for i in range(3))


# ---------------------------------------------------------------- palette
BLACK = (5, 6, 11)
PRESS = (11, 11, 14)
PRESS_EDGE = (38, 41, 48)
GOLD_RIM = (255, 215, 106)
WHITE = (255, 255, 255)
SUN_WHITE = (255, 250, 232)
SUN_YELLOW = (255, 217, 77)
SUN_GOLD = (255, 182, 39)
SUN_ORANGE = (255, 122, 26)
TORRENT_DARK = (232, 110, 10)
EARTH_TOP = (18, 64, 128)
EARTH_BOT = (5, 12, 28)
ATMO = (46, 164, 255)
ATMO_GLOW = (10, 30, 60)

# Earth geometry (1024-space): centre (512, 2300), radius 1800.
EARTH_CX, EARTH_CY, EARTH_R = 512, 2300, 1800


def pool_top(x):
    """Top edge y of the splash pool ellipse at column x (1024-space)."""
    dx = (x - 500) / 320.0
    if abs(dx) >= 1.0:
        return 990
    return 990 - 100 * sqrt(1.0 - dx * dx)


# ---------------------------------------------------------------- render
def render():
    cv = Canvas()

    # 1. Background: near-black vertical gradient.
    for y in range(W):
        f = y / (W - 1)
        cv.span(y, 0, W, lerp((4, 5, 10), (10, 12, 20), f))

    # 2. Sparse dim stars (fixed positions, never random).
    stars = [
        (60, 60, 2, (150, 160, 200)), (150, 130, 2, (110, 125, 160)),
        (880, 70, 2, (140, 150, 195)), (960, 150, 3, (120, 135, 175)),
        (830, 210, 2, (100, 115, 150)), (90, 260, 2, (130, 140, 180)),
        (980, 300, 2, (110, 125, 160)), (40, 380, 2, (90, 105, 145)),
        (920, 420, 2, (120, 135, 175)), (700, 90, 2, (100, 115, 150)),
        (760, 160, 3, (140, 150, 190)), (210, 60, 2, (110, 125, 160)),
        (300, 110, 2, (90, 105, 145)), (640, 60, 2, (120, 135, 175)),
        (990, 90, 2, (100, 115, 150)), (120, 180, 2, (130, 140, 180)),
        (860, 300, 2, (110, 125, 160)), (40, 470, 2, (90, 105, 145)),
        (980, 480, 2, (120, 135, 175)), (560, 40, 2, (100, 115, 150)),
        (480, 90, 2, (130, 140, 180)), (340, 200, 2, (90, 105, 145)),
        (720, 260, 2, (110, 125, 160)), (180, 330, 2, (120, 135, 175)),
    ]
    for (x, y, r, c) in stars:
        D(cv, x, y, r, c)

    # 3. Earth: soft halo, bright atmospheric rim, deep blue ocean.
    D(cv, EARTH_CX, EARTH_CY, 1900, ATMO_GLOW)
    D(cv, EARTH_CX, EARTH_CY, 1812, ATMO)
    # Ocean gradient: repaint the disc rows with a vertical gradient,
    # leaving the 12 px atmosphere ring visible as the bright rim.
    cv.disc_grad(EARTH_CX * SS, EARTH_CY * SS, EARTH_R * SS,
                 EARTH_TOP, EARTH_BOT)
    # Crisp bright rim: the atmosphere ring left visible by the gradient.
    # (No dotted overlay: spaced dots read as a dashed line.)

    # 4. Warm glow hugging the sun: five dim layers with small steps,
    #    so the falloff is soft and it never reads as a solid disc.
    for (gr, gc) in [(280, (10, 7, 2)), (250, (16, 11, 3)),
                     (220, (24, 16, 4)), (190, (36, 23, 6)),
                     (165, (52, 32, 7))]:
        D(cv, 440, 320, gr, gc)

    # 5. The press, back column (behind the sun), bolted to the horizon.
    P(cv, [(168, 92), (252, 92), (268, 530), (152, 530)], PRESS)
    P(cv, [(152, 92), (164, 92), (180, 530), (168, 530)], PRESS_EDGE)
    P(cv, [(252, 92), (258, 92), (268, 530), (262, 530)], GOLD_RIM)
    # Bolt feet on the horizon.
    D(cv, 185, 526, 9, (30, 33, 40))
    D(cv, 235, 526, 9, (30, 33, 40))
    D(cv, 183, 524, 3, (150, 160, 180))
    D(cv, 233, 524, 3, (150, 160, 180))

    # 6. The sun, flattened between the jaws: white-hot core to orange edge.
    E(cv, 440, 320, 212, 148, SUN_ORANGE)
    E(cv, 440, 320, 198, 136, SUN_GOLD)
    E(cv, 440, 320, 176, 114, SUN_YELLOW)
    E(cv, 440, 320, 140, 88, SUN_WHITE)
    E(cv, 440, 320, 108, 64, WHITE)

    # 7. Top jaw: heavy beam pressing down into the sun, with screw + knob.
    P(cv, [(96, 150), (600, 128), (612, 196), (108, 216)], PRESS)
    P(cv, [(96, 150), (600, 128), (600, 136), (96, 158)], PRESS_EDGE)
    P(cv, [(108, 216), (612, 196), (612, 202), (108, 222)], GOLD_RIM)
    P(cv, [(400, 60), (428, 60), (428, 140), (400, 140)], PRESS)
    D(cv, 414, 52, 26, PRESS)
    P(cv, [(360, 44), (468, 44), (468, 60), (360, 60)], PRESS)
    D(cv, 360, 52, 8, PRESS)
    D(cv, 468, 52, 8, PRESS)
    P(cv, [(360, 44), (468, 44), (468, 48), (360, 48)], PRESS_EDGE)

    # 8. Bottom jaw: cup holding the sun, gold rim, spout at lower right.
    P(cv, [(292, 424), (568, 424), (596, 496), (264, 496)], PRESS)
    P(cv, [(292, 424), (568, 424), (568, 430), (292, 430)], GOLD_RIM)
    P(cv, [(340, 492), (520, 492), (532, 512), (328, 512)], PRESS)
    P(cv, [(560, 452), (620, 452), (620, 478), (560, 478)], PRESS)
    P(cv, [(560, 474), (620, 474), (620, 478), (560, 478)], GOLD_RIM)

    # 9. The torrent: white-hot S-shaped band from the spout, lashing
    #    down toward the viewer -- a thin jet at the outlet, flaring wide
    #    as it falls, with a surging core and spray off its outer edge.
    seg1 = bezier((615, 465), (745, 495), (830, 580), (790, 685), 80)
    seg2 = bezier((790, 685), (745, 775), (630, 835), (545, 905), 80)
    centre = seg1 + seg2[1:]
    n = len(centre)
    widths = [18 + (95 - 18) * (i / (n - 1)) ** 0.9 for i in range(n)]
    CH(cv, centre, widths, SUN_ORANGE)
    CH(cv, centre, [w * 0.68 for w in widths], SUN_GOLD)
    CH(cv, centre, [w * 0.45 for w in widths], SUN_YELLOW)
    # Surging core: its width oscillates along the flow, so the band
    # reads as liquid rushing, not a uniform pipe.
    import math as _m2
    core_w = [w * (0.26 + 0.04 * _m2.sin(i * 0.55)) for i, w in
              enumerate(widths)]
    CH(cv, centre, core_w, SUN_WHITE)
    # Motion streaks along the flow: bright core streaks and dark edges.
    offs = [(-0.30, 5, WHITE), (0.05, 6, WHITE), (0.32, 4, (255, 240, 190)),
            (-0.52, 5, TORRENT_DARK), (0.55, 5, TORRENT_DARK)]
    for (side, sr, col) in offs:
        streak = []
        sradii = []
        for i, (x, y) in enumerate(centre):
            # Perpendicular offset: approximate the flow direction from
            # neighbouring samples.
            j = min(i + 1, n - 1)
            k = max(i - 1, 0)
            dx, dy = centre[j][0] - centre[k][0], centre[j][1] - centre[k][1]
            L = sqrt(dx * dx + dy * dy) or 1.0
            ox, oy = -dy / L * side * widths[i], dx / L * side * widths[i]
            streak.append((x + ox, y + oy))
            sradii.append(sr + widths[i] * 0.02)
        CH(cv, streak, sradii, col)
    # Spray flicks breaking off the torrent's convex edge: triangular
    # splashes whose wide base sits ON the band (never a drop on a stick).
    for idx in (95, 118, 140):
        x, y = centre[idx]
        j = min(idx + 1, n - 1)
        k = max(idx - 1, 0)
        dx, dy = centre[j][0] - centre[k][0], centre[j][1] - centre[k][1]
        L = sqrt(dx * dx + dy * dy) or 1.0
        nx, ny = dy / L, -dx / L          # outward (convex-side) normal
        tx, ty = dx / L, dy / L           # flow tangent
        bx, by = x + nx * widths[idx] * 0.8, y + ny * widths[idx] * 0.8
        tip = (bx + nx * 38, by + ny * 38)
        b1 = (bx - tx * 15, by - ty * 15)
        b2 = (bx + tx * 15, by + ty * 15)
        P(cv, [b1, b2, tip], SUN_GOLD)
        mid = (bx + nx * 20, by + ny * 20)
        P(cv, [(bx - tx * 6, by - ty * 6), (bx + tx * 6, by + ty * 6),
               tip], SUN_WHITE)

    # 10. Foreground splash: warm glow on the ocean, then the pool --
    #     darkest at its front edge, brightest where the torrent lands
    #     (off-centre), never a flat ringed plate.
    E(cv, 500, 1010, 380, 60, (50, 30, 8))
    E(cv, 500, 992, 322, 102, (230, 100, 15))
    E(cv, 500, 984, 310, 94, SUN_ORANGE)
    E(cv, 500, 980, 285, 80, SUN_GOLD)
    E(cv, 540, 980, 210, 52, (255, 230, 120))
    E(cv, 560, 940, 120, 30, (255, 240, 200))

    # 11. Impact burst where the torrent meets the pool: a white flash
    #     with short radial streaks, half-sunk into the bright zone.
    D(cv, 550, 912, 20, WHITE)
    for k in range(6):
        ang = k * 1.0471975511965976 + 0.2617993877991494
        x2 = 550 + 46 * _m2.cos(ang)
        y2 = 912 + 46 * _m2.sin(ang) * 0.6
        P(cv, [(550, 912), (x2, y2), (555, 916)], (255, 240, 190))

    # 12. Crown jets rising from the pool: wide bases, varied heights
    #     and leans, clearly emerging from the pool surface. The white
    #     core sits in the lower half only, so the tip stays gold and
    #     the jet reads as rising liquid, not a candle.
    jets = [(255, 150, -16), (345, 108, -8), (440, 168, -2),
            (640, 128, 8), (725, 96, 14)]
    for (x, h, lean) in jets:
        base = pool_top(x) + 8
        P(cv, [(x - 24, base), (x + 24, base), (x + lean, base - h)],
          SUN_GOLD)
        P(cv, [(x - 13, base), (x + 13, base),
               (x + lean * 0.45, base - h * 0.55)], SUN_WHITE)

    return cv.buf

    return cv.buf


# ---------------------------------------------------------------- downsample
def downsample(src):
    """Box-average 2048x2048 RGB down to 1024x1024 RGB."""
    out = bytearray(S * S * 3)
    W3 = W * 3
    for oy in range(S):
        a = src[(2 * oy) * W3:(2 * oy + 1) * W3]
        b = src[(2 * oy + 1) * W3:(2 * oy + 2) * W3]
        o = oy * S * 3
        for ox in range(S):
            i = ox * 6
            out[o + ox * 3] = (a[i] + a[i + 3] + b[i] + b[i + 3]) >> 2
            out[o + ox * 3 + 1] = (a[i + 1] + a[i + 4] + b[i + 1]
                                   + b[i + 4]) >> 2
            out[o + ox * 3 + 2] = (a[i + 2] + a[i + 5] + b[i + 2]
                                   + b[i + 5]) >> 2
    return bytes(out)


# ---------------------------------------------------------------- PNG encode
def png_chunk(typ, data):
    c = struct.pack(">I", len(data)) + typ + data
    c += struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
    return c


def encode_png(rgb, filter_type):
    """Encode 1024x1024 RGB as PNG. filter 0 = none, 1 = Sub."""
    raw = bytearray()
    row = S * 3
    for y in range(S):
        line = rgb[y * row:(y + 1) * row]
        if filter_type == 0:
            raw.append(0)
            raw += line
        else:
            raw.append(1)
            raw += bytes(line[0:3])
            prev = line
            cur = bytearray(line)
            for i in range(3, row):
                cur[i] = (line[i] - line[i - 3]) & 0xFF
            raw += bytes(cur[3:])
    ihdr = struct.pack(">IIBBBBB", S, S, 8, 2, 0, 0, 0)
    data = (b"\x89PNG\r\n\x1a\n"
            + png_chunk(b"IHDR", ihdr)
            + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + png_chunk(b"IEND", b""))
    return data


# ---------------------------------------------------------------- main
def main():
    outdir = os.environ.get("MAKEFUN_OUTPUT_DIR", "/output")
    os.makedirs(outdir, exist_ok=True)
    rgb = downsample(render())
    png = encode_png(rgb, 0)
    if len(png) > 1048576:
        alt = encode_png(rgb, 1)
        if len(alt) < len(png):
            png = alt
    path = os.path.join(outdir, "entry.png")
    with open(path, "wb") as f:
        f.write(png)
    print("wrote %s (%d bytes, %dx%d)" % (path, len(png), S, S))


if __name__ == "__main__":
    main()
