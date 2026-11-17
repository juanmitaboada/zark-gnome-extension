#!/usr/bin/env python3
"""The translation catalogues' checks, for the Makefile's po targets.

  check <pot> <po>...        each catalogue against the template: the same
                             msgids (and contexts), every {placeholder} of a
                             msgid and msgid_plural in each msgstr[n] (a
                             language with plural=(n != 1) may leave {n} out
                             of msgstr[0], the form for one only), as many
                             msgstr[n] as nplurals, the msgid's leading and
                             trailing white space, and no "&" or "<" the
                             msgid does not have; fuzzy entries are skipped,
                             as msgfmt skips them
  linguas <dir>              <dir>/LINGUAS names exactly the <dir>/*.po
  commands <pot>             no msgid holds a command: shown commands reach
                             a sentence as a {command} placeholder
  literals <pot> <all.pot>   no literal of the sources (xgettext --extract-all)
                             that reads as an English text is left out of
                             the template, but those of ALLOWED
  risk <pot> <words> <rev>   every msgid with a word that starts with a stem
                             of <words>, with its score in <rev> or
                             UNREVIEWED; a list, it does not fail
  reviewed <pot> <words> <rev>
                             fails when a hit is not in <rev>, when <rev>
                             names a msgid that is no hit, or on a score
                             other than label, caption or 1
  pseudo <pot> <po>          the test catalogue "xx": each text as
                             "[[msgid]]", two plural forms

Every .po and .pot is read through msgcat, so the layout of a hand-written
file cannot hide an entry. Usage: dev/po-tools.py <command> <file>...
(run from the repository's root)
"""

from __future__ import annotations

import ast
import glob
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field

PLACEHOLDER = re.compile(r"\{(\w+)\}")
# A command as typed: sudo, a portable ./zark, and the system tools zark runs.
# "zark backup" alone is the running program's name in prose ("while zark
# backup was writing to it"), so zark's own subcommands are not listed.
COMMAND = re.compile(r"\bsudo\b|\./zark\b|\bzpool\s|\bzfs\s|\bsystemctl\b|\bapt\s")
# A literal that reads as an English text: a capital letter first, a space in it.
TEXT = re.compile(r"^[A-Z][^\n]* [^\n]*$")
# Literals that stay English on purpose (plan section 3, D3): the About tab's
# descriptions of zark's commands, which are zark's own help lines, and a
# product name.
ALLOWED = {
    "Source pools' fill level and each drive's backup age",
    "Check that this platform behaves as zark relies on",
    "Run incremental backup to connected drive",
    "Live view of a running command and the backups' state (no root)",
    "GNOME Shell",
}
SCORES = {"label", "caption", "1"}
ONE_FORM_RULE = "plural=(n!=1);"


@dataclass
class Entry:
    msgctxt: str | None = None
    msgid: str = ""
    msgid_plural: str | None = None
    msgstr: dict[int, str] = field(default_factory=dict)
    references: list[str] = field(default_factory=list)
    flags: set[str] = field(default_factory=set)
    line: int = 0

    @property
    def key(self) -> tuple[str | None, str]:
        return (self.msgctxt, self.msgid)


def parse(path: str) -> list[Entry]:
    """The entries of a .po or .pot file, as msgcat writes them (one block per
    entry between blank lines); the header is the one with msgid ""."""
    text = subprocess.run(
        ["msgcat", "--no-wrap", "--force-po", path], capture_output=True, text=True, check=True
    ).stdout
    entries: list[Entry] = []
    number = 1
    for block in text.split("\n\n"):
        entry = Entry(line=number)
        target: tuple[str, int] | None = None
        for raw in block.split("\n"):
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
                    raise ValueError(f"{path}: a string with no keyword: {line}")
                value_set(entry, target, value_get(entry, target) + ast.literal_eval(line))
            else:
                keyword, _, rest = line.partition(" ")
                if keyword.startswith("msgstr["):
                    target = ("msgstr", int(keyword[7:-1]))
                elif keyword in ("msgctxt", "msgid", "msgid_plural", "msgstr"):
                    target = (keyword, 0)
                else:
                    raise ValueError(f"{path}: unknown keyword {keyword}")
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


def messages(entries: list[Entry]) -> list[Entry]:
    """The entries without the header."""
    return [e for e in entries if e.msgid or e.msgctxt is not None]


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
    context = f"[{e.msgctxt}] " if e.msgctxt is not None else ""
    return f"{path} {context}{e.msgid!r}"


def edges(text: str) -> tuple[str, str]:
    """The leading and trailing white space of a text."""
    return text[: len(text) - len(text.lstrip())], text[len(text.rstrip()):]


def check_entry(path: str, e: Entry, nplurals: int | None, one_form: bool) -> list[str]:
    errors = []
    wanted = set(PLACEHOLDER.findall(e.msgid))
    if e.msgid_plural is not None:
        wanted |= set(PLACEHOLDER.findall(e.msgid_plural))
        if nplurals is None:
            errors.append(f"{where(path, e)}: a plural entry and no nplurals in Plural-Forms")
        elif sorted(e.msgstr) != list(range(nplurals)):
            errors.append(f"{where(path, e)}: {len(e.msgstr)} plural forms, nplurals={nplurals}")
    english = e.msgid + (e.msgid_plural or "")
    for index, text in sorted(e.msgstr.items()):
        if not text:
            continue  # untranslated: shown in English
        have = set(PLACEHOLDER.findall(text))
        missing = wanted - have
        # The form for one only may say its count in words ("an hour ago").
        if e.msgid_plural is not None and index == 0 and one_form:
            missing.discard("n")
        if missing or have - wanted:
            errors.append(f"{where(path, e)}: msgstr[{index}] has {sorted(have)}, wants {sorted(wanted)}")
        if edges(text) != edges(e.msgid):
            errors.append(f"{where(path, e)}: msgstr[{index}] begins or ends with other white space")
        for char in "&<":
            if char in text and char not in english:
                errors.append(f"{where(path, e)}: msgstr[{index}] has {char!r}, which the preferences would read")
    return errors


def check(pot: str, paths: list[str]) -> int:
    template = {e.key for e in messages(parse(pot))}
    bad = 0
    for path in paths:
        entries = parse(path)
        rule = header(entries).get("Plural-Forms", "")
        forms = re.search(r"nplurals\s*=\s*(\d+)", rule)
        nplurals = int(forms.group(1)) if forms else None
        one_form = ONE_FORM_RULE in rule.replace(" ", "")
        found = messages(entries)
        errors = []
        keys = {e.key for e in found}
        errors += [f"{path}: not in the template: {k[1]!r}" for k in sorted(keys - template, key=str)]
        errors += [f"{path}: missing, from the template: {k[1]!r}" for k in sorted(template - keys, key=str)]
        for e in found:
            if "fuzzy" not in e.flags:
                errors += check_entry(path, e, nplurals, one_form)
        for error in errors:
            print(error, file=sys.stderr)
        bad += len(errors)
        stats = subprocess.run(["msgfmt", "--statistics", "-o", os.devnull, path], capture_output=True, text=True)
        print(f"{path}: {len(found)} entries checked; {stats.stderr.strip()}")
    return 1 if bad else 0


def linguas(directory: str) -> int:
    with open(os.path.join(directory, "LINGUAS"), encoding="utf-8") as f:
        named = sorted(w for line in f for w in line.split("#", 1)[0].split())
    present = sorted(os.path.basename(p)[:-3] for p in glob.glob(os.path.join(directory, "*.po")))
    if named != present:
        print(f"{directory}/LINGUAS names {named}, {directory}/*.po are {present}", file=sys.stderr)
        return 1
    print(f"{directory}/LINGUAS: {len(named)} languages, one catalogue each")
    return 0


def commands(pot: str) -> int:
    bad = [e for e in messages(parse(pot)) if COMMAND.search(e.msgid + (e.msgid_plural or ""))]
    for e in bad:
        print(f"{where(pot, e)}: a command in a translatable text ({' '.join(e.references)})", file=sys.stderr)
    if not bad:
        print(f"{pot}: no command in a translatable text")
    return 1 if bad else 0


def literals(pot: str, all_pot: str) -> int:
    marked = {e.msgid for e in messages(parse(pot))} | {e.msgid_plural for e in messages(parse(pot))}
    bad = [
        e for e in messages(parse(all_pot))
        if TEXT.match(e.msgid) and e.msgid not in marked and e.msgid not in ALLOWED
    ]
    for e in bad:
        print(f"{e.msgid!r} ({' '.join(e.references)}): a text not marked for translation", file=sys.stderr)
    if not bad:
        print(f"{all_pot}: every text of the sources is marked, or allowed to stay English")
    return 1 if bad else 0


def stems(words: str) -> list[str]:
    """The stems of the words file, one per line, "#" starting a comment."""
    out = []
    with open(words, encoding="utf-8") as f:
        for line in f:
            stem = line.split("#", 1)[0].strip()
            if stem:
                out.append(stem.lower())
    return out


def risk_hits(pot: str, words: str) -> list[tuple[Entry, list[str]]]:
    """The entries with a word that starts with a stem, as the app matches."""
    out = []
    for e in messages(parse(pot)):
        text = e.msgid + "\n" + (e.msgid_plural or "")
        hit = [s for s in stems(words) if re.search(r"(?<![A-Za-z])" + re.escape(s), text, re.IGNORECASE)]
        if hit:
            out.append((e, hit))
    return out


def scores(reviewed_path: str) -> dict[str, str]:
    """The reviewed file: <score> "<msgid>" per line, "#" lines and blank ones aside."""
    out = {}
    with open(reviewed_path, encoding="utf-8") as f:
        for line in f:
            if not line.strip() or line.startswith("#"):
                continue
            score, _, text = line.rstrip("\n").partition(" ")
            out[ast.literal_eval(text.strip())] = score
    return out


def quote(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\t", "\\t") + '"'


def risk(pot: str, words: str, reviewed_path: str) -> int:
    done = scores(reviewed_path)
    hits = risk_hits(pot, words)
    for e, hit in hits:
        print(f"{done.get(e.msgid, 'UNREVIEWED'):10} {quote(e.msgid)}")
        print(f"{'':10} {', '.join(hit)} - {' '.join(e.references)}")
    print(f"{len(hits)} msgids match {words}")
    return 0


def reviewed(pot: str, words: str, reviewed_path: str) -> int:
    hits = {e.msgid for e, _ in risk_hits(pot, words)}
    done = scores(reviewed_path)
    errors = [f"not reviewed, add it to {reviewed_path}: {quote(m)}" for m in sorted(hits - set(done))]
    errors += [f"in {reviewed_path} but no longer a hit of the template: {quote(m)}" for m in sorted(set(done) - hits)]
    errors += [f"{reviewed_path}: score {s!r} for {quote(m)}, not one of {sorted(SCORES)}"
               for m, s in sorted(done.items()) if s not in SCORES]
    for error in errors:
        print(error, file=sys.stderr)
    if not errors:
        print(f"{reviewed_path}: the {len(hits)} risk hits of the template are reviewed")
    return 1 if errors else 0


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
    for e in messages(parse(pot)):
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
    usage = "Usage: dev/po-tools.py <command> <file>...   (see the docstring)"
    table = {
        "check": (lambda a: check(a[0], a[1:]), 1),
        "linguas": (lambda a: linguas(*a), 1),
        "commands": (lambda a: commands(*a), 1),
        "literals": (lambda a: literals(*a), 2),
        "risk": (lambda a: risk(*a), 3),
        "reviewed": (lambda a: reviewed(*a), 3),
        "pseudo": (lambda a: pseudo(*a), 2),
    }
    if len(argv) < 2 or argv[1] not in table:
        print(usage, file=sys.stderr)
        return 2
    fn, count = table[argv[1]]
    args = argv[2:]
    if len(args) < count or (argv[1] != "check" and len(args) != count):
        print(usage, file=sys.stderr)
        return 2
    return fn(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
