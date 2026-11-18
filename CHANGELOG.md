# Changelog

The extension's versions, as `version-name` in `metadata.json`. The
Debian package adds a revision (`1.4-1`), and the PPA one per Ubuntu
series (`1.4-1~ubuntu26.04.1`, `1.4-1~ubuntu26.10.1`).

## 1.4

It reads the status files of zark 2.1.0 and later, as 1.3 did.

- The extension in Spanish, and in Brazilian Portuguese, Portuguese,
  French, Italian, Catalan, Galician, German and Dutch: the menu, the
  details dialog, the notifications, the drive-gone dialog's title and
  first line, and the preferences follow the session's language. Commands
  and zark's own text (its hints, questions and notices) stay in English,
  as zark writes them.
- Ready for translations: the texts the extension shows go through gettext
  in the domain `zark@juanmitaboada.com` (`gettext-domain` in
  `metadata.json`), with named placeholders and plural forms; with no
  catalogue they stay English, as before. Commands, and zark's own text
  (its hints, questions and notices), stay as they are.
- `po/`: the template `zark@juanmitaboada.com.pot`, with comments for the
  translators, `POTFILES`, `LINGUAS`, `RISK-WORDS`, the
  same file as zark's app, and `RISK-REVIEWED`, the score of each template
  text that has a risk stem. `make pot`,
  `pot-check`, `po-check`, `po-risk` and `test-i18n`; CI checks that the
  template is current, misses no text of the sources, holds no command and
  has a score for each risk text, and that each catalogue matches it.
- A catalogue `po/<lang>.po` goes into the zip as `locale/<lang>/` and into
  the Debian package under `/usr/share/locale/`; the package build-depends
  on gettext.

## 1.3

For zark 2.3.1. It still reads the status files of zark 2.1.0 and later.

- A dialog to close with OK when a running backup's drive goes away (zark
  2.3.1's `drive_gone` in `progress.json`): the drive's name, when it went
  away and zark's hint as zark writes it. zark notifies it too, but its
  banner is easy to miss among others. Once per run and drive: OK stores
  the alert's key (`pid:started_at:pool`) in the settings
  (`drive-gone-acknowledged`), so a screen lock or a restart of the shell
  does not repeat it; a dialog closed any other way comes back at the next
  enable. A switch in the preferences, on by default
  (`notify-drive-gone`).
- While the drive is away, the menu's running backup and the drive's tab
  say when it went away.
- The contract's fixtures from zark 2.3.1 (30 cases).

## 1.2

For zark 2.3.0. It still reads the status files of zark 2.1.0 and later.

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
