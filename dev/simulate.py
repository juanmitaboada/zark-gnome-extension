#!/usr/bin/env python3
"""Play a zark backup into a directory, as zark 2.1 writes its status files.

Writes <root>/run/zark/progress.json and <root>/var/lib/zark/status.json
with zark's atomic procedure (temporary dot file, then rename), using this
process's own pid, start ticks and boot id, so the extension's orphan rules
see a live run. Runs as a normal user; nothing outside <root> is touched.

The run: two questions in the terminal (the drive, the passphrase), the
transfer with byte counters, the result in status.json, the eject prompt,
then progress.json removed. Ctrl+C leaves progress.json behind, as a killed
zark would: the extension then shows the orphan.

Usage: dev/simulate.py <root> [--result completed|incomplete] [--speed N]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

FIXTURE = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "idle" / "var" / "lib" / "zark" / "status.json"

GIB = 1024**3
TRANSFERS = [
    ("rpool/ROOT/ubuntu_jqqq5u", "incremental", 1.2),
    ("rpool/ROOT/ubuntu_jqqq5u/var/lib", "incremental", 3.1),
    ("rpool/ROOT/ubuntu_jqqq5u/var/log", "incremental", 0.6),
    ("rpool/USERDATA/root_bf193q", "incremental", 0.4),
    ("rpool/USERDATA/home_bf193q", "resume", 11.5),
    ("bpool/BOOT/ubuntu_jqqq5u", "via bookmark", 0.2),
]


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_atomic(path: Path, data: dict[str, Any]) -> None:
    """zark's write: a dot-named temporary file renamed into place."""
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def start_ticks() -> int:
    stat = Path(f"/proc/{os.getpid()}/stat").read_text(encoding="ascii")
    return int(stat[stat.rindex(")") + 1 :].split()[19])


class Run:
    def __init__(self, root: Path, speed: float) -> None:
        self.run_dir = root / "run" / "zark"
        self.lib_dir = root / "var" / "lib" / "zark"
        # The contract asks for 0755 whatever the umask.
        for d in (self.run_dir, self.lib_dir):
            d.mkdir(parents=True, exist_ok=True)
            d.chmod(0o755)
        self.progress_path = self.run_dir / "progress.json"
        self.status_path = self.lib_dir / "status.json"
        self.speed = speed

        self.status: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.status["generated_at"] = now()
        self.status["generated_by"] = "timer"
        write_atomic(self.status_path, self.status)

        black = self.status["drives"][0]
        self.drive = {"name": black["name"], "guid": black["guid"], "drive_id": black["drive_id"], "space": None}
        self.progress: dict[str, Any] = {
            "kind": "zark-progress",
            "schema_version": 1,
            "zark_version": "2.1.0",
            "command": "backup",
            "pid": os.getpid(),
            "pid_start_ticks": start_ticks(),
            "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text(encoding="ascii").strip(),
            "started_at": now(),
            "updated_at": now(),
            "waiting_for_input": False,
            "waiting_for": None,
            "step": None,
            "drive": None,
            "point": None,
            "transfer": None,
        }

    def emit(self, **changes: Any) -> None:
        self.progress.update(changes)
        self.progress["updated_at"] = now()
        write_atomic(self.progress_path, self.progress)

    def wait(self, seconds: float) -> None:
        """Sleep, refreshing the heartbeat every second."""
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            time.sleep(min(1.0, end - time.monotonic()))
            self.emit()

    def step(self, index: int, label: str, seconds: float) -> None:
        self.emit(step={"index": index, "total": 8, "label": label})
        self.wait(seconds)

    def ask(self, question: str, seconds: float) -> None:
        self.emit(waiting_for_input=True, waiting_for=question)
        self.wait(seconds)
        self.emit(waiting_for_input=False, waiting_for=None)

    def transfer(self, failures: int) -> None:
        total = sum(size for _, _, size in TRANSFERS) * GIB
        sent = 0.0
        rate = 110 * 1024**2 * self.speed
        done = 0
        for name, state, size in TRANSFERS:
            self.emit(transfer=self._transfer(done, 0, name, state, total, sent, None if sent == 0 else rate))
            left = size * GIB
            while left > 0:
                time.sleep(1)
                chunk = min(left, rate)
                left -= chunk
                sent += chunk
                self.emit(transfer=self._transfer(done, 0, name, state, total, sent, rate))
            done += 1
        self.emit(transfer=self._transfer(done, failures, None, None, total, sent, rate))
        self.wait(1)

    @staticmethod
    def _transfer(done: int, failed: int, name: str | None, state: str | None,
                  total: float, sent: float, rate: float | None) -> dict[str, Any]:
        return {
            "datasets_total": len(TRANSFERS),
            "datasets_done": done,
            "datasets_failed": failed,
            "dataset": name,
            "dataset_state": state,
            "bytes_total": int(total),
            "bytes_total_partial": False,
            "bytes_done": int(sent),
            "rate_bytes_per_s": None if rate is None else int(rate),
        }

    def record(self, result: str) -> None:
        """The result goes into status.json before the eject prompt."""
        black = self.status["drives"][0]
        point = self.progress["point"]
        message = ""
        if result == "completed":
            black["last_backup_at"] = now()
            black["age_days"] = 0
            black["last_backup_point"] = point
        else:
            message = "BACKUP INCOMPLETE: 2 datasets did not reach the point; earlier points are intact"
        black["last_run"] = {
            "command": "backup",
            "result": result,
            "started_at": self.progress["started_at"],
            "ended_at": now(),
            "point": point,
            "datasets_missing": 0 if result == "completed" else 2,
            "message": message,
        }
        if self.progress["drive"]["space"]:
            black["space"] = self.progress["drive"]["space"]
        self.status["generated_at"] = now()
        self.status["generated_by"] = "backup"
        write_atomic(self.status_path, self.status)

    def play(self, result: str) -> None:
        self.emit()
        self.step(1, "Checking the system", 3)
        self.step(2, "Choosing the backup drive", 1)
        self.ask("Back up to black (usb-JMicron_Generic_DISK00)? [y/N]", 6)
        self.emit(drive=dict(self.drive))
        self.step(3, "Importing the backup drive", 2)
        space = self.status["drives"][0]["space"]
        self.emit(drive={**self.drive, "space": dict(space, measured_at=now())})
        self.step(4, "Checking free space", 2)
        self.step(5, "Unlocking the keystore", 1)
        self.ask("Keystore passphrase:", 5)
        self.step(6, "Taking the backup point", 2)
        self.emit(point=f"zark_{now().replace('T', '_')}")
        self.emit(step={"index": 7, "total": 8, "label": "Replicating (this may take a while)..."})
        self.transfer(0 if result == "completed" else 2)
        self.emit(transfer=None)
        self.step(8, "Verifying and exporting the drive", 3)
        self.record(result)
        self.ask("Eject black now? [Y/n]", 5)
        self.progress_path.unlink()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("root", type=Path)
    parser.add_argument("--result", choices=["completed", "incomplete"], default="completed")
    parser.add_argument("--speed", type=float, default=1.0, help="transfer speed multiplier")
    args = parser.parse_args(argv[1:])
    run = Run(args.root.expanduser().resolve(), args.speed)
    print(f"progress: {run.progress_path}\nstatus:   {run.status_path}")
    try:
        run.play(args.result)
    except KeyboardInterrupt:
        print("\nstopped: progress.json left behind, as after a killed run")
        return 130
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
