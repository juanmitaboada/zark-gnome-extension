#!/usr/bin/env python3
"""Check that make pack's zip holds the extension's files and nothing else.

The list is the committed tree's: the top-level files GNOME Shell loads
(extension.js, prefs.js, metadata.json, the two stylesheets), the schema
XML, lib/*.js and icons/*.svg, with the schemas/, lib/ and icons/
directory entries gnome-extensions pack writes. Any other entry (debian/,
dev/, tests/, docs/, .github/, package.json, package-lock.json,
node_modules, a compiled schema) fails the check, and so does a missing
one.

Usage: dev/check-pack.py <zip>   (run from the repository's root)
"""

from __future__ import annotations

import fnmatch
import subprocess
import sys
import zipfile

TOP = ["extension.js", "prefs.js", "metadata.json", "stylesheet.css", "stylesheet-light.css"]
PATTERNS = ["schemas/*.gschema.xml", "lib/*.js", "icons/*.svg"]
DIRS = ["schemas/", "lib/", "icons/"]


def expected() -> set[str]:
    tracked = subprocess.run(["git", "ls-files", "-z"], capture_output=True, check=True).stdout
    names = [n for n in tracked.decode().split("\0") if n]
    wanted = {n for n in names if n in TOP}
    # fnmatch's * crosses "/"; the directories here have no subdirectories,
    # so a name with a second "/" is left out on purpose.
    wanted |= {n for n in names if n.count("/") == 1 and any(fnmatch.fnmatch(n, p) for p in PATTERNS)}
    return wanted | set(DIRS)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    with zipfile.ZipFile(argv[1]) as z:
        entries = [i.filename for i in z.infolist()]
    want = expected()
    have = set(entries)
    extra = sorted(have - want)
    missing = sorted(want - have)
    duplicated = sorted({n for n in entries if entries.count(n) > 1})
    for name in extra:
        print(f"not part of the extension: {name}", file=sys.stderr)
    for name in missing:
        print(f"missing: {name}", file=sys.stderr)
    for name in duplicated:
        print(f"twice: {name}", file=sys.stderr)
    if extra or missing or duplicated:
        return 1
    print(f"{argv[1]}: {len(entries)} entries, the extension's files only")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
