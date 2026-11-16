#!/usr/bin/env python3
"""Solar Juicer - ai-excited-01.

A colossal black citrus press, bolted to Earth's curved blue horizon,
squeezes the sun into a white-hot S-shaped torrent that crashes into a
broad splash pool in the foreground.

Pure Python standard library (hashlib, math, os, struct, zlib).
Deterministic: fixed coordinates, sampled Bezier curves and a
fixed-seed star placement - no randomness, no clock, no network.
Renders at 2x and downsamples to exactly 1024x1024; writes
/output/entry.png (or $MAKEFUN_OUTPUT_DIR/entry.png).
"""

import hashlib
import math
import os
import struct
import zlib

SS = 2                  # supersample factor
SIZE = 1024             # output size in pixels
W = SIZE * SS
H = SIZE * SS

# ---------------------------------------------------------------- palette
SKY_TOP = (4, 6, 13)
SKY_HORIZON = (10, 20, 36)
EARTH_TOP = (28, 77, 146)
EARTH_BOTTOM = (13, 42, 88)
RIM_BRIGHT = (99, 184, 255)
RIM_DIM = (29, 95, 174)
DISC = (21, 16, 9)
DISC_RIM = (38, 27, 17)
MACHINE = (10, 10, 12)
MACHINE_EDGE = (38, 42, 51)
MACHINE_SOFT = (14, 14, 16)
BOLT = (51, 55, 63)
BOLT_DARK = (20, 22, 26)
GOLD_LINE = (217, 164, 65)
GOLD_DARK = (201, 147, 47)
SUN_HALO = (58, 28, 8)
ORANGE = (249, 115, 22)
GOLD = (245, 166, 35)
YELLOW = (253, 224, 71)
PALE = (254, 249, 195)
WHITE = (255, 255, 255)
CREAM = (255, 253, 240)
STAR = (232, 238, 252)
STAR_DIM = (159, 180, 216)
SHADOW = (5, 7, 13)

# ---------------------------------------------------------------- canvas
buf = bytearray(W * H * 3)


def _s(v):
    """Scale a 1024-space coordinate to internal (2x) pixels."""
    return int(round(v * SS))


def run(y, x0, x1, rgb):
    """Fill one horizontal run of internal pixels with a solid colour."""
    if y < 0 or y >= H or x1 < x0:
        return
    if x0 < 0:
        x0 = 0
    if x1 >= W:
        x1 = W - 1
    if x1 < x0:
        return
    n = x1 - x0 + 1
    start = (y * W + x0) * 3
    buf[start:start + n * 3] = bytes(rgb) * n


def rect(x0, y0, x1, y1, rgb):
    """Fill a rectangle given in 1024-space coordinates."""
    for y in range(_s(y0), _s(y1) + 1):
        run(y, _s(x0), _s(x1), rgb)


def ellipse(cx, cy, rx, ry, rgb):
    """Fill an ellipse given in 1024-space coordinates."""
    cx, cy, rx, ry = _s(cx), _s(cy), _s(rx), _s(ry)
    for y in range(cy - ry, cy + ry + 1):
        if y < 0 or y >= H:
            continue
        t = (y - cy) / ry
        dx = rx * math.sqrt(max(0.0, 1.0 - t * t))
        run(y, int(cx - dx), int(cx + dx), rgb)


def polygon(points, rgb):
    """Fill a polygon given in 1024-space coordinates (scanline fill)."""
    pts = [(_s(x), _s(y)) for x, y in points]
    edges = []
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        if y0 == y1:
            continue
        if y0 > y1:
            x0, y0, x1, y1 = x1, y1, x0, y0
        edges.append((y0, y1, x0, x1))
    ymin = min(y for _, y in pts)
    ymax = max(y for _, y in pts)
    for y in range(max(0, ymin), min(H, ymax + 1)):
        xs = []
        for y0, y1, x0, x1 in edges:
            if y0 <= y < y1:
                t = (y - y0) / (y1 - y0)
                xs.append(x0 + t * (x1 - x0))
        if len(xs) < 2:
            continue
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            run(y, int(xs[i]), int(xs[i + 1]), rgb)


def lerp(c0, c1, t):
    """Linear blend between two RGB colours; t in [0, 1]."""
    if t < 0.0:
        t = 0.0
    elif t > 1.0:
        t = 1.0
    return (round(c0[0] + (c1[0] - c0[0]) * t),
            round(c0[1] + (c1[1] - c0[1]) * t),
            round(c0[2] + (c1[2] - c0[2]) * t))


# ---------------------------------------------------------------- curves
def cubic(p0, p1, p2, p3, steps):
    """Sample a cubic Bezier curve into a list of (x, y) points."""
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1.0 - t
        x = (u ** 3 * p0[0] + 3 * u * u * t * p1[0]
             + 3 * u * t * t * p2[0] + t ** 3 * p3[0])
        y = (u ** 3 * p0[1] + 3 * u * u * t * p1[1]
             + 3 * u * t * t * p2[1] + t ** 3 * p3[1])
        pts.append((x, y))
    return pts


def stream_polygon(centre, widths):
    """Outline polygon of a stream of varying half-width around a centreline."""
    left = []
    right = []
    n = len(centre)
    for i, (x, y) in enumerate(centre):
        xa, ya = centre[max(0, i - 1)]
        xb, yb = centre[min(n - 1, i + 1)]
        dx, dy = xb - xa, yb - ya
        ln = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / ln, dx / ln
        w = widths[i]
        left.append((x + nx * w, y + ny * w))
        right.append((x - nx * w, y - ny * w))
    return left + right[::-1]


# ---------------------------------------------------------------- scene
def horizon_y(x):
    """Earth's horizon: 555 at the frame edges, sagging to 620 at centre."""
    d = (x - 512.0) / 512.0
    return 620.0 - 65.0 * d * d


def draw_sky_and_stars():
    # Vertical gradient, near-black at the top, deep navy at the horizon.
    for yi in range(H):
        y = yi / SS
        t = y / 620.0
        run(yi, 0, W - 1, lerp(SKY_TOP, SKY_HORIZON, t))
    # Fixed-seed stars (deterministic LCG, no randomness at run time).
    state = 12345
    for _ in range(60):
        state = (1103515245 * state + 12345) & 0x7FFFFFFF
        sx = 20 + state % 984
        state = (1103515245 * state + 12345) & 0x7FFFFFFF
        sy = 12 + state % 480
        state = (1103515245 * state + 12345) & 0x7FFFFFFF
        r = 1 if state % 3 else 2
        colour = STAR if state % 4 else STAR_DIM
        ellipse(sx, sy, r, r, colour)


def draw_earth():
    # Earth fills everything below the horizon arc.
    for yi in range(H):
        y = yi / SS
        if y < 555.0:
            continue
        t = (y - 560.0) / (1024.0 - 560.0)
        colour = lerp(EARTH_TOP, EARTH_BOTTOM, t)
        if y >= 620.0:
            run(yi, 0, W - 1, colour)
        else:
            a = 512.0 * math.sqrt((620.0 - y) / 65.0)
            run(yi, 0, int(512 - a), colour)
            run(yi, int(512 + a), W - 1, colour)
    # Atmospheric rim: a dim glow band with a bright core line on it.
    for xi in range(W):
        x = xi / SS
        hy = horizon_y(x)
        run(_s(hy - 7), xi, xi, RIM_DIM)
        run(_s(hy - 6), xi, xi, RIM_DIM)
        run(_s(hy - 5), xi, xi, RIM_DIM)
        run(_s(hy - 4), xi, xi, RIM_DIM)
        run(_s(hy - 3), xi, xi, RIM_DIM)
        run(_s(hy - 2), xi, xi, RIM_BRIGHT)
        run(_s(hy - 1), xi, xi, RIM_BRIGHT)
        run(_s(hy), xi, xi, RIM_BRIGHT)
        run(_s(hy + 1), xi, xi, RIM_BRIGHT)
        run(_s(hy + 2), xi, xi, RIM_BRIGHT)
        run(_s(hy + 3), xi, xi, RIM_DIM)
        run(_s(hy + 4), xi, xi, RIM_DIM)
        run(_s(hy + 5), xi, xi, RIM_DIM)
        run(_s(hy + 6), xi, xi, RIM_DIM)
        run(_s(hy + 7), xi, xi, RIM_DIM)


def draw_disc():
    # The press's dark backplate: a huge near-black disc behind the sun.
    ellipse(430, 290, 310, 310, DISC_RIM)
    ellipse(430, 290, 303, 303, DISC)


def draw_press():
    # Left post with a lit edge, and the support strut beside it.
    rect(150, 95, 205, 560, MACHINE)
    rect(150, 95, 154, 560, MACHINE_EDGE)
    rect(201, 95, 205, 560, (26, 29, 36))
    rect(228, 205, 252, 448, MACHINE_SOFT)
    # T-handle on top.
    rect(398, 45, 424, 135, MACHINE)
    rect(352, 42, 458, 60, (13, 13, 15))
    rect(352, 42, 458, 45, MACHINE_EDGE)
    # Top beam.
    rect(95, 135, 625, 205, MACHINE)
    rect(95, 135, 625, 138, MACHINE_EDGE)


def draw_sun():
    # Flattened sun, squeezed between the press jaws: orange out to a
    # white-hot stellar core. No fruit-like rind, no text.
    ellipse(430, 330, 252, 156, SUN_HALO)
    ellipse(430, 330, 218, 132, ORANGE)
    ellipse(430, 330, 198, 118, GOLD)
    ellipse(430, 330, 172, 100, YELLOW)
    ellipse(430, 330, 148, 82, PALE)
    ellipse(430, 330, 126, 66, WHITE)


def draw_jaw_and_gold():
    # Bottom jaw, overlapping the sun's flattened base.
    polygon([(268, 445), (622, 445), (585, 548), (305, 548)], MACHINE)
    # Gold seams: under the beam, above the jaw, the strut edge, one dash.
    rect(98, 205, 622, 209, GOLD_LINE)
    rect(272, 441, 618, 445, GOLD_LINE)
    rect(252, 210, 257, 448, GOLD_LINE)
    rect(560, 478, 618, 482, GOLD_DARK)
    # Bolts at the foot of the left post.
    ellipse(182, 545, 9, 9, BOLT)
    ellipse(182, 545, 4, 4, BOLT_DARK)
    ellipse(228, 548, 9, 9, BOLT)
    ellipse(228, 548, 4, 4, BOLT_DARK)


def draw_torrent():
    # S-shaped torrent: out of the press, arcing right and down, then
    # bending back left to crash into the pool. Layered orange / gold /
    # yellow / white-hot core, widening into a flare at the impact.
    centre = (cubic((605, 448), (790, 455), (872, 560), (848, 692), 40)
              + cubic((848, 692), (824, 812), (682, 868), (572, 892), 40)[1:])
    n = len(centre)
    widths = []
    for i in range(n):
        u = i / (n - 1)
        widths.append(45.0 + 20.0 * math.sin(math.pi * u) + 20.0 * u * u)
    polygon(stream_polygon(centre, widths), ORANGE)
    polygon(stream_polygon(centre, [w * 0.74 for w in widths]), GOLD)
    polygon(stream_polygon(centre, [w * 0.50 for w in widths]), YELLOW)
    polygon(stream_polygon(centre, [w * 0.26 for w in widths]), WHITE)
    # Two splash flicks, both overlapping the stream's edge: nothing
    # hangs in mid-air.
    polygon([(838, 758), (872, 792), (842, 800)], ORANGE)
    polygon([(846, 768), (862, 786), (846, 792)], GOLD)
    polygon([(736, 838), (772, 872), (740, 880)], ORANGE)
    polygon([(744, 848), (758, 866), (744, 872)], GOLD)


def draw_pool():
    # Broad foreground splash pool with a white-hot impact zone.
    ellipse(470, 968, 405, 52, SHADOW)
    ellipse(480, 928, 388, 74, ORANGE)
    ellipse(480, 925, 342, 62, GOLD)
    ellipse(480, 922, 272, 48, YELLOW)
    ellipse(565, 908, 128, 28, CREAM)
    # Four-point starburst at the impact point.
    polygon([(565, 870), (557, 902), (565, 934), (573, 902)], WHITE)
    polygon([(529, 902), (565, 894), (601, 902), (565, 910)], WHITE)
    # Crown spikes rising from the pool's rim, bases buried in the pool.
    spikes = [
        ((222, 908), (264, 908), (243, 772), (234, 906), (254, 906), (243, 800)),
        ((317, 906), (351, 906), (335, 798), (326, 904), (344, 904), (335, 822)),
        ((405, 902), (447, 902), (428, 722), (416, 900), (438, 900), (428, 762)),
        ((604, 896), (642, 896), (625, 742), (614, 894), (634, 894), (625, 778)),
        ((688, 894), (718, 894), (705, 796), (696, 892), (712, 892), (705, 822)),
        ((750, 892), (778, 892), (764, 828), (756, 890), (770, 890), (764, 848)),
    ]
    for (bx0, by0), (bx1, by1), (tx, ty), (ix0, iy0), (ix1, iy1), (itx, ity) in spikes:
        polygon([(bx0, by0), (bx1, by1), (tx, ty)], GOLD)
        polygon([(ix0, iy0), (ix1, iy1), (itx, ity)], WHITE)


def build():
    draw_sky_and_stars()
    draw_earth()
    draw_disc()
    draw_press()
    draw_sun()
    draw_jaw_and_gold()
    draw_torrent()
    draw_pool()


# ---------------------------------------------------------------- output
def downsample():
    """Average each 2x2 block of the 2x render down to 1024x1024."""
    out = bytearray(SIZE * SIZE * 3)
    b = buf
    for oy in range(SIZE):
        sy = oy * 2
        row0 = sy * W * 3
        row1 = (sy + 1) * W * 3
        orow = oy * SIZE * 3
        for ox in range(SIZE):
            sx = ox * 2 * 3
            i0 = row0 + sx
            i2 = row1 + sx
            o = orow + ox * 3
            out[o] = (b[i0] + b[i0 + 3] + b[i2] + b[i2 + 3]) // 4
            out[o + 1] = (b[i0 + 1] + b[i0 + 4] + b[i2 + 1] + b[i2 + 4]) // 4
            out[o + 2] = (b[i0 + 2] + b[i0 + 5] + b[i2 + 2] + b[i2 + 5]) // 4
    return out


def write_png(path, data, w, h):
    """Write 8-bit RGB data as a deterministic PNG; return its byte size."""
    raw = bytearray()
    stride = w * 3
    for y in range(h):
        raw.append(0)
        raw += data[y * stride:(y + 1) * stride]
    comp = zlib.compress(bytes(raw), 9)

    def chunk(tag, payload):
        out = struct.pack(">I", len(payload)) + tag + payload
        return out + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", comp)
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return len(png)


def main():
    build()
    data = downsample()
    outdir = os.environ.get("MAKEFUN_OUTPUT_DIR") or "/output"
    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, "entry.png")
    size = write_png(path, data, SIZE, SIZE)
    with open(path, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    print("wrote %s: %d bytes, sha256 %s" % (path, size, digest))


if __name__ == "__main__":
    main()
