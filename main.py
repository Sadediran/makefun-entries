#!/usr/bin/env python3
"""Solar Juicer, enhanced - ai-excited-01 attempt 5.

A colossal black citrus press squeezes the sun into a white-hot
S-shaped torrent. Stdlib only; writes a 1024x1024 PNG to
$MAKEFUN_OUTPUT_DIR/entry.png (default ./out/entry.png).
"""
import os
import struct
import zlib

W = 1024
H = 1024


def clamp(v, lo=0, hi=255):
    return lo if v < lo else hi if v > hi else int(v)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return (clamp(lerp(c1[0], c2[0], t)),
            clamp(lerp(c1[1], c2[1], t)),
            clamp(lerp(c1[2], c2[2], t)))


class Canvas:
    def __init__(self, w, h):
        self.w = w
        self.h = h
        self.px = bytearray(w * h * 3)

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 3
            self.px[i] = c[0]
            self.px[i + 1] = c[1]
            self.px[i + 2] = c[2]

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 3
            return (self.px[i], self.px[i + 1], self.px[i + 2])
        return (0, 0, 0)

    def rect(self, x0, y0, x1, y1, c):
        x0 = max(0, x0)
        y0 = max(0, y0)
        x1 = min(self.w, x1)
        y1 = min(self.h, y1)
        for y in range(y0, y1):
            base = (y * self.w + x0) * 3
            for x in range(x0, x1):
                i = base + (x - x0) * 3
                self.px[i] = c[0]
                self.px[i + 1] = c[1]
                self.px[i + 2] = c[2]

    def disc(self, cx, cy, r, c):
        r2 = r * r
        for y in range(max(0, cy - r), min(self.h, cy + r + 1)):
            dy = y - cy
            dx = int((r2 - dy * dy) ** 0.5)
            for x in range(max(0, cx - dx), min(self.w, cx + dx + 1)):
                self.set(x, y, c)

    def ellipse(self, cx, cy, rx, ry, c):
        for y in range(max(0, cy - ry), min(self.h, cy + ry + 1)):
            dy = (y - cy) / float(ry)
            if abs(dy) > 1:
                continue
            dx = int(rx * (1 - dy * dy) ** 0.5)
            for x in range(max(0, cx - dx), min(self.w, cx + dx + 1)):
                self.set(x, y, c)

    def poly(self, pts, c):
        # Scanline polygon fill.
        ys = [p[1] for p in pts]
        y0 = max(0, min(ys))
        y1 = min(self.h - 1, max(ys))
        n = len(pts)
        for y in range(y0, y1 + 1):
            xs = []
            for i in range(n):
                x1, y1p = pts[i]
                x2, y2p = pts[(i + 1) % n]
                if (y1p <= y < y2p) or (y2p <= y < y1p):
                    t = (y - y1p) / float(y2p - y1p)
                    xs.append(x1 + t * (x2 - x1))
            xs.sort()
            for k in range(0, len(xs) - 1, 2):
                for x in range(max(0, int(xs[k])), min(self.w, int(xs[k + 1]) + 1)):
                    self.set(x, y, c)

    def thick_line(self, x0, y0, x1, y1, width, c):
        import math
        dist = math.hypot(x1 - x0, y1 - y0)
        steps = max(1, int(dist))
        r = max(1, width // 2)
        for s in range(steps + 1):
            t = s / float(steps)
            cx = int(x0 + (x1 - x0) * t)
            cy = int(y0 + (y1 - y0) * t)
            self.disc(cx, cy, r, c)

    def polyline(self, pts, width, c):
        for a, b in zip(pts, pts[1:]):
            self.thick_line(a[0], a[1], b[0], b[1], width, c)


def sky(cv):
    top = (26, 12, 54)
    mid = (94, 32, 84)
    low = (255, 138, 52)
    for y in range(H):
        t = y / float(H)
        if t < 0.55:
            c = mix(top, mid, t / 0.55)
        else:
            c = mix(mid, low, (t - 0.55) / 0.45)
        for x in range(W):
            cv.set(x, y, c)
    # Warm glow behind the sun.
    for y in range(60, 520):
        for x in range(240, 880):
            d = ((x - 560) ** 2 + (y - 270) ** 2) ** 0.5
            if d < 330:
                t = 1 - d / 330.0
                base = cv.get(x, y)
                glow = (255, 190, 90)
                cv.set(x, y, mix(base, glow, t * 0.45))


def sun(cv):
    # The sun itself: blazing disc, partly flattened where pressed.
    cv.disc(560, 285, 168, (255, 122, 26))      # orange rim
    cv.disc(560, 285, 150, (255, 196, 64))      # golden body
    cv.disc(560, 285, 118, (255, 238, 150))     # bright core
    cv.disc(560, 285, 84, (255, 252, 220))      # white-hot heart
    # Rays: short bold wedges, not thin lines.
    for ang in range(0, 360, 30):
        import math
        a = math.radians(ang)
        x0 = int(560 + 178 * math.cos(a))
        y0 = int(285 + 178 * math.sin(a))
        x1 = int(560 + 218 * math.cos(a))
        y1 = int(285 + 218 * math.sin(a))
        cv.thick_line(x0, y0, x1, y1, 14, (255, 200, 80))


def press(cv):
    black = (12, 10, 18)
    dark = (30, 26, 40)
    # Top beam.
    cv.rect(170, 108, 890, 168, black)
    cv.rect(170, 108, 890, 122, dark)
    # Screw stem from beam down to the press head.
    cv.rect(536, 168, 584, 250, black)
    for y in range(172, 248, 12):
        cv.rect(536, y, 584, y + 5, dark)
    # Handle lever, diagonal, with a grip knob.
    cv.thick_line(560, 150, 830, 84, 22, black)
    cv.disc(838, 82, 18, dark)
    cv.thick_line(560, 150, 300, 96, 16, black)
    cv.disc(292, 94, 14, dark)
    # Press head: a wide cone / dome pressing the top of the sun.
    cv.poly([(400, 250), (720, 250), (640, 330), (480, 330)], black)
    cv.ellipse(560, 258, 160, 34, black)
    # Bowl under the sun: the juice collector, wide black cup.
    cv.poly([(330, 420), (790, 420), (730, 520), (390, 520)], black)
    cv.ellipse(560, 420, 232, 34, dark)
    cv.ellipse(560, 420, 200, 24, (8, 7, 12))
    # Spout at the centre of the bowl.
    cv.rect(544, 510, 576, 556, black)
    # Legs down to the rooftop (kept wide apart, clear of the torrent).
    cv.rect(352, 516, 392, 780, black)
    cv.rect(728, 516, 768, 780, black)
    cv.rect(336, 772, 408, 790, black)
    cv.rect(712, 772, 784, 790, black)


def smooth_pts(pts, samples=14):
    # Catmull-Rom sampling so the torrent curves smoothly (no zigzag).
    out = [pts[0]]
    ext = [pts[0]] + list(pts) + [pts[-1]]
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
        for s in range(1, samples + 1):
            t = s / float(samples)
            t2 = t * t
            t3 = t2 * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t
                       + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                       + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t
                       + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                       + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append((int(x), int(y)))
    return out


def torrent(cv):
    # S-shaped white-hot torrent from the spout to the pool.
    # A sine curve down the fall: one smooth S, no kinks or zigzag.
    import math
    pts = []
    for y in range(540, 813, 4):
        t = (y - 540) / 272.0
        x = 566 + 34 * math.sin(2 * math.pi * 0.62 * t)
        pts.append((int(x), y))
    for (w, c) in ((74, (255, 150, 40)),
                   (54, (255, 214, 92)),
                   (30, (255, 246, 190))):
        for a, b in zip(pts, pts[1:]):
            cv.thick_line(a[0], a[1], b[0], b[1], w, c)
    # Sparse spray: short motion streaks starting at the flow's edge
    # and falling away from it (never crossing the flow, never frozen).
    cv.thick_line(598, 640, 622, 668, 4, (255, 220, 120))
    cv.thick_line(534, 700, 512, 728, 4, (255, 210, 100))
    cv.thick_line(592, 772, 614, 796, 4, (255, 220, 120))
    # Landing pool: compact bright splash, subordinate to the torrent.
    cv.ellipse(566, 838, 88, 22, (255, 170, 60))
    cv.ellipse(566, 835, 66, 16, (255, 222, 110))
    cv.ellipse(566, 832, 42, 10, (255, 250, 210))


def rooftop(cv):
    # Parapet: low wall along the bottom edge (foreground, muted).
    cv.rect(0, 972, W, H, (40, 34, 52))
    cv.rect(0, 972, W, 982, (64, 56, 78))
    # Clothesline on the left: two poles, a sagging line, laundry.
    cv.rect(52, 800, 58, 972, (46, 40, 58))
    cv.rect(326, 800, 332, 972, (46, 40, 58))
    cv.polyline([(55, 812), (190, 828), (329, 812)], 4, (150, 142, 150))
    # Shirt: body rectangle plus two short sleeves, dusty muted blue-grey.
    cv.rect(104, 828, 150, 892, (118, 128, 150))
    cv.rect(90, 830, 104, 856, (118, 128, 150))
    cv.rect(150, 830, 164, 856, (118, 128, 150))
    # Towel: plain hanging rectangle, muted warm cream.
    cv.rect(228, 828, 272, 876, (198, 178, 148))
    cv.rect(228, 828, 272, 836, (176, 156, 128))
    # Small cloth on the right end of the line.
    cv.rect(292, 826, 318, 862, (140, 132, 150))


def figure(cv, cx, feet_y, h, lean, arm_pose, rim_side=1):
    """One broad silhouette. lean: px the head/shoulders shift back.
    arm_pose: 'shield' (one hand to eyes, one arm flung up),
    'both-up' (both arms thrown up), 'crouch' (arms over head).
    rim_side: +1 if the torrent/sun is to the figure's right (warm
    rim light on the right edge), -1 if to the left."""
    sil = (16, 13, 24)
    rim = (255, 196, 110)
    head_r = max(5, int(h * 0.12))
    head_cx = cx + lean
    head_cy = feet_y - h + head_r
    shoulder_y = feet_y - h + head_r * 2 + 4
    shoulder_x = cx + lean
    hip_y = feet_y - int(h * 0.42)
    hip_x = cx + lean // 2
    # Legs: wide apart, one stepping back.
    cv.thick_line(hip_x, hip_y, cx - 8, feet_y, max(6, h // 8), sil)
    cv.thick_line(hip_x, hip_y, cx + 10, feet_y, max(6, h // 8), sil)
    # Torso: broad, leaning back.
    cv.thick_line(shoulder_x, shoulder_y, hip_x, hip_y, max(9, h // 5), sil)
    # Head.
    cv.disc(head_cx, head_cy, head_r, sil)
    # Warm rim light on the torrent-facing edge so the silhouette
    # reads against the dark rooftop.
    cv.thick_line(shoulder_x + rim_side * 6, shoulder_y,
                  hip_x + rim_side * 6, hip_y, 3, rim)
    cv.disc(head_cx + rim_side * (head_r - 1), head_cy, 3, rim)
    # Arms.
    if arm_pose == "shield":
        # Right arm bent up, hand shielding the eyes.
        cv.thick_line(shoulder_x, shoulder_y, shoulder_x + 12, shoulder_y - 12,
                      5, sil)
        cv.thick_line(shoulder_x + 12, shoulder_y - 12, head_cx + 8,
                      head_cy - 2, 5, sil)
        # Left arm flung up and back.
        cv.thick_line(shoulder_x, shoulder_y, shoulder_x - 18,
                      shoulder_y - 22, 5, sil)
    elif arm_pose == "both-up":
        cv.thick_line(shoulder_x, shoulder_y, shoulder_x - 16,
                      shoulder_y - 24, 5, sil)
        cv.thick_line(shoulder_x, shoulder_y, shoulder_x + 14,
                      shoulder_y - 26, 5, sil)
    else:  # crouch: both forearms over the head
        cv.thick_line(shoulder_x, shoulder_y, shoulder_x - 10,
                      head_cy - 4, 5, sil)
        cv.thick_line(shoulder_x, shoulder_y, shoulder_x + 10,
                      head_cy - 4, 5, sil)


def humans(cv):
    # Principal: ~64 px tall (6% of height), backing away from the
    # washing, shielding eyes. Torrent is to the right: rim on +1.
    figure(cv, 205, 968, 64, -11, "shield", rim_side=1)
    # Second: fleeing on the right, both arms thrown up. Torrent is
    # to the left: rim on -1.
    figure(cv, 845, 968, 52, -9, "both-up", rim_side=-1)
    # Third: small figure at the far left, crouching under the glare.
    figure(cv, 108, 968, 44, -6, "crouch", rim_side=1)


def ground(cv):
    # Rooftop slab: mid-dark and muted so black silhouettes read on it.
    cv.rect(0, 780, W, H, (52, 46, 66))
    cv.rect(0, 780, W, 792, (84, 74, 98))
    # Faint rooftop seams, subordinate and low contrast.
    for x in (256, 512, 768):
        cv.rect(x, 800, x + 2, 972, (44, 38, 56))


def write_png(cv, path):
    raw = bytearray()
    for y in range(H):
        raw.append(0)
        raw.extend(cv.px[y * W * 3:(y + 1) * W * 3])
    comp = zlib.compress(bytes(raw), 6)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", comp)
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    outdir = os.environ.get("MAKEFUN_OUTPUT_DIR", "out")
    os.makedirs(outdir, exist_ok=True)
    cv = Canvas(W, H)
    sky(cv)
    sun(cv)
    press(cv)
    ground(cv)
    rooftop(cv)
    humans(cv)
    torrent(cv)
    write_png(cv, os.path.join(outdir, "entry.png"))


if __name__ == "__main__":
    main()
