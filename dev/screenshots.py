#!/usr/bin/env python3
"""Take the extension's screenshots in a headless GNOME Shell of its own.

Each colour scheme gets a fresh GNOME Shell (--headless, one 1920x1440
virtual monitor, tall enough for the details dialog without scrolling,
--unsafe-mode for its Eval and Screenshot D-Bus calls) under its own
dbus-run-session, with every XDG directory under <work>: the desktop session
it runs from is not touched and needs no window, so it can run over ssh. The
extension is installed there from this checkout, and the states come from
the contract's fixtures and dev/simulate.py, never from the machine's own
zark. Each image is the area of what it shows (the menu with its panel
button, the dialog, the banner), so nothing needs cropping.

Dark: the menu idle, running and waiting, the pool and drive tabs, the drive
tab during the run (for dev/ego-image.py) and a drive's notification.
Light: the menu idle and the drive tab.

Needs gnome-shell and libglib2.0-bin (gdbus, gsettings,
glib-compile-schemas). The PNGs carry GNOME Shell's tEXt chunks (Software,
Creation Time): strip them (oxipng --strip all) before committing.

Usage: dev/screenshots.py <out> --work <dir> [--scheme dark|light|both]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

import simulate  # dev/simulate.py, next to this file

UUID = "zark@juanmitaboada.com"
SCHEMA = "org.gnome.shell.extensions.zark"
FIXTURE = "drive-contents"
WIDTH, HEIGHT = 1920, 1440
EXTENSION_FILES = ["extension.js", "prefs.js", "metadata.json", "stylesheet.css", "stylesheet-light.css"]
EXTENSION_DIRS = ["lib", "icons"]
SCHEMES: dict[str, tuple[str, str]] = {
    # color-scheme value, solid background behind the shots
    "dark": ("prefer-dark", "#241f31"),
    "light": ("prefer-light", "#deddda"),
}
INDICATOR = f"Main.panel.statusArea['{UUID}']"
ISO = re.compile(r"\d{4}-\d{2}-\d{2}[T_]\d{2}:\d{2}:\d{2}Z")


# Outside the session: one dbus-run-session per scheme.

def outer(out: Path, work: Path, schemes: list[str]) -> int:
    out.mkdir(parents=True, exist_ok=True)
    for scheme in schemes:
        base = work / scheme
        shutil.rmtree(base, ignore_errors=True)
        dirs = {name: base / name for name in ("config", "data", "cache", "state", "run", "root")}
        for path in dirs.values():
            path.mkdir(parents=True)
        dirs["run"].chmod(0o700)
        drop = ("DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS")
        env = {k: v for k, v in os.environ.items() if k not in drop}
        env.update(
            XDG_CONFIG_HOME=str(dirs["config"]),
            XDG_DATA_HOME=str(dirs["data"]),
            XDG_CACHE_HOME=str(dirs["cache"]),
            XDG_STATE_HOME=str(dirs["state"]),
            XDG_RUNTIME_DIR=str(dirs["run"]),
            # The shell's own words (a notification's age, the clock) in English.
            LANG="C.UTF-8",
            LC_ALL="C.UTF-8",
        )
        cmd = ["dbus-run-session", "--", sys.executable, "-I", str(Path(__file__).resolve()),
               str(out), "--work", str(base), "--scheme", scheme, "--inner"]
        print(f"== {scheme}", flush=True)
        result = subprocess.run(cmd, env=env, check=False)
        if result.returncode != 0:
            print(f"{scheme}: failed ({result.returncode}); log: {base / 'shell.log'}", file=sys.stderr)
            return result.returncode
    return 0


# Inside the session.

def gsettings(schema: str, key: str, value: str, schemadir: Path | None = None) -> None:
    env = dict(os.environ)
    if schemadir is not None:
        env["GSETTINGS_SCHEMA_DIR"] = str(schemadir)
    subprocess.run(["gsettings", "set", schema, key, value], env=env, check=True)


def gdbus(dest: str, path: str, method: str, *args: str) -> str:
    result = subprocess.run(
        ["gdbus", "call", "--session", "--dest", dest, "--object-path", path, "--method", method, *args],
        capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def evaluate(code: str) -> Any:
    """Run JavaScript in the shell; its JSON result, parsed."""
    reply = gdbus("org.gnome.Shell", "/org/gnome/Shell", "org.gnome.Shell.Eval", code)
    ok, _, text = reply.partition(", ")
    text = text.rstrip(")")
    # gdbus prints the string GVariant-quoted: '...' (or "..." when it holds a ').
    text = text[1:-1].encode().decode("unicode_escape")
    if ok != "(true":
        raise RuntimeError(f"Eval failed: {text}")
    return json.loads(text) if text else None


def wait_for(check: Callable[[], bool], what: str, timeout: float = 30) -> None:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            if check():
                return
        except RuntimeError:
            pass
        time.sleep(0.5)
    raise RuntimeError(f"timed out waiting for {what}")


def extents(expr: str) -> list[float]:
    return list(evaluate(
        f"(() => {{ const a = {expr}; const [x, y] = a.get_transformed_position();"
        f" const [w, h] = a.get_transformed_size(); return [x, y, w, h]; }})()"))


def shoot(path: Path, box: list[float], pad: int, top: int = 0) -> None:
    x0 = max(0, int(box[0]) - pad)
    y0 = max(top, int(box[1]) - pad)
    x1 = min(WIDTH, int(box[0] + box[2]) + pad)
    y1 = min(HEIGHT, int(box[1] + box[3]) + pad)
    reply = gdbus("org.gnome.Shell.Screenshot", "/org/gnome/Shell/Screenshot",
                  "org.gnome.Shell.Screenshot.ScreenshotArea",
                  str(x0), str(y0), str(x1 - x0), str(y1 - y0), "false", str(path))
    if not reply.startswith("(true"):
        raise RuntimeError(f"screenshot failed: {reply}")
    print(f"  {path.name}: {x1 - x0}x{y1 - y0}", flush=True)


def union(a: list[float], b: list[float]) -> list[float]:
    x0, y0 = min(a[0], b[0]), min(a[1], b[1])
    x1, y1 = max(a[0] + a[2], b[0] + b[2]), max(a[1] + a[3], b[1] + b[3])
    return [x0, y0, x1 - x0, y1 - y0]


def shoot_menu(path: Path) -> None:
    evaluate(f"{INDICATOR}.menu.open(0)")
    time.sleep(1)
    button = extents(INDICATOR)
    menu = extents(f"{INDICATOR}.menu.actor")
    # From the top of the panel, so the button shows above its menu.
    box = union([button[0], 0, button[2], button[3]], menu)
    shoot(path, box, 16)
    evaluate(f"{INDICATOR}.menu.close(0)")
    time.sleep(0.5)


def shoot_details(path: Path, tab: str) -> None:
    evaluate(f"{INDICATOR}.openDetails('{tab}')")
    wait_for(lambda: bool(evaluate(f"!!{INDICATOR}._dialog")), "the details dialog")
    time.sleep(1)
    shoot(path, extents(f"{INDICATOR}._dialog.dialogLayout"), 32)
    evaluate(f"{INDICATOR}._dialog.close()")
    wait_for(lambda: not evaluate(f"!!{INDICATOR}._dialog"), "the dialog to close")
    time.sleep(0.5)


def freshen(status: dict[str, Any], now: datetime) -> dict[str, Any]:
    """Move the fixture's latest month to now, so its ages read as fresh.

    Every timestamp (and point name) in the month of generated_at moves by
    the same amount, generated_at landing on now; earlier months, which
    reclaim_by_age names by month, stay as they are.
    """
    generated = datetime.strptime(status["generated_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    delta: timedelta = now.replace(microsecond=0) - generated
    month = status["generated_at"][:7]

    def shift(match: re.Match[str]) -> str:
        text = match.group(0)
        if text[:7] != month:
            return text
        sep = text[10]
        moved = datetime.strptime(text.replace("_", "T"), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) + delta
        return moved.strftime(f"%Y-%m-%d{sep}%H:%M:%SZ")

    data: dict[str, Any] = json.loads(ISO.sub(shift, json.dumps(status)))
    return data


class Heartbeat:
    """Keep a simulated run's progress.json fresh while it is on screen."""

    def __init__(self, run: simulate.Run) -> None:
        self.run = run
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._beat, daemon=True)
        self.thread.start()

    def _beat(self) -> None:
        while not self.stop.wait(1):
            self.run.emit()

    def end(self) -> None:
        self.stop.set()
        self.thread.join()
        self.run.progress_path.unlink(missing_ok=True)


def inner(out: Path, base: Path, scheme: str) -> int:
    color_scheme, background = SCHEMES[scheme]
    root = base / "root"

    # The extension, from this checkout.
    ext = Path(os.environ["XDG_DATA_HOME"]) / "gnome-shell" / "extensions" / UUID
    ext.mkdir(parents=True)
    for name in EXTENSION_FILES:
        shutil.copy2(REPO / name, ext / name)
    for name in EXTENSION_DIRS:
        shutil.copytree(REPO / name, ext / name)
    (ext / "schemas").mkdir()
    shutil.copy2(REPO / "schemas" / f"{SCHEMA}.gschema.xml", ext / "schemas")
    subprocess.run(["glib-compile-schemas", str(ext / "schemas")], check=True)

    # The session's settings, in its own dconf.
    gsettings("org.gnome.shell", "enabled-extensions", f"['{UUID}']")
    gsettings("org.gnome.shell", "disable-user-extensions", "false")
    gsettings("org.gnome.shell", "welcome-dialog-last-shown-version", "'999'")
    gsettings("org.gnome.desktop.interface", "color-scheme", f"'{color_scheme}'")
    # Steady frames: no animation caught halfway, no blinking icon.
    gsettings("org.gnome.desktop.interface", "enable-animations", "false")
    for key in ("picture-uri", "picture-uri-dark"):
        gsettings("org.gnome.desktop.background", key, "''")
    gsettings("org.gnome.desktop.background", "picture-options", "'none'")
    gsettings("org.gnome.desktop.background", "color-shading-type", "'solid'")
    gsettings("org.gnome.desktop.background", "primary-color", f"'{background}'")
    # This shell sees the machine's disks: it must not mount them.
    gsettings("org.gnome.desktop.media-handling", "automount", "false")
    gsettings("org.gnome.desktop.media-handling", "automount-open", "false")
    gsettings("org.gnome.desktop.media-handling", "autorun-never", "true")
    schemas = ext / "schemas"
    gsettings(SCHEMA, "status-path", f"'{root / 'var/lib/zark/status.json'}'", schemas)
    gsettings(SCHEMA, "progress-path", f"'{root / 'run/zark/progress.json'}'", schemas)
    gsettings(SCHEMA, "by-id-path", f"'{root / 'dev/disk/by-id'}'", schemas)

    # The state on screen first: the fixture with its latest month moved to now.
    status = freshen(json.loads(simulate.fixture(FIXTURE).read_text(encoding="utf-8")), datetime.now(timezone.utc))
    lib_dir = root / "var" / "lib" / "zark"
    lib_dir.mkdir(parents=True)
    (root / "run" / "zark").mkdir(parents=True)
    (root / "dev" / "disk" / "by-id").mkdir(parents=True)
    simulate.write_atomic(lib_dir / "status.json", status)

    with open(base / "shell.log", "w", encoding="utf-8") as log:
        shell = subprocess.Popen(
            ["gnome-shell", "--headless", "--wayland", "--no-x11",
             "--virtual-monitor", f"{WIDTH}x{HEIGHT}", "--unsafe-mode"],
            stdout=log, stderr=subprocess.STDOUT)
    try:
        wait_for(lambda: evaluate("1") == 1, "GNOME Shell", 60)
        wait_for(lambda: bool(evaluate(f"!!{INDICATOR}")), "the extension's indicator")
        state = evaluate(f"(() => {{ const e = Main.extensionManager.lookup('{UUID}');"
                         f" return [e.state, e.error || '']; }})()")
        print(f"  extension state {state[0]} {state[1]}", flush=True)
        # Only the extension in the panel's right box: the system menu, with
        # the unsafe mode warning and the machine's own icons, is hidden.
        evaluate("Main.overview.hide(); Main.panel.statusArea.quickSettings.hide();"
                 " Main.panel.statusArea.dateMenu.hide()")
        panel = extents("Main.panel")
        time.sleep(3)

        shoot_menu(out / f"{scheme}-menu-idle.png")
        shoot_details(out / f"{scheme}-details-drive.png", "drive:black")
        if scheme == "light":
            return 0
        shoot_details(out / f"{scheme}-details-pool.png", "pool:rpool")

        # A registered drive plugged in: its notification.
        drive_id = next(d["drive_id"] for d in status["drives"] if d["name"] == "blue")
        (root / "dev" / "disk" / "by-id" / drive_id).touch()
        wait_for(lambda: bool(evaluate("!!Main.messageTray._banner")), "the notification", 15)
        time.sleep(1)
        shoot(out / f"{scheme}-notification-drive.png", extents("Main.messageTray._banner"), 24,
              int(panel[1] + panel[3]))
        (root / "dev" / "disk" / "by-id" / drive_id).unlink()

        # A backup running, then waiting for an answer.
        run = simulate.Run(root, 1.0, None, FIXTURE)
        run.status = status
        simulate.write_atomic(run.status_path, status)
        black = status["drives"][0]
        drive = {**run.drive, "space": dict(black["space"], measured_at=simulate.now())}
        beat = Heartbeat(run)
        try:
            total = sum(size for _, _, size in simulate.TRANSFERS) * simulate.GIB
            sent = sum(size for _, _, size in simulate.TRANSFERS[:4]) * simulate.GIB + 4.1 * simulate.GIB
            name, state_, _ = simulate.TRANSFERS[4]
            run.emit(step={"index": 7, "total": 8, "label": "Replicating (this may take a while)..."},
                     drive=drive, point=f"zark_{simulate.now().replace('T', '_')}",
                     transfer=run._transfer(4, 0, name, state_, total, sent, 112 * 1024**2))
            # The drive being written to is plugged in; the extension does not
            # notify that one.
            time.sleep(1)
            (root / "dev" / "disk" / "by-id" / black["drive_id"]).touch()
            time.sleep(3)
            shoot_menu(out / f"{scheme}-menu-running.png")
            # The drive tab during the run, with its Run row: for the EGO image.
            shoot_details(out / f"{scheme}-details-drive-running.png", "drive:black")
            run.emit(step={"index": 5, "total": 8, "label": "Unlocking the keystore"}, point=None,
                     transfer=None, waiting_for_input=True, waiting_for="Keystore passphrase:")
            time.sleep(3)
            shoot_menu(out / f"{scheme}-menu-waiting.png")
        finally:
            beat.end()
        return 0
    finally:
        shell.terminate()
        try:
            shell.wait(15)
        except subprocess.TimeoutExpired:
            shell.kill()
            shell.wait()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("out", type=Path, help="where the PNGs go")
    parser.add_argument("--work", type=Path, required=True, help="the shells' XDG directories and logs")
    parser.add_argument("--scheme", choices=["dark", "light", "both"], default="both")
    parser.add_argument("--inner", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv[1:])
    out = args.out.expanduser().resolve()
    work = args.work.expanduser().resolve()
    if args.inner:
        return inner(out, work, args.scheme)
    schemes = ["dark", "light"] if args.scheme == "both" else [args.scheme]
    return outer(out, work, schemes)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
