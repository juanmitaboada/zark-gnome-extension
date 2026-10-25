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
    ORPHAN: 'orphan',
});

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
 * @returns {object} snapshot
 */
export function snapshot(input) {
    const {progressParsed, progressClass, statusShown: status, connected} = input;
    const progress = progressParsed.data;
    const runKey = progress ? `${progress.pid}:${progress.started_at}` : null;
    const active = progressClass === Progress.RUNNING || progressClass === Progress.STALLED;
    return {
        connected: status
            ? status.drives.filter(d => connected.has(d.drive_id)).map(d => d.name)
            : [],
        runningTo: active && progress.drive ? progress.drive.name : null,
        waiting: progressClass === Progress.RUNNING && progress.waiting_for_input
            // Not updated_at: the heartbeat moves it while the question waits.
            ? `${runKey}:${progress.step?.index}:${progress.waiting_for}`
            : null,
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
 * overdue backup, notified once a day.
 *
 * @param {object|null} prev - the previous snapshot
 * @param {object} next - this reading's snapshot
 * @param {object} input - buildView()'s input for this reading
 * @param {string} overdueNotifiedOn - local date of the last overdue notice
 * @returns {{kind: string, title: string, body: string, tab: string|null}[]}
 */
export function newEvents(prev, next, input, overdueNotifiedOn) {
    const {statusShown: status, nowMs} = input;
    const progress = input.progressParsed.data;
    const events = [];
    const driveTab = name => name ? `drive:${name}` : null;

    if (next.overdue && overdueNotifiedOn !== localDate(nowMs)) {
        const newest = newestBackup(status);
        events.push({
            kind: Event.OVERDUE,
            title: 'Backup overdue',
            body: newest
                ? `Last backup ${formatAge(nowMs - newest.at)} on ${newest.name}. Run: sudo zark backup`
                : 'No backup yet. Run: sudo zark backup',
            tab: driveTab(newest?.name),
        });
    }
    if (prev === null)
        return events;

    for (const name of next.connected) {
        if (prev.connected.includes(name) || name === next.runningTo)
            continue;
        const drive = status.drives.find(d => d.name === name);
        const last = parseTimestamp(drive.last_backup_at);
        events.push({
            kind: Event.DRIVE,
            title: `${name} connected`,
            body: Number.isNaN(last) ? 'Never backed up' : `Last backup ${formatAge(nowMs - last)}`,
            tab: driveTab(name),
        });
    }
    if (next.waiting && next.waiting !== prev.waiting) {
        events.push({
            kind: Event.WAITING,
            title: 'zark is waiting for your answer',
            body: progress.waiting_for ?? 'In the terminal where it runs',
            tab: driveTab(progress.drive?.name),
        });
    }
    if (next.orphan && next.orphan !== prev.orphan) {
        const target = progress.drive ? ` to ${progress.drive.name}` : '';
        const when = formatWhen(parseTimestamp(progress.updated_at), nowMs);
        events.push({
            kind: Event.ORPHAN,
            title: 'zark stopped answering',
            body: `zark ${progress.command}${target} stopped answering at ${when}. ` +
                'The next zark command records it.',
            tab: driveTab(progress.drive?.name),
        });
    }
    return events;
}
