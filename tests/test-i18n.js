// SPDX-License-Identifier: GPL-2.0-or-later
//
// The translations' plumbing (lib/i18n.js) under plain gjs. A fake translator
// wraps every translated text as "[[...]]", so a text the view shows without
// passing through _() stands out, and so do a placeholder left unfilled and a
// command or a text of zark's that went through _() by mistake.

import GLib from 'gi://GLib';

import {aboutView} from '../lib/about.js';
import {Event, driveGoneAlert, newEvents, snapshot} from '../lib/events.js';
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

function isWrapped(text) {
    return text.startsWith('[[') && text.endsWith(']]');
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
];

// The tests that see the text through the translator.
export const TRANSLATED = [
    ['the translator is used once set, and dropped with null', () => {
        translated(() => assertEqual(_('Free'), '[[Free]]'));
        assertEqual(_('Free'), 'Free');
    }],
    ['format.js translates its words and keeps the units', () => translated(() => {
        const now = Date.UTC(2026, 9, 24, 12, 0, 0);
        assertEqual(formatAge(3 * 3600000), '[[3 hours ago]]');
        assertEqual(formatAge(3600000), '[[1 hour ago]]');
        assertEqual(formatDuration(4320), '[[1 h 12 min]]');
        assertEqual(formatDate(Date.UTC(2026, 9, 19, 8, 2)), '[[19 [[Oct]]]]');
        assertEqual(formatWhen(Date.UTC(2026, 9, 19, 8, 2), now), '[[19 [[Oct]] 08:02]]');
        assertEqual(formatPercent(0.44), '[[44%]]');
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
