#!/usr/bin/env python3
"""Give every entry of a zip one date, so the same commit packs the same zip.

gnome-extensions pack takes each file's modification time, and the time it
packs at for the schemas/ directory it makes. This rewrites the zip with
every entry dated at the epoch given (the commit's, as SOURCE_DATE_EPOCH),
in local time as zip dates are, and leaves names, contents, compression and
permissions as they were.

Usage: dev/zip-dates.py <zip> <epoch seconds>
"""

from __future__ import annotations

import os
import sys
import tempfile
import time
import zipfile
from pathlib import Path


def restamp(path: Path, epoch: int) -> int:
    date_time = time.localtime(epoch)[:6]
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    os.close(fd)
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, "w") as dst:
        for info in src.infolist():
            data = src.read(info)
            # A fresh ZipInfo carries no extra field, where zip tools keep
            # their own timestamps.
            out = zipfile.ZipInfo(info.filename, date_time=date_time)
            out.compress_type = info.compress_type
            out.external_attr = info.external_attr
            out.create_system = info.create_system
            dst.writestr(out, data)
    os.replace(tmp, path)
    return len(src.infolist())


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    count = restamp(Path(argv[1]), int(argv[2]))
    print(f"{argv[1]}: {count} entries dated {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(int(argv[2])))}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
