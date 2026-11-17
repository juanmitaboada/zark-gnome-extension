#!/usr/bin/env python3
"""The translation catalogues' checks, for the Makefile's po targets.

  check <po>...          every {placeholder} of a msgid (and msgid_plural) in
                         each of its msgstr[n], and as many msgstr[n] as the
                         header's nplurals; fuzzy entries are skipped, as
                         msgfmt skips them
  commands <pot>         no msgid holds a command: shown commands reach a
                         sentence as a {command} placeholder
  risk <pot> <words>     every msgid with a stem of the words file at a word
                         start, any case, with its source lines; a list for
                         review, it does not fail
  pseudo <pot> <po>      the test catalogue "xx": each text as "[[msgid]]",
                         two plural forms

Usage: dev/po-tools.py <command> <file>...   (run from the repository's root)
"""

from __future__ import annotations

import ast
import re
import sys
from dataclasses import dataclass, field

PLACEHOLDER = re.compile(r"\{(\w+)\}")
# A command as typed: sudo, a portable ./zark, and the system tools zark runs.
# "zark backup" alone is the running program's name in prose ("while zark
# backup was writing to it"), so zark's own subcommands are not listed.
COMMAND = re.compile(r"\bsudo\b|\./zark\b|\bzpool\s|\bzfs\s|\bsystemctl\b|\bapt\s")


@dataclass
class Entry:
    msgctxt: str | None = None
    msgid: str = ""
    msgid_plural: str | None = None
    msgstr: dict[int, str] = field(default_factory=dict)
    references: list[str] = field(default_factory=list)
    flags: set[str] = field(default_factory=set)
    line: int = 0


def parse(path: str) -> list[Entry]:
    """The entries of a .po or .pot file, one per block between blank lines
    (as xgettext and msgfmt write them); the header is the one with msgid ""."""
    entries: list[Entry] = []
    with open(path, encoding="utf-8") as f:
        text = f.read()
    number = 1
    for block in text.split("\n\n"):
        entry = Entry(line=number)
        target: tuple[str, int] | None = None
        for offset, raw in enumerate(block.split("\n")):
            line = raw.strip()
            if not line or line.startswith("#~"):
                continue
            if line.startswith("#:"):
                entry.references += line[2:].split()
            elif line.startswith("#,"):
                entry.flags |= {flag.strip() for flag in line[2:].split(",")}
            elif line.startswith("#"):
                continue
            elif line.startswith('"'):
                if target is None:
                    raise ValueError(f"{path}:{number + offset}: a string with no keyword")
                value_set(entry, target, value_get(entry, target) + ast.literal_eval(line))
            else:
                keyword, _, rest = line.partition(" ")
                if keyword.startswith("msgstr["):
                    target = ("msgstr", int(keyword[7:-1]))
                elif keyword in ("msgctxt", "msgid", "msgid_plural", "msgstr"):
                    target = (keyword, 0)
                else:
                    raise ValueError(f"{path}:{number + offset}: unknown keyword {keyword}")
                value_set(entry, target, ast.literal_eval(rest))
        number += block.count("\n") + 2
        if target is not None:
            entries.append(entry)
    return entries


def value_get(entry: Entry, target: tuple[str, int]) -> str:
    name, index = target
    if name == "msgstr":
        return entry.msgstr.get(index, "")
    return getattr(entry, name) or ""


def value_set(entry: Entry, target: tuple[str, int], value: str) -> None:
    name, index = target
    if name == "msgstr":
        entry.msgstr[index] = value
    else:
        setattr(entry, name, value)


def header(entries: list[Entry]) -> dict[str, str]:
    for e in entries:
        if e.msgid == "" and e.msgctxt is None:
            fields = {}
            for line in e.msgstr.get(0, "").splitlines():
                key, _, value = line.partition(":")
                fields[key.strip()] = value.strip()
            return fields
    return {}


def where(path: str, e: Entry) -> str:
    return f"{path}:{e.line} {e.msgid!r}"


def check(paths: list[str]) -> int:
    bad = 0
    for path in paths:
        entries = parse(path)
        forms = re.search(r"nplurals\s*=\s*(\d+)", header(entries).get("Plural-Forms", ""))
        nplurals = int(forms.group(1)) if forms else None
        for e in entries:
            if not e.msgid or "fuzzy" in e.flags:
                continue
            wanted = set(PLACEHOLDER.findall(e.msgid))
            if e.msgid_plural is not None:
                wanted |= set(PLACEHOLDER.findall(e.msgid_plural))
                if nplurals is None:
                    print(f"{path}: plural entries and no nplurals in Plural-Forms", file=sys.stderr)
                    bad += 1
                elif sorted(e.msgstr) != list(range(nplurals)):
                    print(f"{where(path, e)}: {len(e.msgstr)} plural forms, nplurals={nplurals}", file=sys.stderr)
                    bad += 1
            for index, text in sorted(e.msgstr.items()):
                if not text:
                    continue  # untranslated: shown in English
                have = set(PLACEHOLDER.findall(text))
                missing = wanted - have
                # A plural form may say its count in words ("an hour ago") and leave {n} out.
                if e.msgid_plural is not None:
                    missing.discard("n")
                if missing or have - wanted:
                    print(f"{where(path, e)}: msgstr[{index}] has {sorted(have)}, wants {sorted(wanted)}",
                          file=sys.stderr)
                    bad += 1
        print(f"{path}: {len(entries) - 1} entries checked")
    return 1 if bad else 0


def commands(pot: str) -> int:
    bad = [e for e in parse(pot) if e.msgid and COMMAND.search(e.msgid + (e.msgid_plural or ""))]
    for e in bad:
        print(f"{where(pot, e)}: a command in a translatable text ({' '.join(e.references)})", file=sys.stderr)
    if not bad:
        print(f"{pot}: no command in a translatable text")
    return 1 if bad else 0


def risk(pot: str, words: str) -> int:
    with open(words, encoding="utf-8") as f:
        stems = [w.strip() for w in f if w.strip() and not w.startswith("#")]
    pattern = re.compile(r"\b(" + "|".join(re.escape(s) for s in stems) + r")", re.IGNORECASE)
    hits = 0
    for e in parse(pot):
        text = e.msgid + ("\n" + e.msgid_plural if e.msgid_plural else "")
        found = sorted({m.lower() for m in pattern.findall(text)})
        if e.msgid and found:
            hits += 1
            print(f"{', '.join(found)}: {e.msgid!r}  ({' '.join(e.references)})")
    print(f"{hits} msgids with a risk stem ({len(stems)} stems)")
    return 0


def quote(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\t", "\\t") + '"'


def pseudo(pot: str, out: str) -> int:
    lines = [
        'msgid ""',
        'msgstr ""',
        '"Project-Id-Version: gnome-shell-extension-zark\\n"',
        '"PO-Revision-Date: 2026-01-01 00:00+0000\\n"',
        '"Last-Translator: tests\\n"',
        '"Language-Team: tests\\n"',
        '"MIME-Version: 1.0\\n"',
        '"Content-Type: text/plain; charset=UTF-8\\n"',
        '"Content-Transfer-Encoding: 8bit\\n"',
        '"Language: xx\\n"',
        '"Plural-Forms: nplurals=2; plural=(n != 1);\\n"',
        "",
    ]
    for e in parse(pot):
        if not e.msgid:
            continue
        if e.msgctxt is not None:
            lines.append(f"msgctxt {quote(e.msgctxt)}")
        lines.append(f"msgid {quote(e.msgid)}")
        if e.msgid_plural is None:
            lines.append(f"msgstr {quote('[[' + e.msgid + ']]')}")
        else:
            lines.append(f"msgid_plural {quote(e.msgid_plural)}")
            lines.append(f"msgstr[0] {quote('[[' + e.msgid + ']]')}")
            lines.append(f"msgstr[1] {quote('[[' + e.msgid_plural + ']]')}")
        lines.append("")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return 0


def main(argv: list[str]) -> int:
    commands_ = {"check": (check, None), "commands": (commands, 1), "risk": (risk, 2), "pseudo": (pseudo, 2)}
    if len(argv) < 2 or argv[1] not in commands_:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    fn, count = commands_[argv[1]]
    args = argv[2:]
    if count is not None and len(args) != count:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    return fn(args) if count is None else fn(*args)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
