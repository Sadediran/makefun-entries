#!/usr/bin/env python3
"""Solar Juicer, enhanced (attempt 4, draft 1).

A colossal black citrus press squeezes the sun; a white-hot S-shaped
torrent pours out and pools below. Stdlib only, deterministic output.
Writes a 1024x1024 PNG to $MAKEFUN_OUTPUT_DIR/entry.png (default ./out).
"""
import os
import struct
import zlib

W = 1024
H = 1024
OUT_DIR = os.environ.get("MAKEFUN_OUTPUT_DIR", "out")

# ---------------------------------------------------------------- pixels
buf = bytearray(W * H * 3)


def put(x, y, r, g, b):
    if 0 <= x < W and 0 <= y < H:
        i = (y * W + x) * 3
        buf[i] = r
        buf[i + 1] = g
        buf[i + 2] = b


def blend(x, y, r, g, b, a):
    """Alpha-blend colour (r,g,b) with opacity a (0..1) onto pixel."""
    if 0 <= x < W and 0 <= y < H and a > 0.0:
        i = (y * W + x) * 3
        if a >= 1.0:
            buf[i] = r
            buf[i + 1] = g
            buf[i + 2] = b
        else:
            buf[i] = int(buf[i] * (1.0 - a) + r * a)
            buf[i + 1] = int(buf[i + 1] * (1.0 - a) + g * a)
            buf[i + 2] = int(buf[i + 2] * (1.0 - a) + b * a)


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def fill_rect(x0, y0, x1, y1, col):
    x0 = max(0, x0)
    y0 = max(0, y0)
    x1 = min(W, x1)
    y1 = min(H, y1)
    r, g, b = col
    for y in range(y0, y1):
        base = y * W * 3
        for x in range(x0, x1):
            i = base + x * 3
            buf[i] = r
            buf[i + 1] = g
            buf[i + 2] = b


def fill_circle(cx, cy, rad, col, alpha=1.0):
    r0 = max(0, int(cx - rad))
    r1 = min(W - 1, int(cx + rad) + 1)
    t0 = max(0, int(cy - rad))
    t1 = min(H - 1, int(cy + rad) + 1)
    rr = rad * rad
    for y in range(t0, t1):
        dy = y - cy
        for x in range(r0, r1):
            dx = x - cx
            if dx * dx + dy * dy <= rr:
                if alpha >= 1.0:
                    put(x, y, *col)
                else:
                    blend(x, y, *col, alpha)


def fill_ellipse(cx, cy, rx, ry, col, alpha=1.0):
    r0 = max(0, int(cx - rx))
    r1 = min(W - 1, int(cx + rx) + 1)
    t0 = max(0, int(cy - ry))
    t1 = min(H - 1, int(cy + ry) + 1)
    for y in range(t0, t1):
        dy = (y - cy) / ry
        for x in range(r0, r1):
            dx = (x - cx) / rx
            if dx * dx + dy * dy <= 1.0:
                if alpha >= 1.0:
                    put(x, y, *col)
                else:
                    blend(x, y, *col, alpha)


def fill_poly(points, col, alpha=1.0):
    """Scanline polygon fill. points: list of (x, y)."""
    if len(points) < 3:
        return
    ys = [p[1] for p in points]
    y0 = max(0, int(min(ys)))
    y1 = min(H - 1, int(max(ys)) + 1)
    n = len(points)
    for y in range(y0, y1 + 1):
        xs = []
        for i in range(n):
            x1, y1p = points[i]
            x2, y2p = points[(i + 1) % n]
            if (y1p <= y < y2p) or (y2p <= y < y1p):
                t = (y - y1p) / (y2p - y1p)
                xs.append(x1 + t * (x2 - x1))
        xs.sort()
        for k in range(0, len(xs) - 1, 2):
            xa = max(0, int(xs[k]))
            xb = min(W - 1, int(xs[k + 1]) + 1)
            for x in range(xa, xb):
                if alpha >= 1.0:
                    put(x, y, *col)
                else:
                    blend(x, y, *col, alpha)


def thick_line(x0, y0, x1, y1, rad, col, alpha=1.0):
    """A thick segment drawn as a chain of filled circles."""
    dx = x1 - x0
    dy = y1 - y0
    dist = (dx * dx + dy * dy) ** 0.5
    steps = max(1, int(dist / max(1.0, rad * 0.45)))
    for s in range(steps + 1):
        t = s / steps
        fill_circle(x0 + dx * t, y0 + dy * t, rad, col, alpha)


def bezier(p0, p1, p2, p3, t):
    mt = 1.0 - t
    x = (mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0]
         + 3 * mt * t * t * p2[0] + t ** 3 * p3[0])
    y = (mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1]
         + 3 * mt * t * t * p2[1] + t ** 3 * p3[1])
    return x, y


# ---------------------------------------------------------------- palette
INK = (13, 11, 18)          # press black
INK_EDGE = (58, 44, 66)     # faint rim on the press
SUN_CORE = (255, 226, 110)
SUN_MID = (255, 178, 44)
SUN_EDGE = (255, 110, 26)
TORRENT_CORE = (255, 250, 226)
TORRENT_MID = (255, 210, 60)
TORRENT_EDGE = (255, 140, 26)
POOL_CORE = (255, 246, 205)
SKY_TOP = (26, 16, 51)
SKY_MID = (94, 38, 96)
SKY_LOW = (255, 138, 60)
CITY = (52, 32, 66)

# ---------------------------------------------------------------- sky
for y in range(H):
    t = y / (H - 1)
    if t < 0.55:
        u = t / 0.55
        r = int(lerp(SKY_TOP[0], SKY_MID[0], u))
        g = int(lerp(SKY_TOP[1], SKY_MID[1], u))
        b = int(lerp(SKY_TOP[2], SKY_MID[2], u))
    else:
        u = (t - 0.55) / 0.45
        r = int(lerp(SKY_MID[0], SKY_LOW[0], u))
        g = int(lerp(SKY_MID[1], SKY_LOW[1], u))
        b = int(lerp(SKY_MID[2], SKY_LOW[2], u))
    base = y * W * 3
    for x in range(W):
        buf[base + x * 3] = r
        buf[base + x * 3 + 1] = g
        buf[base + x * 3 + 2] = b

# faint stars in the upper sky
stars = [(80, 60), (150, 130), (240, 50), (330, 90), (700, 70), (820, 110),
         (920, 60), (880, 190), (120, 220), (960, 260), (60, 330), (420, 40)]
for sx, sy in stars:
    fill_circle(sx, sy, 2, (255, 240, 200), 0.85)

# ---------------------------------------------------------------- distant city
city = [(0, 700, 90, 760), (100, 660, 170, 760), (180, 710, 250, 760),
        (770, 690, 850, 760), (860, 650, 940, 760), (950, 705, 1024, 760)]
for x0, y0, x1, y1 in city:
    fill_rect(x0, y0, x1, y1, CITY)
    # a few lit windows
    for wy in range(y0 + 14, y1 - 8, 26):
        for wx in range(x0 + 12, x1 - 10, 30):
            if (wx * 7 + wy * 13) % 5 == 0:
                fill_rect(wx, wy, wx + 6, wy + 8, (255, 196, 90))

# ---------------------------------------------------------------- the sun (citrus)
SUN_C = (512, 330)
# halo
for rad, a in ((260, 0.10), (230, 0.14), (200, 0.18)):
    fill_circle(SUN_C[0], SUN_C[1], rad, SUN_EDGE, a)
# disc with radial shading
for y in range(SUN_C[1] - 160, SUN_C[1] + 161):
    dy = y - SUN_C[1]
    for x in range(SUN_C[0] - 170, SUN_C[0] + 171):
        dx = x - SUN_C[0]
        d = ((dx / 170.0) ** 2 + (dy / 145.0) ** 2) ** 0.5
        if d <= 1.0:
            if d < 0.45:
                t = d / 0.45
                col = (int(lerp(SUN_CORE[0], SUN_MID[0], t)),
                       int(lerp(SUN_CORE[1], SUN_MID[1], t)),
                       int(lerp(SUN_CORE[2], SUN_MID[2], t)))
            else:
                t = (d - 0.45) / 0.55
                col = (int(lerp(SUN_MID[0], SUN_EDGE[0], t)),
                       int(lerp(SUN_MID[1], SUN_EDGE[1], t)),
                       int(lerp(SUN_MID[2], SUN_EDGE[2], t)))
            put(x, y, *col)
# citrus segments: pale radial wedges from the centre
import math
for k in range(10):
    ang = k * math.pi / 5.0
    x1 = SUN_C[0] + 150 * math.cos(ang)
    y1 = SUN_C[1] + 128 * math.sin(ang)
    thick_line(SUN_C[0], SUN_C[1], x1, y1, 3, (255, 236, 150), 0.55)
fill_circle(SUN_C[0], SUN_C[1], 26, (255, 240, 170))
# pips: two small dark seeds near the centre
fill_ellipse(486, 312, 7, 11, (120, 60, 20))
fill_ellipse(540, 352, 7, 11, (120, 60, 20))

# ---------------------------------------------------------------- the press
# top screw + crossbar handle
fill_rect(498, 18, 526, 96, INK)
fill_rect(420, 34, 604, 52, INK)
fill_circle(420, 43, 10, INK)
fill_circle(604, 43, 10, INK)
# top beam pressing down on the sun
fill_poly([(176, 96), (848, 96), (812, 168), (212, 168)], INK)
# rim light on the beam's lower edge
thick_line(212, 168, 812, 168, 3, INK_EDGE, 0.9)
# side columns (legs)
fill_rect(196, 168, 236, 800, INK)
fill_rect(788, 168, 828, 800, INK)
# rim light on inner edges of the columns
thick_line(236, 180, 236, 790, 2, INK_EDGE, 0.7)
thick_line(788, 180, 788, 790, 2, INK_EDGE, 0.7)
# lower press plate / bowl under the sun
fill_poly([(300, 452), (724, 452), (676, 528), (348, 528)], INK)
fill_ellipse(512, 528, 168, 26, INK)
# spout where the torrent leaves the bowl
fill_rect(498, 528, 526, 556, INK)

# ---------------------------------------------------------------- rooftop
# The press stands on an ordinary rooftop: a muted surface, a low parapet
# along the bottom edge, and one clothesline with laundry (left side).
ROOF = (64, 44, 66)
PARAPET = (34, 24, 42)
PARAPET_TOP = (88, 62, 88)
fill_rect(0, 860, W, 940, ROOF)
fill_rect(0, 940, W, H, PARAPET)
thick_line(0, 940, W, 940, 2, PARAPET_TOP, 0.9)
# a couple of roof seams / vents, kept dark and quiet
fill_rect(60, 880, 130, 886, (48, 34, 52))
fill_rect(880, 876, 950, 882, (48, 34, 52))
# clothesline: poles + sagging line, shirt + towel hanging
fill_rect(56, 786, 62, 862, (40, 28, 46))
fill_rect(326, 770, 332, 862, (40, 28, 46))
thick_line(60, 788, 330, 772, 2, (210, 196, 180), 0.9)
# towel (left, hangs from the line)
fill_poly([(104, 790), (140, 788), (140, 826), (104, 828)], (206, 196, 182))
thick_line(104, 806, 140, 804, 2, (170, 150, 140), 0.8)
# shirt (right, body + short sleeves)
fill_poly([(238, 782), (292, 779), (300, 792), (288, 800), (288, 830),
           (244, 832), (244, 800), (232, 792)], (148, 158, 176))
thick_line(244, 800, 288, 798, 2, (110, 120, 140), 0.7)

# ---------------------------------------------------------------- the torrent (S-curve)
P0 = (512, 548)
P1 = (660, 630)
P2 = (400, 720)
P3 = (556, 856)
N = 90
pts = [bezier(P0, P1, P2, P3, i / N) for i in range(N + 1)]
# glow halo
for i in range(N):
    t = i / N
    rad = lerp(46, 30, t)
    thick_line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
               rad, TORRENT_EDGE, 0.28)
# mid body
for i in range(N):
    t = i / N
    rad = lerp(34, 22, t)
    thick_line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
               rad, TORRENT_MID, 1.0)
# white-hot core
for i in range(N):
    t = i / N
    rad = lerp(17, 10, t)
    thick_line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
               rad, TORRENT_CORE, 1.0)

# ---------------------------------------------------------------- landing pool (compact)
fill_ellipse(556, 874, 96, 28, TORRENT_MID)
fill_ellipse(556, 869, 74, 19, POOL_CORE)
fill_ellipse(556, 865, 44, 11, (255, 252, 235))
# small crown where the torrent strikes
fill_ellipse(556, 850, 24, 10, TORRENT_CORE)
# sparse spray: short streaks in motion, attached to the torrent / pool
spray = [((470, 838), (442, 822), TORRENT_MID, 4),
         ((646, 830), (676, 812), TORRENT_MID, 4),
         ((486, 566), (462, 548), TORRENT_CORE, 3),
         ((596, 640), (622, 626), TORRENT_CORE, 3),
         ((480, 700), (458, 688), TORRENT_MID, 3)]
for (sx0, sy0), (sx1, sy1), scol, srad in spray:
    thick_line(sx0, sy0, sx1, sy1, srad, scol, 0.95)

# ---------------------------------------------------------------- reacting humans
# Broad, separated black silhouettes at the base of the press -- no faces,
# no fingers, just bold recoil / shielding gestures. Principal figure is
# ~58 px tall (5.7% of the image). All clear of the press legs and torrent.
FIG = (10, 8, 16)


def figure(x, feet, h, lean, arm_up, arm_back):
    """Silhouette figure.

    x, feet: ground position. h: total height in px. lean: horizontal
    shift of the shoulders (negative = leaning back to the left).
    arm_up: if True, one arm raised to shield the eyes; arm_back: if
    True, the other arm flung back/down in recoil.
    """
    hip_y = feet - int(h * 0.52)
    sho_y = feet - int(h * 0.82)
    sho_x = x + lean
    head_y = feet - int(h * 0.93)
    head_r = max(6, int(h * 0.13))
    torso_r = max(5, int(h * 0.11))
    limb_r = max(4, int(h * 0.07))
    arm_r = max(4, int(h * 0.06))
    # legs: two clearly separated strides
    thick_line(x - 2, hip_y, x - 10, feet, limb_r, FIG)
    thick_line(x + 2, hip_y, x + 10, feet, limb_r, FIG)
    # torso (leaning)
    thick_line(x, hip_y, sho_x, sho_y, torso_r, FIG)
    # head
    fill_circle(sho_x + lean // 2, head_y, head_r, FIG)
    # shielding arm: raised high beside the head, clearly separated
    if arm_up:
        hx = sho_x + lean * 2 - head_r * 2
        thick_line(sho_x, sho_y, hx, head_y - head_r - 4, arm_r, FIG)
    # recoiling arm: flung back and out, nearly horizontal
    if arm_back:
        bx = sho_x - lean - int(h * 0.32)
        thick_line(sho_x, sho_y, bx, sho_y + int(h * 0.12), arm_r, FIG)


# principal: backing away from the washing, shielding her eyes (left)
figure(172, 926, 60, -8, True, True)
# second: on the right, both arms thrown up, leaning away from the press
figure(862, 930, 50, 7, True, True)
# third: far right, smaller, one hand shielding, turned away
figure(952, 932, 42, 6, True, False)

# ---------------------------------------------------------------- png write
def write_png(path):
    raw = bytearray()
    for y in range(H):
        raw.append(0)
        raw.extend(buf[y * W * 3:(y + 1) * W * 3])
    comp = zlib.compress(bytes(raw), 9)

    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        c += struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        return c

    ihdr = struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", comp) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return len(png)


os.makedirs(OUT_DIR, exist_ok=True)
size = write_png(os.path.join(OUT_DIR, "entry.png"))
print(f"wrote {os.path.join(OUT_DIR, 'entry.png')} ({size} bytes)")
