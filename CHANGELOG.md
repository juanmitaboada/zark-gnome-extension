# Changelog

The extension's versions, as `version-name` in `metadata.json`. The
Debian package adds a revision (`1.1-1`), and the PPA one per Ubuntu
series (`1.1-1~ubuntu26.04.1`, `1.1-1~ubuntu26.10.1`).

## Unreleased

- The details dialog has an About tab, last, also when zark has never
  written a status file: zark's mark, the installed zark's version (the
  package's, from dpkg's database, read without privileges when the tab
  opens; else the status file's writer, for a portable zark), the status
  file's writer when it differs, the extension's and GNOME Shell's
  versions, and Copy buttons for `sudo zark status`, `sudo zark selftest`,
  `sudo zark backup` and `zark monitor` (`./zark` for a portable zark).
- A settings key, `dpkg-status-path`, for tests with an example file.
  The preferences' Development page says what each path is and that it is
  there only for tests and screenshots.
- A change from the dark style to the light one now takes effect at once,
  as the other way did: the dark stylesheet is `stylesheet-dark.css`, no
  longer `stylesheet.css`, since GNOME Shell reloads an extension's
  stylesheet on a change of colour scheme only when its name carries the
  variant. Until now the menu and the dialog kept their dark colours (and
  the About tab its white-sectored mark) until the next login.

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
