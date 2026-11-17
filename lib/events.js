// SPDX-License-Identifier: GPL-2.0-or-later
//
// Which notifications a new reading calls for. Pure: the reader passes the
// same input as buildView() and keeps the snapshot between readings.
//
// zark already notifies a backup's start and result and a pool's capacity
// (notify-send from backup and from its hourly timer); this only covers
// what zark does not: an overdue backup, a drive plugged in, a question
// waiting in the terminal, and a run left behind. A backup's drive gone
// away is told by a dialog to close (lib/alert.js), since zark's own
// notification of it is easily missed.

import {parseTimestamp} from './contract.js';
import {formatAge, formatWhen} from './format.js';
import {_, fmt} from './i18n.js';
import {Progress} from './state.js';
import {BACKUP_COMMAND, driveGoneOf, newestBackup, stoppedAnswering} from './view.js';

export const Event = Object.freeze({
    OVERDUE: 'overdue',
    DRIVE: 'drive',
    WAITING: 'waiting',
    ANSWERED: 'answered',
    ORPHAN: 'orphan',
    DRIVE_GONE: 'drive-gone',
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
 * The drive-gone alert's key: the run and the drive, as zark's app keys its
 * own alert.
 *
 * @param {object} progress - progress.json's data, of an active run
 * @param {string} runKey - the run's part, "<pid>:<started_at>"
 * @returns {string|null} "<pid>:<started_at>:<pool>", or null without an
 *   alert to give
 */
function driveGoneKey(progress, runKey) {
    const gone = driveGoneOf(progress);
    const pool = gone?.pool ?? progress.drive?.name;
    return gone && typeof gone.hint === 'string' && typeof pool === 'string' ? `${runKey}:${pool}` : null;
}

/**
 * The drive-gone alert's texts.
 *
 * @param {object} progress - progress.json's data, with drive_gone
 * @param {number} nowMs - the reader's clock
 * @returns {{title: string, body: string}}
 */
export function driveGoneAlert(progress, nowMs) {
    const gone = progress.drive_gone;
    const name = progress.drive?.name ?? gone.pool;
    const since = parseTimestamp(gone.since);
    // The first line is the extension's; zark's hint under it stays as zark wrote it.
    const seen = Number.isNaN(since)
        // Translators: "zark backup" is the program's name and stays as it is
        ? _('Seen gone, while zark backup was writing to it.')
        // Translators: "zark backup" is the program's name and stays as it is;
        // {when} is "today 09:18", "yesterday 23:50" or "24 Oct 09:18"
        : fmt(_('Seen gone {when}, while zark backup was writing to it.'), {when: formatWhen(since, nowMs)});
    return {
        title: fmt(_('{drive}: the backup drive went away'), {drive: name}),
        body: `${seen}\n\n${gone.hint}`,
    };
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
        driveGone: active ? driveGoneKey(progress, runKey) : null,
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
 * A backup's drive gone away is told also at the first reading, until its
 * alert is acknowledged (OK pressed): the reader then stores its key, and
 * until then the event comes at each reading, with the same key.
 *
 * @param {object|null} prev - the previous snapshot
 * @param {object} next - this reading's snapshot, from snapshot(input, prev)
 * @param {object} input - buildView()'s input for this reading
 * @param {string} overdueNotifiedOn - local date of the last overdue notice
 * @param {{enabled: boolean, acknowledged: string}} [driveGone] - the
 *   drive-gone alert's setting and the last acknowledged key
 * @returns {{kind: string, title: string, body: string, key: string|null, pid: number|null}[]}
 */
export function newEvents(prev, next, input, overdueNotifiedOn, driveGone = {enabled: true, acknowledged: ''}) {
    const {statusShown: status, nowMs} = input;
    const progress = input.progressParsed.data;
    const events = [];
    const event = (kind, title, body, key = null) =>
        ({kind, title, body, key, pid: progress ? progress.pid : null});

    if (next.overdue && overdueNotifiedOn !== localDate(nowMs)) {
        const newest = newestBackup(status);
        events.push(event(Event.OVERDUE, _('Backup overdue'), newest
            // Translators: {age} is "3 hours ago"; {command} is a command as typed and stays as it is
            ? fmt(_('Last backup {age} on {drive}. Run: {command}'),
                {age: formatAge(nowMs - newest.at), drive: newest.name, command: BACKUP_COMMAND})
            : fmt(_('No backup yet. Run: {command}'), {command: BACKUP_COMMAND})));
    }
    if (next.waiting && !next.waitingNotified && nowMs - next.waitingSince >= WAITING_NOTIFY_MS) {
        next.waitingNotified = true;
        events.push(event(Event.WAITING, _('zark is waiting for your answer'),
            progress.waiting_for ?? _('In the terminal where it runs'), next.waiting));
    }
    if (next.driveGone && driveGone.enabled && next.driveGone !== driveGone.acknowledged) {
        const {title, body} = driveGoneAlert(progress, nowMs);
        events.push(event(Event.DRIVE_GONE, title, body, next.driveGone));
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
        // Translators: a notification's title: a backup drive was plugged in
        const title = fmt(_('{drive} connected'), {drive: name});
        events.push(event(Event.DRIVE, title,
            Number.isNaN(last) ? _('Never backed up') : fmt(_('Last backup {age}'), {age: formatAge(nowMs - last)})));
    }
    if (next.orphan && next.orphan !== prev.orphan)
        events.push(event(Event.ORPHAN, _('zark stopped answering'), stoppedAnswering(progress, nowMs)));
    return events;
}
