#!/usr/bin/env python3
"""Build the panel icons from zark's panel mark.

Reads docs/images/brand/zark-symbolic.svg from the zark repo (16 px, one
path: the ring's 8 sectors and the z) and writes the 20 panel icons into
icons/:

- zark-symbolic.svg: the mark as it is; the shell recolours it from the
  stylesheet (ok, overdue, edge, attention, none).
- zark-progress-0.svg to zark-progress-8.svg: 0 to 8 sectors orange,
  clockwise from the top; the others white at 40 % opacity; the z orange,
  so a running backup shows from its first second.
- zark-progress-0-next.svg to zark-progress-7-next.svg: the same with the
  next sector to fill in opaque white; the extension alternates each
  progress icon with its -next frame while data moves.
- zark-waiting-on.svg and zark-waiting-off.svg: blue ring, the z blue or
  white; the extension alternates them while zark waits for an answer.

Usage: dev/make-icons.py <path to zark-symbolic.svg> [<output dir>]
"""

from __future__ import annotations

import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

SVG_NS = "http://www.w3.org/2000/svg"

SYMBOLIC = "#2e3436"
WHITE = "#ffffff"
UNLIT_OPACITY = "0.4"
ORANGE = "#E8592A"
BLUE = "#62a0ea"

CENTRE = 8.0
# Sectors start on the ring (r >= 5.3); every point of the z lies within r < 5.
SECTOR_MIN_RADIUS = 5.3


def subpaths(d: str) -> list[str]:
    """Split a path's data into its closed subpaths, in document order."""
    return [p.strip() for p in re.findall(r"M[^M]*", d) if p.strip()]


def first_point(subpath: str) -> tuple[float, float]:
    x, y = (float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", subpath)[:2])
    return x, y


def radius(subpath: str) -> float:
    x, y = first_point(subpath)
    return math.hypot(x - CENTRE, y - CENTRE)


def angle(subpath: str) -> float:
    """Clockwise angle from the top, in degrees, of the subpath's first point."""
    x, y = first_point(subpath)
    return (math.degrees(math.atan2(x - CENTRE, CENTRE - y)) + 360) % 360


def read_mark(path: Path) -> tuple[list[str], str]:
    """Return the 8 sectors clockwise from the top and the z's path data."""
    paths = list(ET.parse(path).getroot().iter(f"{{{SVG_NS}}}path"))
    if len(paths) != 1:
        raise SystemExit(f"{path}: expected one path, found {len(paths)}")
    parts = subpaths(paths[0].get("d", ""))
    sectors = sorted((p for p in parts if radius(p) >= SECTOR_MIN_RADIUS), key=angle)
    z = [p for p in parts if radius(p) < SECTOR_MIN_RADIUS]
    if len(sectors) != 8 or not z:
        raise SystemExit(f"{path}: expected 8 sectors and a z, found {len(sectors)} and {len(z)}")
    return sectors, " ".join(z)


def path_element(d: str, fill: str, opacity: str | None = None) -> str:
    extra = f' fill-opacity="{opacity}"' if opacity else ""
    return f'  <path fill="{fill}"{extra} d="{d}"/>'


def icon(elements: list[str]) -> str:
    return "\n".join([
        f'<svg xmlns="{SVG_NS}" viewBox="0 0 16 16" width="16" height="16">',
        *elements,
        "</svg>",
        "",
    ])


def main(argv: list[str]) -> int:
    if len(argv) not in (2, 3):
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    sectors, z = read_mark(Path(argv[1]))
    out = Path(argv[2]) if len(argv) == 3 else Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(parents=True, exist_ok=True)

    files: dict[str, str] = {
        "zark-symbolic.svg": icon([path_element(" ".join(sectors + [z]), SYMBOLIC)]),
        "zark-waiting-on.svg": icon([path_element(" ".join(sectors), BLUE), path_element(z, BLUE)]),
        "zark-waiting-off.svg": icon([path_element(" ".join(sectors), BLUE), path_element(z, WHITE)]),
    }
    for lit in range(9):
        elements = []
        if lit:
            elements.append(path_element(" ".join(sectors[:lit]), ORANGE))
        if lit < 8:
            elements.append(path_element(" ".join(sectors[lit:]), WHITE, UNLIT_OPACITY))
        elements.append(path_element(z, ORANGE))
        files[f"zark-progress-{lit}.svg"] = icon(elements)
    for lit in range(8):
        elements = []
        if lit:
            elements.append(path_element(" ".join(sectors[:lit]), ORANGE))
        elements.append(path_element(sectors[lit], WHITE))
        if lit < 7:
            elements.append(path_element(" ".join(sectors[lit + 1:]), WHITE, UNLIT_OPACITY))
        elements.append(path_element(z, ORANGE))
        files[f"zark-progress-{lit}-next.svg"] = icon(elements)

    for name, text in sorted(files.items()):
        (out / name).write_text(text, encoding="ascii")
    print(f"wrote {len(files)} icons to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
