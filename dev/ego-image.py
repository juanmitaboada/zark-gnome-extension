#!/usr/bin/env python3
"""Compose the extensions.gnome.org image from dev/screenshots.py's shots.

EGO shows one image per extension, within 300 x 200 px on the page and full
size on a click, and scales anything over 1920 px down. This puts the
running menu with its panel button and the pool and drive tabs of the
details dialog, all dark, on one 1800 x 1200 canvas (3:2) of the shots'
background colour. Each dialog is cut out along its rounded edge, without
the shell's dimmed backdrop, which would show as a darker box around it.

Needs Pillow (Debian: python3-pil). The result, like the shots, still has
to be optimised and stripped (oxipng --strip all).

Usage: dev/ego-image.py <shots dir> <out.png>
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

BACKGROUND = (36, 31, 49)  # dev/screenshots.py's dark background
WIDTH, HEIGHT = 1800, 1200
PANEL = 32  # GNOME Shell 50's top bar at scale 1
PAD = 32  # dev/screenshots.py's margin around a dialog
RADIUS = 18  # the dialog's corner, measured on the shots
SUPERSAMPLE = 4


def dialog(path: Path) -> tuple[Image.Image, Image.Image]:
    """A dialog shot cut to its rounded box, and the box's anti-aliased mask."""
    shot = Image.open(path).convert("RGB")
    box = shot.crop((PAD, PAD, shot.width - PAD, shot.height - PAD))
    big = Image.new("L", (box.width * SUPERSAMPLE, box.height * SUPERSAMPLE), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        (0, 0, big.width - 1, big.height - 1), RADIUS * SUPERSAMPLE, fill=255)
    return box, big.resize(box.size, Image.Resampling.LANCZOS)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    shots, out = Path(argv[1]), Path(argv[2])
    menu = Image.open(shots / "dark-menu-running.png").convert("RGB")
    tabs = [dialog(shots / "dark-details-pool.png"), dialog(shots / "dark-details-drive-running.png")]

    canvas = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
    canvas.paste((0, 0, 0), (0, 0, WIDTH, PANEL))
    # The menu where the shell puts it: under its button, at the right edge.
    canvas.paste(menu, (WIDTH - menu.width, 0))
    room = WIDTH - menu.width - sum(box.width for box, _ in tabs)
    gap = room // 4
    x = gap
    for box, mask in tabs:
        canvas.paste(box, (x, PANEL + (HEIGHT - PANEL - box.height) // 2), mask)
        x += box.width + gap
    canvas.save(out)
    print(f"{out}: {canvas.width}x{canvas.height}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
