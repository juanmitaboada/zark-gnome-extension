# zark backup status

A GNOME Shell extension that shows the state of
[zark](https://github.com/juanmitaboada/zark) backups in the top bar: the
last backup to each drive, a running backup's progress, when zark waits for
an answer in its terminal, and how full the system pools are.

It is read-only. It reads the two status files zark 2.1 and later write
(`/run/zark/progress.json` and `/var/lib/zark/status.json`, described in
zark's `docs/STATUS-FILES.md`), and never starts, stops or changes anything.
Backups stay `sudo zark backup` in a terminal.

It notifies what zark itself does not: an overdue backup (once a day), a
registered backup drive plugged in, zark waiting for an answer in its
terminal, and a run that stopped answering. zark already notifies a
backup's start and result and a full pool.

Requires GNOME Shell 50 and zark 2.1 or later.

## Install

- From [extensions.gnome.org](https://extensions.gnome.org), into your user's
  extensions directory.
- From the zark PPA (`ppa:juanmitaboada/zark`), package
  `gnome-shell-extension-zark`, into
  `/usr/share/gnome-shell/extensions/zark@juanmitaboada.com/` for every user.
  Turn it on in the Extensions app.

If both are installed, GNOME Shell loads the copy in your user's directory,
the one from extensions.gnome.org, and ignores the system one.

## Development

| Command | What it does |
|---|---|
| `make test` | runs the tests under gjs |
| `make fixtures ZARK_FIXTURES=<zark>/tests/fixtures/status` | copies the status files contract's fixtures into `tests/fixtures/` |
| `make icons ZARK_BRAND=<zark>/docs/images/brand/zark-symbolic.svg` | rebuilds the panel icons from zark's panel mark |
| `npm install && make lint` | ESLint with GNOME's rules |
| `dev/simulate.py <dir> [--speed N] [--result incomplete] [--answer-after S] [--fixture CASE]` | plays a backup into `<dir>/run/zark` and `<dir>/var/lib/zark`, as zark writes them, from the `idle` fixture or another case (`drive-contents` for a drive's contents); point the extension's paths there in its preferences |
| `dev/simulate.py <dir> --plug NAME`, `--unplug NAME`, `--overdue` | plugs a registered drive in or out under `<dir>/dev/disk/by-id`, or makes the backup overdue, to try the notifications |

`lib/contract.js`, `lib/state.js`, `lib/format.js` and `lib/usage.js` import
nothing from GNOME, so the tests run them without a shell. The fixture tests
check every case of the contract against its `expected.json`.

## License

GPL-2.0-or-later. Copyright Juanmi Taboada
([juanmitaboada.com](https://www.juanmitaboada.com)).
