# Changelog

The extension's versions, as `version-name` in `metadata.json`. The
Debian package adds a revision (`1.1-1`), and the PPA one per Ubuntu
series (`1.1-1~ubuntu26.04.1`, `1.1-1~ubuntu26.10.1`).

## 1.1

For zark 2.2.0. It still reads the status files of zark 2.1.0 and later.

- GNOME Shell 51 (Ubuntu 26.10) as well as 50 (Ubuntu 26.04 LTS):
  `shell-version` is `["50", "51"]`. GNOME Shell 51 changed
  `PopupMenu.close()` to take `{animate}` instead of a `PopupAnimation`;
  the menu still closes without animating before the details dialog
  opens, on both.
- With `/proc` mounted `hidepid`, where root's processes cannot be seen
  (`/proc/1` missing for the reader), a run's missing pid no longer makes
  it orphaned: orphan rule 4 of the status contract is skipped and the
  heartbeat says whether the run is running or stalled. Rules 3 (another
  boot) and 5 (another process with that pid) are unchanged.
- The PPA builds the package for Ubuntu 26.04 (resolute) and 26.10
  (stonking) from the same source.
- The details dialog's donut draws no arc shorter than half a pixel along
  the ring: a stretch of a few MiB in a pool of hundreds of GiB (pool
  metadata, other datasets) was stroked as a grey wedge slanted across the
  ring. Its share still takes its place, and the legend still lists it.

## 1.0

First release, for zark 2.1.0, on GNOME Shell 50 (Ubuntu 26.04 LTS): the
panel indicator and its menu, the details dialog (pools, datasets, backup
drives and their points by month), notifications and preferences, read
from zark's status files.
