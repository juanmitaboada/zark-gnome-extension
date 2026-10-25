// SPDX-License-Identifier: GPL-2.0-or-later
//
// Which notifications successive readings call for.

import {Event, WAITING_NOTIFY_MS, localDate, newEvents, snapshot} from '../lib/events.js';
import {assertEqual, assertTrue} from './harness.js';
import {fixtureInput} from './test-view.js';

const BLACK_ID = 'usb-JMicron_Generic_DISK00_0123456789ABCDEF-0:0';

// The events from `before` to `after`, as the reader sees them.
function events(before, after, overdueNotifiedOn = '') {
    const prev = before === null ? null : snapshot(before);
    return newEvents(prev, snapshot(after, prev), after, overdueNotifiedOn);
}

// Readings in order, as the reader takes them: the events of each.
function replay(inputs) {
    let prev = null;
    return inputs.map(input => {
        const next = snapshot(input, prev);
        const out = newEvents(prev, next, input, '');
        prev = next;
        return out.map(e => e.kind);
    });
}

function at(input, nowMs) {
    return {...input, nowMs};
}

// gjs has no structuredClone; the inputs hold only JSON data and a Set.
function clone(input) {
    return {...JSON.parse(JSON.stringify(input)), connected: new Set(input.connected)};
}

function overdue(input) {
    // The idle case with its backup_age notice raised to a warning.
    const copy = clone(input);
    copy.statusShown.notices.find(n => n.code === 'backup_age').level = 'warning';
    return copy;
}

export const tests = [
    ['the first reading is a baseline: nothing notified', () => {
        assertEqual(events(null, fixtureInput('idle', {connected: [BLACK_ID]})), []);
        assertEqual(events(null, fixtureInput('waiting')), []);
        assertEqual(events(null, fixtureInput('orphan')), []);
    }],
    ['a drive plugged in, once', () => {
        const before = fixtureInput('idle');
        const after = fixtureInput('idle', {connected: [BLACK_ID]});
        const [event] = events(before, after);
        assertEqual(event.kind, Event.DRIVE);
        assertEqual(event.title, 'black connected');
        assertTrue(event.body.startsWith('Last backup '), event.body);
        assertEqual(events(after, after), []);
        assertEqual(events(after, before), [], 'unplugging says nothing');
    }],
    ['no drive notification for the drive a backup is writing to', () => {
        const before = fixtureInput('running');
        const after = fixtureInput('running', {connected: [BLACK_ID]});
        assertEqual(events(before, after), []);
    }],
    ['a question is notified only after 15 s unanswered, once', () => {
        const running = fixtureInput('running');
        const waiting = fixtureInput('waiting');
        const t = waiting.nowMs;
        const kinds = replay([
            at(running, t - 5000),
            at(waiting, t),
            at(waiting, t + WAITING_NOTIFY_MS - 1),
            at(waiting, t + WAITING_NOTIFY_MS),
            at(waiting, t + WAITING_NOTIFY_MS + 5000),
        ]);
        assertEqual(kinds, [[], [], [], [Event.WAITING], []]);
    }],
    ['a question answered in time is not notified', () => {
        const running = fixtureInput('running');
        const waiting = fixtureInput('waiting');
        const t = waiting.nowMs;
        assertEqual(replay([at(running, t - 5000), at(waiting, t), at(running, t + 5000)]), [[], [], []]);
    }],
    ['an answer withdraws the question\'s notification', () => {
        const running = fixtureInput('running');
        const waiting = fixtureInput('waiting');
        const t = waiting.nowMs;
        const kinds = replay([at(running, t - 5000), at(waiting, t), at(waiting, t + WAITING_NOTIFY_MS),
            at(running, t + WAITING_NOTIFY_MS + 5000)]);
        assertEqual(kinds, [[], [], [Event.WAITING], [Event.ANSWERED]]);
    }],
    ['a heartbeat is not a new question', () => {
        const waiting = fixtureInput('waiting');
        const t = waiting.nowMs;
        const later = clone(waiting);
        later.progressParsed.data.updated_at = '2030-01-01T00:00:00Z';
        const kinds = replay([at(waiting, t), at(later, t + WAITING_NOTIFY_MS),
            at(waiting, t + 2 * WAITING_NOTIFY_MS)]);
        assertEqual(kinds, [[], [Event.WAITING], []]);
    }],
    ['a question still open at start is notified 15 s later', () => {
        const waiting = fixtureInput('waiting');
        const t = waiting.nowMs;
        assertEqual(replay([at(waiting, t), at(waiting, t + WAITING_NOTIFY_MS)]), [[], [Event.WAITING]]);
    }],
    ['events carry zark\'s pid, for its terminal', () => {
        const [event] = events(fixtureInput('running'), fixtureInput('orphan'));
        assertTrue(Number.isInteger(event.pid), 'pid');
    }],
    ['a run left behind, once', () => {
        const before = fixtureInput('running');
        const after = fixtureInput('orphan');
        const [event] = events(before, after);
        assertEqual(event.kind, Event.ORPHAN);
        assertTrue(event.body.includes('stopped answering at '), event.body);
        assertEqual(events(after, after), []);
    }],
    ['an overdue backup: at start too, once a day', () => {
        const input = overdue(fixtureInput('idle'));
        const [event] = events(null, input);
        assertEqual(event.kind, Event.OVERDUE);
        assertTrue(event.body.startsWith('Last backup '), event.body);
        assertEqual(events(null, input, localDate(input.nowMs)), []);
        assertEqual(events(null, fixtureInput('idle')), [], 'not when the notice is info');
    }],
    ['local dates', () => {
        assertEqual(localDate(Date.UTC(2026, 9, 25, 23, 30)), '2026-10-25');
    }],
];
