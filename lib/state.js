// SPDX-License-Identifier: GPL-2.0-or-later
//
// Reading rules of zark's status files: orphan detection, staleness and the
// indicator state ("Reading the files" in zark's docs/STATUS-FILES.md).
// Pure: the caller passes what it read from /proc and its own clock.

import {FileState, parseTimestamp} from './contract.js';

/** Classification of progress.json ("Orphan detection"). */
export const Progress = Object.freeze({
    IDLE: 'idle',
    UNKNOWN: 'unknown',
    ORPHAN: 'orphan',
    STALLED: 'stalled',
    RUNNING: 'running',
});

/** Indicator states, in the contract's order. */
export const Indicator = Object.freeze({
    WAITING: 'waiting',
    RUNNING: 'running',
    ATTENTION: 'attention',
    EDGE: 'edge',
    OVERDUE: 'overdue',
    NONE: 'none',
    OK: 'ok',
});

export const STALLED_AFTER_MS = 30 * 1000;

const ATTENTION_RESULTS = new Set(['incomplete', 'not_verified', 'interrupted']);

/**
 * Classify progress.json.
 *
 * `proc` describes the host as the reader found it:
 * - `bootId`: /proc/sys/kernel/random/boot_id, trimmed (rule 3);
 * - `pidExists`: whether /proc/<pid> exists for the file's pid (rule 4);
 * - `rootHidden`: whether /proc hides root's processes from the reader
 *   (/proc/1 does not exist for it): then a missing /proc/<pid> is no
 *   evidence that the run ended, rule 4 is skipped and the heartbeat
 *   decides; absent means false;
 * - `startTicks`: field 22 of /proc/<pid>/stat, or null when it could not be
 *   read (hidepid=noaccess), in which case rule 5 is skipped.
 *
 * @param {{state: string, data: object|null}} parsed - from parseFile()
 * @param {{bootId: string, pidExists: boolean, rootHidden?: boolean, startTicks: number|null}} proc
 * @param {number} nowMs - the reader's clock
 * @returns {string} a Progress value
 */
export function classifyProgress(parsed, proc, nowMs) {
    if (parsed.state === FileState.ABSENT)
        return Progress.IDLE;
    if (parsed.state !== FileState.OK)
        return Progress.UNKNOWN;

    const data = parsed.data;
    if (data.boot_id !== proc.bootId)
        return Progress.ORPHAN;
    if (!proc.pidExists && proc.rootHidden !== true)
        return Progress.ORPHAN;
    if (proc.startTicks !== null && proc.startTicks !== data.pid_start_ticks)
        return Progress.ORPHAN;
    if (nowMs - parseTimestamp(data.updated_at) > STALLED_AFTER_MS)
        return Progress.STALLED;
    return Progress.RUNNING;
}

/**
 * Field 22 (starttime) of a /proc/<pid>/stat line, or null.
 *
 * Fields are counted after the last ')', since the process name may hold
 * spaces or parentheses: field 22 is the 20th after it.
 *
 * @param {string} statLine - the file's contents
 * @returns {number|null}
 */
export function startTicksFromStat(statLine) {
    const close = statLine.lastIndexOf(')');
    if (close < 0)
        return null;
    const fields = statLine.slice(close + 1).trim().split(/\s+/);
    const ticks = Number(fields[19]);
    return Number.isInteger(ticks) ? ticks : null;
}

/**
 * Field 4 (ppid) of a /proc/<pid>/stat line, or null.
 *
 * @param {string} statLine - the file's contents
 * @returns {number|null}
 */
export function parentPidFromStat(statLine) {
    const close = statLine.lastIndexOf(')');
    if (close < 0)
        return null;
    const ppid = Number(statLine.slice(close + 1).trim().split(/\s+/)[1]);
    return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
}

/**
 * Whether status.json is older than its own `thresholds.stale_after_s`.
 *
 * @param {object} status - a parsed status.json
 * @param {number} nowMs - the reader's clock
 * @returns {boolean}
 */
export function isStale(status, nowMs) {
    const ageMs = nowMs - parseTimestamp(status.generated_at);
    return ageMs > status.thresholds.stale_after_s * 1000;
}

/** Classification of status.json, as the contract's fixtures name it. */
export const Status = Object.freeze({
    OK: 'ok',
    STALE: 'stale',
    NEWER: 'newer',
    UNREADABLE: 'unreadable',
    ABSENT: 'absent',
});

/**
 * Classify status.json.
 *
 * @param {{state: string, data: object|null}} parsed - from parseFile()
 * @param {number} nowMs - the reader's clock
 * @returns {string} a Status value
 */
export function classifyStatus(parsed, nowMs) {
    switch (parsed.state) {
    case FileState.ABSENT:
        return Status.ABSENT;
    case FileState.NEWER:
        return Status.NEWER;
    case FileState.UNREADABLE:
        return Status.UNREADABLE;
    default:
        return isStale(parsed.data, nowMs) ? Status.STALE : Status.OK;
    }
}

function needsAttention(status) {
    if (status.notices.some(n => n.level === 'critical'))
        return true;
    return status.drives.some(d => d.last_run && ATTENTION_RESULTS.has(d.last_run.result));
}

function isOverdue(status) {
    return status.notices.some(n => n.code === 'backup_age' && n.level === 'warning');
}

/**
 * The indicator state, first match wins.
 *
 * @param {string} progressClass - from classifyProgress()
 * @param {object|null} progress - the parsed progress.json, if any
 * @param {{state: string, data: object|null}} statusParsed - from parseFile()
 * @param {number} nowMs - the reader's clock
 * @returns {string} an Indicator value
 */
export function indicatorState(progressClass, progress, statusParsed, nowMs) {
    const active = progressClass === Progress.RUNNING || progressClass === Progress.STALLED;
    if (active && progress.waiting_for_input)
        return Indicator.WAITING;
    if (active)
        return Indicator.RUNNING;

    const status = statusParsed.state === FileState.OK ? statusParsed.data : null;
    if (status && needsAttention(status))
        return Indicator.ATTENTION;

    if (statusParsed.state === FileState.NEWER ||
        statusParsed.state === FileState.UNREADABLE ||
        (status && isStale(status, nowMs)) ||
        progressClass === Progress.ORPHAN ||
        progressClass === Progress.UNKNOWN)
        return Indicator.EDGE;

    if (status && isOverdue(status))
        return Indicator.OVERDUE;
    if (statusParsed.state === FileState.ABSENT)
        return Indicator.NONE;
    return Indicator.OK;
}

/**
 * How far a backup's transfer has gone, for the panel ring and the bar.
 *
 * Bytes when both `bytes_done` and `bytes_total` are known, else the
 * dataset counts. The fraction stays below 1 while the transfer runs.
 *
 * @param {object|null} transfer - progress.json's `transfer`
 * @returns {{fraction: number, source: string}|null} null without a transfer
 */
export function transferProgress(transfer) {
    if (!transfer)
        return null;

    let fraction;
    let source;
    if (transfer.bytes_done !== null && transfer.bytes_total !== null && transfer.bytes_total > 0) {
        fraction = transfer.bytes_done / transfer.bytes_total;
        source = 'bytes';
    } else if (transfer.datasets_total > 0) {
        fraction = transfer.datasets_done / transfer.datasets_total;
        source = 'datasets';
    } else {
        return {fraction: 0, source: 'datasets'};
    }
    return {fraction: Math.max(0, Math.min(fraction, 0.99)), source};
}

/**
 * Seconds left, or null when the contract allows no ETA.
 *
 * @param {object|null} transfer - progress.json's `transfer`
 * @returns {number|null}
 */
export function transferEta(transfer) {
    if (!transfer || transfer.bytes_total === null || transfer.bytes_done === null ||
        transfer.rate_bytes_per_s === null || transfer.rate_bytes_per_s <= 0 ||
        transfer.bytes_total_partial)
        return null;
    return Math.max(0, transfer.bytes_total - transfer.bytes_done) / transfer.rate_bytes_per_s;
}

/**
 * Number of orange sectors in the panel ring, 0 to 8.
 *
 * @param {number} fraction - from transferProgress()
 * @returns {number}
 */
export function ringSectors(fraction) {
    return Math.max(0, Math.min(8, Math.floor(fraction * 8)));
}
