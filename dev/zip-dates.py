#!/usr/bin/env python3
"""Rewrite a zip so the same commit packs the same bytes on any machine.

gnome-extensions pack takes each file's modification time and the
checkout's permissions, which follow the umask, adds the time it packs at
for the schemas/ directory it makes, and writes lib/ and icons/ in
directory order. This rewrites the zip with:

- the entries sorted by name;
- every entry dated at the epoch given (the commit's, as SOURCE_DATE_EPOCH),
  in UTC, so the machine's time zone does not show;
- files 0644 and directories 0755, whatever the umask was;

and keeps names, contents and compression.

Usage: dev/zip-dates.py <zip> <epoch seconds>
"""

from __future__ import annotations

import os
import stat
import sys
import tempfile
import time
import zipfile
from pathlib import Path

FILE_MODE = stat.S_IFREG | 0o644
DIR_MODE = stat.S_IFDIR | 0o755


def restamp(path: Path, epoch: int) -> int:
    date_time = time.gmtime(epoch)[:6]
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    os.close(fd)
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, "w") as dst:
        entries = sorted(src.infolist(), key=lambda info: info.filename)
        for info in entries:
            data = src.read(info)
            # A fresh ZipInfo carries no extra field, where zip tools keep
            # their own timestamps.
            out = zipfile.ZipInfo(info.filename, date_time=date_time)
            out.compress_type = info.compress_type
            out.create_system = 3  # Unix, so the mode below is read
            mode = DIR_MODE if info.is_dir() else FILE_MODE
            out.external_attr = mode << 16
            if info.is_dir():
                out.external_attr |= 0x10  # the MS-DOS directory bit, as zip writes it
            dst.writestr(out, data)
    os.replace(tmp, path)
    return len(entries)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    count = restamp(Path(argv[1]), int(argv[2]))
    print(f"{argv[1]}: {count} entries dated {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(int(argv[2])))} UTC")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
