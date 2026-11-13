#!/usr/bin/env python3
"""Draw the news-image-01 entry: a one-page newspaper front page summing up
Friday 13 November 2026. Pure Pillow, deterministic: same bytes every run.
Output: entry.png, 1024x1024, under 1 MiB.

Stories verified against multiple news briefs of the day (AP/Reuters via
Open Chronicle, Seven Lights, Bangladesh Chronicle, The Hindu, Zark News):
  lead  - Europe joins the next Ukraine peace round; largest prisoner swap
          in the works (Kushner/Witkoff met Putin in Moscow, Zelenskyy in Dublin)
  gulf  - Iran says it hit a US radar in Bahrain; four tankers struck in Hormuz
  nvidia- Jensen Huang resigns as Nvidia CEO; shares fall 16%
  msft  - Microsoft 365 outage (Outlook/Teams) drags on worldwide
  gaza  - Strike on Nasser Hospital, Khan Younis, kills six incl. a surgeon
  delhi - Delhi overtakes Lahore as the world's most polluted city (AQI 334)
  also - Kansas governor race decided; Brooklyn collapse toll 8; Pope Leo in
         Peru; England reach Nations League quarter-finals; Google's Gemini 4
"""
import textwrap
from PIL import Image, ImageDraw, ImageFont

W = H = 1024
PAPER = (247, 242, 231)
CARD = (255, 253, 247)
INK = (24, 24, 22)
NAVY = (16, 36, 68)
GOLD = (184, 148, 42)
GREY = (92, 90, 84)
RULE = (203, 196, 178)

SERIF = "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"
SERIF_REG = "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf"
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SANS_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


def wrap(draw, text, fnt, width):
    """Greedy word wrap to pixel width; returns list of lines."""
    lines, cur = [], ""
    for word in text.split():
        trial = (cur + " " + word).strip()
        if draw.textlength(trial, font=fnt) <= width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def draw_wrapped(draw, xy, text, fnt, width, fill, leading=None):
    x, y = xy
    leading = leading or int(fnt.size * 1.28)
    for line in wrap(draw, text, fnt, width):
        draw.text((x, y), line, font=fnt, fill=fill)
        y += leading
    return y


# ---------- icons, drawn in a box (x, y, s) with one accent colour ----------
def icon_globe(d, x, y, s, c):
    cx, cy, r = x + s // 2, y + s // 2, s // 2 - 4
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=c, width=5)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(226, 238, 245))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=c, width=5)
    d.ellipse([cx - r // 2, cy - r, cx + r // 2, cy + r], outline=c, width=3)
    d.line([cx - r, cy, cx + r, cy], fill=c, width=3)
    d.arc([cx - r, cy - r // 2, cx + r, cy + r // 2], 0, 180, fill=c, width=3)
    d.arc([cx - r, cy - r // 2, cx + r, cy + r // 2], 180, 360, fill=c, width=3)


def icon_tanker(d, x, y, s, c):
    u = s / 100.0
    # hull
    d.polygon([(x + 8 * u, y + 58 * u), (x + 92 * u, y + 58 * u),
               (x + 82 * u, y + 76 * u), (x + 18 * u, y + 76 * u)], fill=c)
    # deck + containers
    d.rectangle([x + 18 * u, y + 40 * u, x + 66 * u, y + 58 * u], fill=c)
    d.rectangle([x + 70 * u, y + 30 * u, x + 84 * u, y + 58 * u], fill=(120, 60, 40))
    d.line([x + 77 * u, y + 30 * u, x + 77 * u, y + 18 * u], fill=c, width=int(4 * u))
    # waves
    for i, wy in enumerate((84, 92)):
        d.arc([x + 4 * u, y + wy * u, x + 96 * u, y + (wy + 12) * u],
              180, 360, fill=(70, 130, 170), width=4)


def icon_chip(d, x, y, s, c):
    u = s / 100.0
    d.rounded_rectangle([x + 22 * u, y + 22 * u, x + 78 * u, y + 78 * u],
                        radius=8 * u, fill=c)
    d.rectangle([x + 38 * u, y + 38 * u, x + 62 * u, y + 62 * u],
                fill=(255, 255, 255))
    for i in range(3):
        px = x + (32 + i * 18) * u
        d.line([px, y + 8 * u, px, y + 22 * u], fill=c, width=int(5 * u))
        d.line([px, y + 78 * u, px, y + 92 * u], fill=c, width=int(5 * u))
        py = y + (32 + i * 18) * u
        d.line([x + 8 * u, py, x + 22 * u, py], fill=c, width=int(5 * u))
        d.line([x + 78 * u, py, x + 92 * u, py], fill=c, width=int(5 * u))


def icon_cloud(d, x, y, s, c):
    u = s / 100.0
    d.ellipse([x + 14 * u, y + 34 * u, x + 52 * u, y + 66 * u], fill=c)
    d.ellipse([x + 34 * u, y + 20 * u, x + 72 * u, y + 58 * u], fill=c)
    d.ellipse([x + 56 * u, y + 36 * u, x + 88 * u, y + 66 * u], fill=c)
    d.rectangle([x + 16 * u, y + 52 * u, x + 86 * u, y + 68 * u], fill=c)
    # lightning bolt cut through
    d.polygon([(x + 52 * u, y + 62 * u), (x + 40 * u, y + 86 * u),
               (x + 50 * u, y + 86 * u), (x + 44 * u, y + 98 * u),
               (x + 62 * u, y + 70 * u), (x + 52 * u, y + 70 * u)], fill=(232, 178, 32))


def icon_hospital(d, x, y, s, c):
    u = s / 100.0
    d.rounded_rectangle([x + 14 * u, y + 14 * u, x + 86 * u, y + 86 * u],
                        radius=12 * u, fill=c)
    d.rectangle([x + 44 * u, y + 28 * u, x + 56 * u, y + 72 * u], fill=(255, 255, 255))
    d.rectangle([x + 28 * u, y + 44 * u, x + 72 * u, y + 56 * u], fill=(255, 255, 255))


def icon_smog(d, x, y, s, c):
    u = s / 100.0
    d.ellipse([x + 58 * u, y + 12 * u, x + 88 * u, y + 42 * u], fill=(232, 178, 32))
    for bx, bw, bh in ((10, 18, 52), (32, 16, 68), (52, 20, 44), (76, 14, 60)):
        d.rectangle([x + bx * u, y + (88 - bh) * u, x + (bx + bw) * u, y + 88 * u], fill=c)
    for wy in (66, 76, 86):
        d.line([x + 6 * u, y + wy * u, x + 94 * u, y + wy * u], fill=(150, 140, 120), width=3)


def icon_capitol(d, x, y, s, c):
    u = s / 100.0
    d.pieslice([x + 34 * u, y + 8 * u, x + 66 * u, y + 44 * u], 180, 360, fill=c)
    d.rectangle([x + 30 * u, y + 42 * u, x + 70 * u, y + 48 * u], fill=c)
    for i in range(4):
        cx = x + (26 + i * 16) * u
        d.rectangle([cx - 3 * u, y + 50 * u, cx + 3 * u, y + 74 * u], fill=c)
    d.rectangle([x + 14 * u, y + 74 * u, x + 86 * u, y + 80 * u], fill=c)
    d.rectangle([x + 10 * u, y + 80 * u, x + 90 * u, y + 88 * u], fill=c)


# ---------- page ----------
def build():
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    # outer frame
    d.rectangle([10, 10, W - 11, H - 11], outline=INK, width=3)
    d.rectangle([16, 16, W - 17, H - 17], outline=RULE, width=1)

    # masthead
    d.rectangle([16, 16, W - 17, 132], fill=NAVY)
    d.text((40, 34), "THE WORLD", font=font(SERIF, 66), fill=(250, 246, 236))
    d.text((40, 104), "IN ONE PAGE", font=font(SANS_B, 15), fill=GOLD)
    d.text((1024 - 40 - d.textlength("FRIDAY", font=font(SANS_B, 26)), 40),
           "FRIDAY", font=font(SANS_B, 26), fill=(250, 246, 236))
    d.text((1024 - 40 - d.textlength("13 NOVEMBER 2026", font=font(SANS_B, 26)), 70),
           "13 NOVEMBER 2026", font=font(SANS_B, 26), fill=GOLD)
    d.line([40, 126, W - 40, 126], fill=GOLD, width=2)

    # kicker line
    kf = font(SANS_B, 16)
    kick = "ONE DAY  ·  SIX STORIES THAT DEFINED IT  ·  AS REPORTED ON 13 NOVEMBER 2026"
    d.text(((W - d.textlength(kick, font=kf)) / 2, 142), kick, font=kf, fill=GREY)

    # ---- lead story ----
    lx, ly, lw, lh = 28, 168, W - 56, 176
    d.rectangle([lx, ly, lx + lw, ly + lh], fill=CARD, outline=RULE, width=1)
    d.rectangle([lx, ly, lx + 8, ly + lh], fill=GOLD)
    d.text((lx + 26, ly + 12), "LEAD  —  DIPLOMACY", font=font(SANS_B, 15), fill=(146, 32, 24))
    head = "Europe gets a seat at the Ukraine table"
    d.text((lx + 26, ly + 34), head, font=font(SERIF, 40), fill=INK)
    sub = ("Russia agrees to a European role in the next peace round after US envoys "
           "meet Putin in Moscow and Zelenskyy in Dublin — and work begins on the "
           "war's largest prisoner swap.")
    draw_wrapped(d, (lx + 26, ly + 88), sub, font(SANS, 21), 660, INK, leading=28)
    icon_globe(d, lx + lw - 128, ly + 38, 108, NAVY)

    # ---- story grid: 2 columns x 3 rows; icon in its own left column ----
    stories = [
        ("GULF ON EDGE", (146, 32, 24), icon_tanker,
         "Iran says it hit a US radar in Bahrain",
         "Tehran calls it payback for a US hit on its "
         "telecom tower — as four tankers are struck in the Strait of Hormuz."),
        ("TECH SHAKE-UP", (24, 96, 48), icon_chip,
         "Nvidia chief Jensen Huang resigns",
         "Shares fall 16% as the chipmaker's founder steps down; "
         "finance chief Colette Kress takes over as interim CEO."),
        ("OUTAGE", (24, 74, 130), icon_cloud,
         "Microsoft 365 goes down worldwide",
         "Outlook and Teams stay offline for users across the globe; "
         "the company reports only \u201climited recovery\u201d."),
        ("GAZA", (120, 24, 24), icon_hospital,
         "Hospital strike kills six in Khan Younis",
         "An Israeli strike hits Nasser Hospital's surgical building; "
         "the dead include a surgeon, medics say."),
        ("CLIMATE", (96, 74, 32), icon_smog,
         "Delhi becomes the world's most polluted city",
         "Smog pushes the capital past Lahore, with air quality "
         "\u201chazardous\u201d at 334 as 20 million people choke."),
        ("WASHINGTON", (74, 42, 110), icon_capitol,
         "Van Hollen challenges Schumer for Senate leader",
         "The Maryland senator launches a bid to lead Senate Democrats "
         "after the party's midterm wins."),
    ]
    gx, gy = 28, 360
    cw, ch, gap = 476, 184, 16
    for i, (kick_, col, icon, headline, body) in enumerate(stories):
        cx = gx + (i % 2) * (cw + gap)
        cy = gy + (i // 2) * (ch + gap)
        d.rectangle([cx, cy, cx + cw, cy + ch], fill=CARD, outline=RULE, width=1)
        d.rectangle([cx, cy, cx + cw, cy + 6], fill=col)
        tx = cx + 118  # text column starts right of the icon
        tw = cw - 118 - 18
        icon(d, cx + 16, cy + 52, 86, col)
        d.text((tx, cy + 14), kick_, font=font(SANS_B, 14), fill=col)
        y = draw_wrapped(d, (tx, cy + 34), headline, font(SERIF, 26), tw,
                         INK, leading=29)
        draw_wrapped(d, (tx, y + 5), body, font(SANS, 16), tw, (58, 56, 50),
                     leading=20)

    # ---- footer ----
    fx, fy = 28, 936
    d.rectangle([fx, fy, W - 28, 1002], fill=NAVY)
    d.text((fx + 18, fy + 9), "ALSO TODAY", font=font(SANS_B, 15), fill=GOLD)
    also = ("Kansas governor race decided  ·  Brooklyn collapse toll settles at eight  ·  "
            "Pope Leo meets abuse survivors in Peru  ·  England into the Nations League "
            "quarter-finals  ·  Google unveils Gemini 4 \u201cHydrogen\u201d")
    draw_wrapped(d, (fx + 18, fy + 30), also, font(SANS, 14), W - 56 - 36,
                 (235, 231, 220), leading=18)
    return img


if __name__ == "__main__":
    image = build()
    image.save("entry.png", optimize=True)
    print("saved entry.png")
