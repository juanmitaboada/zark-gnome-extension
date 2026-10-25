// SPDX-License-Identifier: GPL-2.0-or-later
//
// Which notifications a new reading calls for. Pure: the reader passes the
// same input as buildView() and keeps the snapshot between readings.
//
// zark already notifies a backup's start and result and a pool's capacity
// (notify-send from backup and from its hourly timer); this only covers
// what zark does not: an overdue backup, a drive plugged in, a question
// waiting in the terminal, and a run left behind.

import {parseTimestamp} from './contract.js';
import {formatAge, formatWhen} from './format.js';
import {Progress} from './state.js';
import {newestBackup} from './view.js';

export const Event = Object.freeze({
    OVERDUE: 'overdue',
    DRIVE: 'drive',
    WAITING: 'waiting',
    ANSWERED: 'answered',
    ORPHAN: 'orphan',
});

// A question answered within this time is not notified.
export const WAITING_NOTIFY_MS = 15000;

function pad(n) {
    return n < 10 ? `0${n}` : `${n}`;
}

/**
 * @param {number} ms - a moment
 * @returns {string} its local date, "2026-10-25"
 */
export function localDate(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * What a reading says about the events, for comparing with the next one.
 *
 * @param {object} input - buildView()'s input
 * @param {object|null} [prev] - the previous snapshot, to carry how long the
 *   current question has waited
 * @returns {object} snapshot
 */
export function snapshot(input, prev = null) {
    const {progressParsed, progressClass, statusShown: status, connected, nowMs} = input;
    const progress = progressParsed.data;
    const runKey = progress ? `${progress.pid}:${progress.started_at}` : null;
    const active = progressClass === Progress.RUNNING || progressClass === Progress.STALLED;
    // Stalled too: the question is still open even if the heartbeat stopped.
    const waiting = active && progress.waiting_for_input
        // Not updated_at: the heartbeat moves it while the question waits.
        ? `${runKey}:${progress.step?.index}:${progress.waiting_for}`
        : null;
    const same = waiting !== null && prev !== null && prev.waiting === waiting;
    return {
        connected: status
            ? status.drives.filter(d => connected.has(d.drive_id)).map(d => d.name)
            : [],
        runningTo: active && progress.drive ? progress.drive.name : null,
        waiting,
        // First seen: a reading, not the question's own time, which the file lacks.
        waitingSince: same ? prev.waitingSince : nowMs,
        waitingNotified: same ? prev.waitingNotified : false,
        orphan: progressClass === Progress.ORPHAN ? runKey : null,
        overdue: status !== null &&
            status.notices.some(n => n.code === 'backup_age' && n.level === 'warning'),
    };
}

/**
 * The notifications between two readings.
 *
 * The first reading (`prev` null) is a baseline: what is already there when
 * the extension starts is shown in the menu, not notified, except an
 * overdue backup, notified once a day, and a question still waiting
 * WAITING_NOTIFY_MS later. A question is notified once it has waited that
 * long; when it is answered, an ANSWERED event withdraws its notification.
 * Sets `next.waitingNotified`.
 *
 * @param {object|null} prev - the previous snapshot
 * @param {object} next - this reading's snapshot, from snapshot(input, prev)
 * @param {object} input - buildView()'s input for this reading
 * @param {string} overdueNotifiedOn - local date of the last overdue notice
 * @returns {{kind: string, title: string, body: string, key: string|null, pid: number|null}[]}
 */
export function newEvents(prev, next, input, overdueNotifiedOn) {
    const {statusShown: status, nowMs} = input;
    const progress = input.progressParsed.data;
    const events = [];
    const event = (kind, title, body, key = null) =>
        ({kind, title, body, key, pid: progress ? progress.pid : null});

    if (next.overdue && overdueNotifiedOn !== localDate(nowMs)) {
        const newest = newestBackup(status);
        events.push(event(Event.OVERDUE, 'Backup overdue', newest
            ? `Last backup ${formatAge(nowMs - newest.at)} on ${newest.name}. Run: sudo zark backup`
            : 'No backup yet. Run: sudo zark backup'));
    }
    if (next.waiting && !next.waitingNotified && nowMs - next.waitingSince >= WAITING_NOTIFY_MS) {
        next.waitingNotified = true;
        events.push(event(Event.WAITING, 'zark is waiting for your answer',
            progress.waiting_for ?? 'In the terminal where it runs', next.waiting));
    }
    if (prev === null)
        return events;
    if (prev.waitingNotified && prev.waiting !== next.waiting)
        events.push(event(Event.ANSWERED, '', '', prev.waiting));

    for (const name of next.connected) {
        if (prev.connected.includes(name) || name === next.runningTo)
            continue;
        const drive = status.drives.find(d => d.name === name);
        const last = parseTimestamp(drive.last_backup_at);
        events.push(event(Event.DRIVE, `${name} connected`,
            Number.isNaN(last) ? 'Never backed up' : `Last backup ${formatAge(nowMs - last)}`));
    }
    if (next.orphan && next.orphan !== prev.orphan) {
        const target = progress.drive ? ` to ${progress.drive.name}` : '';
        const when = formatWhen(parseTimestamp(progress.updated_at), nowMs);
        events.push(event(Event.ORPHAN, 'zark stopped answering',
            `zark ${progress.command}${target} stopped answering at ${when}. ` +
            'The next zark command records it.'));
    }
    return events;
}
