#!/usr/bin/env python3
"""Generate the Eterna elephant logomark as production SVG.

Geometry is authored as cubic segments, the trunk is swept from a centerline
with a tapering half-width, then everything is uniformly fitted into the
optical safe area so no transform attribute is needed in the output.
"""

from __future__ import annotations

import math
from pathlib import Path

VIEWBOX = 512.0
SAFE = 0.105  # optical safe area fraction per side

ORANGE = "#ff5a36"
INK = "#191614"
CORAL = "#ff8f6b"

OUT = Path("/Users/cansecilmis/Downloads/Code/core/eterna/brand/eterna-elephant")


# ---------------------------------------------------------------- bezier core

def bez(p0, p1, p2, p3, t):
    u = 1.0 - t
    a, b, c, d = u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t
    return (a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
            a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1])


def bez_tangent(p0, p1, p2, p3, t):
    u = 1.0 - t
    a, b, c = 3 * u * u, 6 * u * t, 3 * t * t
    return (a * (p1[0] - p0[0]) + b * (p2[0] - p1[0]) + c * (p3[0] - p2[0]),
            a * (p1[1] - p0[1]) + b * (p2[1] - p1[1]) + c * (p3[1] - p2[1]))


def flatten(segments, per_seg=64):
    pts = []
    for s in segments:
        for i in range(per_seg + 1):
            pts.append(bez(s[0], s[1], s[2], s[3], i / per_seg))
    return pts


# ------------------------------------------------------------ centerline walk

def arclen_table(segments, per_seg=200):
    """Return samples of (point, tangent, cumulative length)."""
    samples = []
    total = 0.0
    prev = None
    for s in segments:
        for i in range(per_seg + 1):
            if i == 0 and prev is not None:
                continue
            t = i / per_seg
            p = bez(s[0], s[1], s[2], s[3], t)
            tg = bez_tangent(s[0], s[1], s[2], s[3], t)
            if prev is not None:
                total += math.hypot(p[0] - prev[0], p[1] - prev[1])
            samples.append((p, tg, total))
            prev = p
    return samples, total


def resample(segments, count):
    samples, total = arclen_table(segments)
    out = []
    for k in range(count):
        target = total * k / (count - 1)
        lo, hi = 0, len(samples) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if samples[mid][2] < target:
                lo = mid + 1
            else:
                hi = mid
        out.append((samples[lo][0], samples[lo][1], target / total))
    return out


def half_width(s, knots):
    for i in range(len(knots) - 1):
        s0, w0 = knots[i]
        s1, w1 = knots[i + 1]
        if s0 <= s <= s1:
            f = 0.0 if s1 == s0 else (s - s0) / (s1 - s0)
            f = f * f * (3 - 2 * f)  # smoothstep so the taper has no kinks
            return w0 + (w1 - w0) * f
    return knots[-1][1]


def offset_at(centerline, width_knots, s, side):
    """Point and unit tangent on the swept edge at arc-length fraction s."""
    samples, total = arclen_table(centerline)
    target = total * s
    best = min(samples, key=lambda smp: abs(smp[2] - target))
    p, tg, _ = best
    length = math.hypot(tg[0], tg[1]) or 1.0
    ux, uy = tg[0] / length, tg[1] / length
    w = half_width(s, width_knots) * side
    return (p[0] + uy * w, p[1] - ux * w), (ux, uy)


def sweep(centerline, width_knots, samples=26, cap_steps=7):
    """Build a closed outline ring: right edge, round tip cap, left edge."""
    pts = resample(centerline, samples)
    right, left = [], []
    for p, tg, s in pts:
        length = math.hypot(tg[0], tg[1]) or 1.0
        nx, ny = tg[1] / length, -tg[0] / length
        w = half_width(s, width_knots)
        right.append((p[0] + nx * w, p[1] + ny * w))
        left.append((p[0] - nx * w, p[1] - ny * w))

    tip, tip_tg, _ = pts[-1]
    tw = half_width(1.0, width_knots)
    start = math.atan2(right[-1][1] - tip[1], right[-1][0] - tip[0])
    end = math.atan2(left[-1][1] - tip[1], left[-1][0] - tip[0])
    cross = tip_tg[0] * (left[-1][1] - tip[1]) - tip_tg[1] * (left[-1][0] - tip[0])
    if cross > 0:
        while end < start:
            end += 2 * math.pi
    else:
        while end > start:
            end -= 2 * math.pi
    cap = [(tip[0] + tw * math.cos(start + (end - start) * i / cap_steps),
            tip[1] + tw * math.sin(start + (end - start) * i / cap_steps))
           for i in range(1, cap_steps)]

    return right + cap + list(reversed(left))


# --------------------------------------------------- closed catmull-rom → path

def ring_to_segments(ring):
    n = len(ring)
    segs = []
    for i in range(n):
        p0 = ring[(i - 1) % n]
        p1 = ring[i]
        p2 = ring[(i + 1) % n]
        p3 = ring[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6.0, p1[1] + (p2[1] - p0[1]) / 6.0)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6.0, p2[1] - (p3[1] - p1[1]) / 6.0)
        segs.append((p1, c1, c2, p2))
    return segs


# ------------------------------------------------------------------ emit utils

def fmt(v):
    return f"{round(v, 2):g}"


def path_data(segments, close=True):
    d = [f"M{fmt(segments[0][0][0])} {fmt(segments[0][0][1])}"]
    for _, c1, c2, p3 in segments:
        d.append(f"C{fmt(c1[0])} {fmt(c1[1])} {fmt(c2[0])} {fmt(c2[1])} {fmt(p3[0])} {fmt(p3[1])}")
    if close:
        d.append("Z")
    return "".join(d)


def circle_segments(cx, cy, r):
    k = r * 0.5523
    return [
        ((cx, cy - r), (cx + k, cy - r), (cx + r, cy - k), (cx + r, cy)),
        ((cx + r, cy), (cx + r, cy + k), (cx + k, cy + r), (cx, cy + r)),
        ((cx, cy + r), (cx - k, cy + r), (cx - r, cy + k), (cx - r, cy)),
        ((cx - r, cy), (cx - r, cy - k), (cx - k, cy - r), (cx, cy - r)),
    ]


def transform(segments, scale, dx, dy):
    return [tuple((p[0] * scale + dx, p[1] * scale + dy) for p in seg) for seg in segments]


# --------------------------------------------------------------- the drawing

S_LEAVE = 0.30

TRUNK_CENTER = [
    ((338, 248), (356, 296), (362, 330), (354, 372)),
    ((354, 372), (346, 416), (382, 442), (416, 428)),
    ((416, 428), (446, 415), (452, 378), (432, 356)),
]

TRUNK_WIDTH = [
    (0.00, 52), (0.20, 44), (0.40, 36), (0.60, 29),
    (0.78, 22), (0.90, 17), (1.00, 13.5),
]

HEAD_POINTS = [
    (280, 368), (210, 382), (136, 346), (106, 254),
    (120, 162), (180, 108), (260, 98), (332, 130), (370, 178),
]

EAR_RING = [
    (224, 62), (148, 80), (74, 142), (56, 250), (90, 344), (150, 404),
    (86, 388), (8, 300), (-2, 176), (52, 80), (144, 30),
]

EYE = (328, 208, 16.5)


def edge_points(centerline, knots, s_from, s_to, n, side):
    pts = []
    for i in range(n + 1):
        s = s_from + (s_to - s_from) * i / n
        pt, _ = offset_at(centerline, knots, s, side)
        pts.append(pt)
    return pts


def cap_points(centerline, knots, steps=8):
    pr, u = offset_at(centerline, knots, 1.0, +1)
    pl, _ = offset_at(centerline, knots, 1.0, -1)
    samples, _total = arclen_table(centerline)
    tip = samples[-1][0]
    r = half_width(1.0, knots)
    a0 = math.atan2(pr[1] - tip[1], pr[0] - tip[0])
    a1 = math.atan2(pl[1] - tip[1], pl[0] - tip[0])
    for candidate in (a1, a1 + 2 * math.pi, a1 - 2 * math.pi):
        mid = (a0 + candidate) / 2
        if math.cos(mid) * u[0] + math.sin(mid) * u[1] > 0:
            a1 = candidate
            break
    return [(tip[0] + r * math.cos(a0 + (a1 - a0) * i / steps),
             tip[1] + r * math.sin(a0 + (a1 - a0) * i / steps))
            for i in range(1, steps)]


def min_gap(segs_a, segs_b):
    pa = flatten(segs_a, 24)
    pb = flatten(segs_b, 24)
    return min(math.hypot(a[0] - b[0], a[1] - b[1]) for a in pa for b in pb)


def build():
    outer = edge_points(TRUNK_CENTER, TRUNK_WIDTH, 0.0, 1.0, 26, +1)
    cap = cap_points(TRUNK_CENTER, TRUNK_WIDTH)
    inner = edge_points(TRUNK_CENTER, TRUNK_WIDTH, 1.0, S_LEAVE, 18, -1)
    body = ring_to_segments(outer + cap + inner + HEAD_POINTS)
    ear = ring_to_segments(EAR_RING)
    eye = circle_segments(*EYE)

    all_pts = flatten(body) + flatten(ear)
    xs = [pt[0] for pt in all_pts]
    ys = [pt[1] for pt in all_pts]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)

    inner_box = VIEWBOX * (1 - 2 * SAFE)
    scale = inner_box / max(maxx - minx, maxy - miny)
    dx = (VIEWBOX - (maxx - minx) * scale) / 2 - minx * scale
    dy = (VIEWBOX - (maxy - miny) * scale) / 2 - miny * scale
    dy -= 6  # optical lift: the trunk hook carries visual weight low

    body_t = transform(body, scale, dx, dy)
    ear_t = transform(ear, scale, dx, dy)
    eye_t = transform(eye, scale, dx, dy)
    print(f"seam gap ear<->body: {min_gap(ear_t, body_t):.1f} px (target >= 20)")

    return {
        "body": path_data(body_t) + path_data(eye_t),
        "ear": path_data(ear_t),
    }


TITLE_DESC = (
    '  <title>{title}</title>\n'
    '  <desc>Minimal elephant mark: one head-and-trunk mass with an upward '
    'curling trunk, an ear plane split off by a clean seam, and a punched '
    'eye.</desc>\n'
)


def write(name, body, title, root_extra=""):
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" '
        f'fill-rule="evenodd"{root_extra}>\n'
        + TITLE_DESC.format(title=title)
        + body
        + "</svg>\n"
    )
    (OUT / name).write_text(svg, encoding="utf-8")
    print("wrote", name)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    p = build()

    two_paths = (
        f'  <path fill="currentColor" d="{p["ear"]}" />\n'
        f'  <path fill="currentColor" d="{p["body"]}" />\n'
    )
    write("eterna-elephant-mark.svg", two_paths, "Eterna elephant mark",
          root_extra=' color="#ff5a36"')
    write("eterna-elephant-mono.svg", two_paths, "Eterna elephant mono mark")

    icon_body = (
        f'  <path fill="{INK}" d="M0 0h512v512H0Z" />\n'
        f'  <path fill="{CORAL}" d="{p["ear"]}" />\n'
        f'  <path fill="{ORANGE}" d="{p["body"]}" />\n'
    )
    write("eterna-elephant-app-icon.svg", icon_body, "Eterna elephant app icon")


if __name__ == "__main__":
    main()
