#!/usr/bin/env python3
"""Generate the Eterna browser-extension icons from the elephant mark.

Toolbar icons sit on a theme-dependent background, so these stay transparent
with a solid brand-orange mark, matching the previous icon set. The 16px
variant drops the eye counterform: below ~24px it is under one pixel and only
muddies the head mass.
"""

from pathlib import Path

import build as be

ASSETS = Path("/Users/cansecilmis/Downloads/Code/core/eterna/packages/browser-ext/assets")

TITLE = "Eterna"
DESC = ("Eterna elephant mark: a broad ear plane split from the head by a "
        "clean seam, and a trunk that sweeps down and curls upward.")


def build(with_eye: bool):
    outer = be.edge_points(be.TRUNK_CENTER, be.TRUNK_WIDTH, 0.0, 1.0, 26, +1)
    cap = be.cap_points(be.TRUNK_CENTER, be.TRUNK_WIDTH)
    inner = be.edge_points(be.TRUNK_CENTER, be.TRUNK_WIDTH, 1.0, be.S_LEAVE, 18, -1)
    body = be.ring_to_segments(outer + cap + inner + be.HEAD_POINTS)
    ear = be.ring_to_segments(be.EAR_RING)

    pts = be.flatten(body) + be.flatten(ear)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    inner_box = be.VIEWBOX * (1 - 2 * be.SAFE)
    scale = inner_box / max(maxx - minx, maxy - miny)
    dx = (be.VIEWBOX - (maxx - minx) * scale) / 2 - minx * scale
    dy = (be.VIEWBOX - (maxy - miny) * scale) / 2 - miny * scale - 6

    body_t = be.transform(body, scale, dx, dy)
    ear_t = be.transform(ear, scale, dx, dy)
    d = be.path_data(body_t)
    if with_eye:
        d += be.path_data(be.transform(be.circle_segments(*be.EYE), scale, dx, dy))
    return be.path_data(ear_t), d


def svg(ear_d: str, body_d: str) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" '
        'fill-rule="evenodd">\n'
        f"  <title>{TITLE}</title>\n"
        f"  <desc>{DESC}</desc>\n"
        f'  <path fill="#ff5a36" d="{ear_d}" />\n'
        f'  <path fill="#ff5a36" d="{body_d}" />\n'
        "</svg>\n"
    )


def main():
    for size in (16, 48, 128):
        ear_d, body_d = build(with_eye=size >= 48)
        target = ASSETS / f"icon{size}.svg"
        target.write_text(svg(ear_d, body_d), encoding="utf-8")
        print(f"wrote {target.name} (eye={'yes' if size >= 48 else 'no'})")


if __name__ == "__main__":
    main()
