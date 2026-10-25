#!/usr/bin/env python3
"""Build the panel icons from zark's brand mark.

Reads the ring-and-z mark (docs/images/brand/svg/zark-icon-ringz.svg in the
zark repo) and writes the 12 panel icons into icons/:

- zark-symbolic.svg: every sector and the z in one colour; the shell
  recolours it from the stylesheet (ok, overdue, edge, attention, none).
- zark-progress-0.svg to zark-progress-8.svg: 0 to 8 sectors orange,
  clockwise from the top, the rest white.
- zark-waiting-on.svg and zark-waiting-off.svg: blue ring, the z blue or
  white; the extension alternates them while zark waits for an answer.

Usage: dev/make-icons.py <path to zark-icon-ringz.svg> [<output dir>]
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
ORANGE = "#E8592A"
BLUE = "#62a0ea"

# The mark's ring spans radius 212 around (256, 256); the panel icon fills
# a 16 px box with a 0.5 px margin, so radius 7.5.
TRANSFORM = "translate(8 8) scale(0.035377) translate(-256 -256)"


def subpaths(d: str) -> list[str]:
    """Split a path's data into its closed subpaths, in document order."""
    parts = re.findall(r"M[^M]*", d)
    return [p.strip() for p in parts if p.strip()]


def angle_of(subpath: str) -> float:
    """Clockwise angle from the top of a sector's first point, in degrees."""
    nums = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", subpath)[:2]]
    x, y = nums[0] - 256, nums[1] - 256
    return (math.degrees(math.atan2(x, -y)) + 360) % 360


def read_mark(path: Path) -> tuple[list[str], str, str]:
    """Return the 8 sectors clockwise from the top, the z data and its transform."""
    root = ET.parse(path).getroot()
    sectors: list[str] = []
    z_data = ""
    z_transform = ""
    for el in root.iter(f"{{{SVG_NS}}}path"):
        d = el.get("d", "")
        subs = subpaths(d)
        if el.get("transform"):
            z_data, z_transform = d, el.get("transform", "")
        else:
            sectors.extend(subs)
    if len(sectors) != 8 or not z_data:
        raise SystemExit(f"unexpected mark layout in {path}: {len(sectors)} sectors")
    # Sectors do not overlap, so the angle of any one of their points orders
    # them clockwise from the top.
    sectors.sort(key=angle_of)
    return sectors, z_data, z_transform


def icon(sectors: list[str], colours: list[str], z_data: str, z_transform: str, z_colour: str) -> str:
    """One 16 px icon: each sector in its colour, then the z."""
    lines = [
        f'<svg xmlns="{SVG_NS}" viewBox="0 0 16 16" width="16" height="16">',
        f'  <g transform="{TRANSFORM}">',
    ]
    for d, colour in zip(sectors, colours):
        lines.append(f'    <path fill="{colour}" d="{d}"/>')
    lines.append(f'    <path fill="{z_colour}" transform="{z_transform}" d="{z_data}"/>')
    lines += ["  </g>", "</svg>", ""]
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    if len(argv) not in (2, 3):
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    sectors, z_data, z_transform = read_mark(Path(argv[1]))
    out = Path(argv[2]) if len(argv) == 3 else Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(parents=True, exist_ok=True)

    files: dict[str, str] = {
        "zark-symbolic.svg": icon(sectors, [SYMBOLIC] * 8, z_data, z_transform, SYMBOLIC),
        "zark-waiting-on.svg": icon(sectors, [BLUE] * 8, z_data, z_transform, BLUE),
        "zark-waiting-off.svg": icon(sectors, [BLUE] * 8, z_data, z_transform, WHITE),
    }
    for lit in range(9):
        colours = [ORANGE if i < lit else WHITE for i in range(8)]
        files[f"zark-progress-{lit}.svg"] = icon(sectors, colours, z_data, z_transform, WHITE)

    for name, text in sorted(files.items()):
        (out / name).write_text(text, encoding="ascii")
    print(f"wrote {len(files)} icons to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
