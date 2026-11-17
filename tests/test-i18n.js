// SPDX-License-Identifier: GPL-2.0-or-later
//
// The translations' plumbing (lib/i18n.js) under plain gjs. A fake translator
// wraps every translated text as "[[...]]", so a text the view shows without
// passing through _() stands out, and so do a placeholder left unfilled and a
// command or a text of zark's that went through _() by mistake.
//
// make test-i18n runs the TRANSLATED tests again with real gettext and a
// pseudo catalogue built from the template, which wraps texts the same way
// (tests/i18n-run.js).

import GLib from 'gi://GLib';

import {aboutView} from '../lib/about.js';
import {Event, WAITING_NOTIFY_MS, driveGoneAlert, newEvents, snapshot} from '../lib/events.js';
import {formatAge, formatDate, formatDuration, formatPercent, formatWhen} from '../lib/format.js';
import {N_, _, fmt, ngettext, pgettext, setTranslator} from '../lib/i18n.js';
import {BACKUP_COMMAND, buildView, stoppedAnswering} from '../lib/view.js';
import {assertEqual, assertTrue} from './harness.js';
import {fixtureInput} from './test-view.js';

const ROOT = GLib.build_filenamev([GLib.path_get_dirname(import.meta.url.replace('file://', '')), 'fixtures']);

const FAKE = {
    gettext: text => `[[${text}]]`,
    ngettext: (singular, plural, n) => `[[${n === 1 ? singular : plural}]]`,
    pgettext: (context, text) => `[[${text}]]`,
};

let source = FAKE;

/**
 * The translator the TRANSLATED tests use: the fake one by default.
 *
 * @param {{gettext: Function, ngettext: Function, pgettext: Function}} translator
 */
export function useTranslator(translator) {
    source = translator;
}

// Keys whose values are not shown as text, or are zark's data shown as it is.
const NOT_TEXT = new Set([
    'indicator', 'kind', 'tab', 'level', 'id', 'style', 'month', 'prefix', 'name', 'dataset', 'waitingFor',
    'version', 'generatedAt', 'generatedBy',
]);

// Sizes, rates and the empty-cell dash: formatBytes() and formatRate(), not words.
const FIGURE = /^(-|\d+(\.\d+)? (B|KiB|MiB|GiB|TiB|PiB)(\/s)?|)$/;

function translated(fn) {
    setTranslator(source);
    try {
        return fn();
    } finally {
        setTranslator(null);
    }
}

function fixtureCases() {
    const out = [];
    const dir = GLib.Dir.open(ROOT, 0);
    let name;
    while ((name = dir.read_name()) !== null) {
        if (GLib.file_test(GLib.build_filenamev([ROOT, name, 'expected.json']), GLib.FileTest.EXISTS))
            out.push(name);
    }
    return out.sort();
}

// Every string of zark's files, as zark wrote it.
function zarkStrings(value, out = new Set()) {
    if (typeof value === 'string')
        out.add(value);
    else if (Array.isArray(value))
        value.forEach(v => zarkStrings(v, out));
    else if (value && typeof value === 'object')
        Object.values(value).forEach(v => zarkStrings(v, out));
    return out;
}

// The strings of a view that a person reads, with where they are.
function shownTexts(value, path = 'view', out = []) {
    if (typeof value === 'string') {
        // The run's figures are a list of parts, each one checked.
        for (const part of path.endsWith('.figures') ? value.split(', ') : [value])
            out.push([path, part]);
    } else if (Array.isArray(value)) {
        value.forEach((v, i) => shownTexts(v, `${path}[${i}]`, out));
    } else if (value && typeof value === 'object') {
        for (const [key, v] of Object.entries(value)) {
            if (!NOT_TEXT.has(key))
                shownTexts(v, `${path}.${key}`, out);
        }
    }
    return out;
}

// Translated through and through: once every balanced "[[...]]" is taken
// out, innermost first, no letter is left (spaces, punctuation and figures
// between translated parts are fine; a word of the sentence is not).
function isWrapped(text) {
    let rest = text;
    for (let prev = null; prev !== rest;) {
        prev = rest;
        rest = rest.replace(/\[\[[^[\]]*\]\]/g, '');
    }
    return rest !== text && !/[A-Za-z[\]]/.test(rest);
}

function checkTexts(texts, data, what) {
    for (const [path, text] of texts) {
        assertTrue(!/\{\w+\}/.test(text), `${what} ${path}: placeholder left in "${text}"`);
        // A notice's text leads the headline with its first letter raised.
        const lowered = text.charAt(0).toLowerCase() + text.slice(1);
        const ok = isWrapped(text) || FIGURE.test(text) || data.has(text) || data.has(lowered);
        assertTrue(ok, `${what} ${path}: "${text}" is shown untranslated`);
    }
}

const PLAIN = [
    ['fmt fills every placeholder and leaves an unknown one visible', () => {
        assertEqual(fmt('{drive}: {n} of {n}', {drive: 'black', n: 3}), 'black: 3 of 3');
        assertEqual(fmt('Last backup {age} on {drive}', {age: '2 days ago'}), 'Last backup 2 days ago on {drive}');
        assertEqual(fmt('{percent}%', {percent: 0}), '0%');
        assertEqual(fmt('no placeholder', {}), 'no placeholder');
    }],
    ['without a translator every function gives the English text', () => {
        assertEqual(_('Backup overdue'), 'Backup overdue');
        assertEqual(N_('Free'), 'Free');
        assertEqual(pgettext('month', 'May'), 'May');
        assertEqual(ngettext('{n} day ago', '{n} days ago', 1), '{n} day ago');
        assertEqual(ngettext('{n} day ago', '{n} days ago', 0), '{n} days ago');
        assertEqual(ngettext('{n} day ago', '{n} days ago', 2), '{n} days ago');
    }],
    ['a count that is not a non-negative integer picks a form and never throws', () => {
        const seen = [];
        const recorder = {
            gettext: t => t,
            pgettext: (c, t) => t,
            ngettext: (s, p, n) => {
                seen.push(n);
                return n === 1 ? s : p;
            },
        };
        setTranslator(recorder);
        try {
            for (const n of [-1, 1.4, 1.5, NaN, Infinity])
                ngettext('one', 'other', n);
        } finally {
            setTranslator(null);
        }
        assertEqual(seen, [0, 1, 2, 0, 0]);
        assertEqual([-1, 1.4, 1.5, NaN].map(n => ngettext('one', 'other', n)), ['other', 'one', 'other', 'other']);
    }],
    ['the strict check sees a word left outside the translated parts', () => {
        assertTrue(isWrapped('[[Last backup [[3 hours ago]]]]'));
        assertTrue(isWrapped('[[3 hours ago]], [[today 09:18]]'));
        assertTrue(!isWrapped('[[completed]], [[today 09:18]], took [[5 min]]'));
        assertTrue(!isWrapped('Never'));
        assertTrue(!isWrapped('[[Never]'));
    }],
];

// The tests that see the text through the translator.
export const TRANSLATED = [
    ['the translator is used once set, and dropped with null', () => {
        translated(() => assertEqual(_('Used'), '[[Used]]'));
        assertEqual(_('Used'), 'Used');
    }],
    ['format.js translates its words and keeps the units', () => translated(() => {
        const now = Date.UTC(2026, 9, 24, 12, 0, 0);
        assertEqual(formatAge(3 * 3600000), '[[3 hours ago]]');
        assertEqual(formatAge(3600000), '[[1 hour ago]]');
        assertEqual(formatDuration(4320), '[[1 h 12 min]]');
        assertEqual(formatDate(Date.UTC(2026, 9, 19, 8, 2)), '[[19 [[Oct]]]]');
        assertEqual(formatWhen(Date.UTC(2026, 9, 19, 8, 2), now), '[[19 [[Oct]] 08:02]]');
        assertEqual(formatPercent(0.44), '[[44%]]');
        assertEqual(formatAge(20000), '[[just now]]');
        assertEqual(formatAge(5 * 60000), '[[5 min ago]]');
        assertEqual(formatDuration(30), '[[under a minute]]');
        assertEqual(formatDuration(300), '[[5 min]]');
        assertEqual(formatWhen(Date.UTC(2026, 9, 24, 9, 18), now), '[[today 09:18]]');
        assertEqual(formatWhen(Date.UTC(2026, 9, 23, 23, 50), now), '[[yesterday 23:50]]');
    })],
    ['what no fixture shows goes through the translator too', () => {
        // A pool zark could not read, a drive never backed up and not
        // measured, and a result name this version does not know.
        const input = fixtureInput('idle', {connected: []});
        const status = JSON.parse(JSON.stringify(input.statusShown));
        status.source_pools[0].space = null;
        status.drives[0].space = null;
        status.drives[0].last_backup_at = null;
        status.drives[1].last_run.result = 'exploded';
        const changed = {...input, statusShown: status};
        const view = translated(() => buildView(changed));
        checkTexts(shownTexts(view), zarkStrings([status, input.progressParsed.data]), 'idle, changed');
        assertEqual(view.pools[0].label, '[[Could not be read]]');
        assertEqual(view.drives[0].last, '[[Never backed up]]');
        assertEqual(view.drives[0].fill, '[[Not measured yet]]');
        assertEqual(view.drives[1].badge, '[[Last run: exploded]]');
        const drive = view.details.find(t => t.id === 'drive:black');
        assertEqual(drive.rows.find(r => r.label === '[[Last backup]]').value, '[[Never]]');
    }],
    ['the events no fixture reaches go through the translator', () => translated(() => {
        // A drive plugged in, and one never backed up.
        const ids = fixtureInput('idle').statusShown.drives.map(d => d.drive_id);
        const before = fixtureInput('idle');
        const after = fixtureInput('idle', {connected: ids});
        after.statusShown = JSON.parse(JSON.stringify(after.statusShown));
        after.statusShown.drives[1].last_backup_at = null;
        const prev = snapshot(before);
        const drives = newEvents(prev, snapshot(after, prev), after, '').filter(e => e.kind === Event.DRIVE);
        assertEqual(drives.length, 2);
        for (const e of drives)
            assertTrue(isWrapped(e.title) && isWrapped(e.body), `${e.title} / ${e.body}`);
        assertEqual(drives[1].body, '[[Never backed up]]');

        // A question waiting long enough, without zark's text of it.
        const waiting = fixtureInput('waiting');
        waiting.progressParsed = {...waiting.progressParsed, data: {...waiting.progressParsed.data, waiting_for: null}};
        const first = snapshot(waiting);
        const later = {...waiting, nowMs: waiting.nowMs + WAITING_NOTIFY_MS};
        const asked = newEvents(first, snapshot(later, first), later, '').find(e => e.kind === Event.WAITING);
        assertEqual([asked.title, asked.body],
            ['[[zark is waiting for your answer]]', '[[In the terminal where it runs]]']);

        // A run left behind.
        const orphan = fixtureInput('orphan');
        const now = snapshot(orphan);
        const left = newEvents({...now, orphan: null}, now, orphan, '').find(e => e.kind === Event.ORPHAN);
        assertTrue(left.title === '[[zark stopped answering]]' && isWrapped(left.body), left.body);
    })],
    ['every text the view shows goes through the translator, on every fixture', () => {
        const cases = fixtureCases();
        assertTrue(cases.length >= 30, `${cases.length} fixture cases`);
        for (const name of cases) {
            const plain = fixtureInput(name);
            const drives = plain.statusShown?.drives ?? [];
            for (const connected of [[], drives.map(d => d.drive_id)]) {
                const input = fixtureInput(name, {connected, transferSeen: true});
                const data = zarkStrings([input.statusShown, input.progressParsed.data]);
                const view = translated(() => buildView(input));
                checkTexts(shownTexts(view), data, name);
            }
        }
    }],
    ['the commands reach the screen as they are typed', () => translated(() => {
        const input = fixtureInput('overdue');
        const events = newEvents(null, snapshot(input), input, '');
        const overdue = events.find(e => e.kind === Event.OVERDUE);
        assertTrue(overdue, 'an overdue event');
        assertEqual(overdue.title, '[[Backup overdue]]');
        assertTrue(isWrapped(overdue.body) && overdue.body.includes(`Run: ${BACKUP_COMMAND}]]`), overdue.body);
    })],
    ['the drive-gone dialog translates its own lines and keeps zark\'s hint', () => translated(() => {
        const input = fixtureInput('drive-gone');
        const progress = input.progressParsed.data;
        const alert = driveGoneAlert(progress, input.nowMs);
        assertTrue(isWrapped(alert.title) && alert.title.includes(progress.drive.name), alert.title);
        const [seen, hint] = alert.body.split('\n\n');
        assertTrue(isWrapped(seen), seen);
        assertEqual(hint, progress.drive_gone.hint);
    })],
    ['a run left behind is told in one translated sentence', () => translated(() => {
        const input = fixtureInput('orphan');
        const text = stoppedAnswering(input.progressParsed.data, input.nowMs);
        assertTrue(isWrapped(text) && !/\{\w+\}/.test(text), text);
    })],
    ['the About tab translates its words and keeps versions and commands', () => translated(() => {
        const status = {version: '2.2.0', generatedAt: '2026-11-08T10:30:00Z', generatedBy: 'timer'};
        const base = {extensionVersion: '1.3', shellVersion: '50.6', nowMs: Date.UTC(2026, 10, 8, 12)};
        const at = Date.UTC(2026, 10, 8, 10, 30);
        const dpkgs = [
            undefined, null, {version: '2.2.0-1', state: 'installed'}, {version: '2.1.0-1', state: 'installed'},
            {version: '2.2.0-1', state: 'half-configured'}, {version: '', state: ''},
            {version: '', state: 'installed'}, {version: '2.2.0-1', state: ''}, {version: '', state: 'unpacked'},
        ];
        for (const dpkg of dpkgs) {
            for (const st of [status, null]) {
                const v = aboutView({...base, dpkg, status: st, statusAtMs: at});
                for (const row of v.rows) {
                    if (row.label !== 'zark' && row.label !== 'GNOME Shell')
                        assertTrue(isWrapped(row.label), row.label);
                    if (!['1.3', '50.6'].includes(row.value))
                        assertTrue(isWrapped(row.value), `${row.label}: ${row.value}`);
                }
                if (v.commandsNote !== null)
                    assertTrue(isWrapped(v.commandsNote), v.commandsNote);
                for (const c of v.commands)
                    assertTrue(!c.command.includes('[[') && !c.description.includes('[['), c.command);
            }
        }
    })],
];

export const tests = [...PLAIN, ...TRANSLATED];
