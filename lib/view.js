// SPDX-License-Identifier: GPL-2.0-or-later
//
// What the panel shows, built from both status files. Pure: the shell side
// passes what it read, which drives are connected and its clock.

import {FileState, parseTimestamp} from './contract.js';
import {
    formatAge, formatBytes, formatDate, formatDuration, formatRate, formatWhen,
} from './format.js';
import {
    Indicator, Progress, indicatorState, isStale, ringSectors, transferEta, transferProgress,
} from './state.js';

const DAY_MS = 86400000;

const NEWER_NOTE = 'zark wrote its status in a newer format. This shows the last state it could read; ' +
    'update the extension.';

const BADGES = {
    incomplete: 'Last run incomplete',
    not_verified: 'Last run not verified',
    interrupted: 'Last run interrupted',
    aborted: 'Last run aborted',
};

/**
 * Panel icon for a state.
 *
 * @param {string} indicator - an Indicator value
 * @param {object|null} progress - the parsed progress.json
 * @param {boolean} transferSeen - this run already sent data
 * @returns {{kind: string, sectors: number}} kind: 'symbolic', 'progress'
 *   or 'waiting'
 */
export function panelIcon(indicator, progress, transferSeen) {
    if (indicator === Indicator.WAITING)
        return {kind: 'waiting', sectors: 0};
    if (indicator !== Indicator.RUNNING)
        return {kind: 'symbolic', sectors: 0};

    const transfer = transferProgress(progress.transfer);
    if (transfer)
        return {kind: 'progress', sectors: ringSectors(transfer.fraction)};
    // After the transfer a backup verifies and exports: the data is sent.
    return {kind: 'progress', sectors: transferSeen ? 8 : 0};
}

function newestBackup(status) {
    let newest = null;
    for (const drive of status.drives) {
        const at = parseTimestamp(drive.last_backup_at);
        if (!Number.isNaN(at) && (newest === null || at > newest.at))
            newest = {at, name: drive.name};
    }
    return newest;
}

function capitalise(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function headline(indicator, ctx) {
    const {progress, progressClass, statusParsed, status, nowMs} = ctx;
    switch (indicator) {
    case Indicator.WAITING:
        return 'Waiting for your answer in the terminal';
    case Indicator.RUNNING:
        if (progress.command !== 'backup')
            return `zark ${progress.command} is running`;
        return progress.drive ? `Backing up to ${progress.drive.name}` : 'Backup starting';
    case Indicator.ATTENTION: {
        const drive = status.drives.find(d => d.last_run && BADGES[d.last_run.result] &&
            d.last_run.result !== 'aborted');
        if (drive)
            return `Last backup to ${drive.name} needs attention`;
        const critical = status.notices.find(n => n.level === 'critical');
        return capitalise(critical.text);
    }
    case Indicator.EDGE:
        if (statusParsed.state === FileState.NEWER)
            return 'Status written by a newer zark';
        if (statusParsed.state === FileState.UNREADABLE)
            return 'The status file cannot be read';
        if (status && isStale(status, nowMs))
            return `Status not refreshed since ${formatWhen(parseTimestamp(status.generated_at), nowMs)}`;
        if (progressClass === Progress.ORPHAN)
            return 'The last zark run ended abnormally';
        return 'zark is running; its progress cannot be read';
    case Indicator.NONE:
        return 'No status from zark yet';
    default: {
        const newest = status ? newestBackup(status) : null;
        if (!newest)
            return 'No backup yet';
        const age = formatAge(nowMs - newest.at);
        return indicator === Indicator.OVERDUE
            ? `Backup overdue, last one ${age} on ${newest.name}`
            : `Backups up to date, last one ${age} on ${newest.name}`;
    }
    }
}

function notes(ctx) {
    const {progress, progressClass, statusParsed, status, nowMs} = ctx;
    const out = [];
    if (statusParsed.state === FileState.NEWER)
        out.push(NEWER_NOTE);
    if (statusParsed.state === FileState.UNREADABLE)
        out.push('The status file exists but does not parse. This shows the last state it could read.');
    if (statusParsed.state === FileState.ABSENT)
        out.push('zark 2.1 or later writes its status at the end of every run and from its hourly timer.');
    if (status && isStale(status, nowMs))
        out.push('Is the zark alerts timer installed? The figures below are as old as their dates say.');
    if (progressClass === Progress.ORPHAN) {
        const target = progress.drive ? ` to ${progress.drive.name}` : '';
        const when = formatWhen(parseTimestamp(progress.updated_at), nowMs);
        out.push(`zark ${progress.command}${target} stopped answering at ${when}. ` +
            'The next zark command records it.');
    }
    if (progressClass === Progress.UNKNOWN)
        out.push('The progress file does not parse or comes from a newer zark.');
    return out;
}

function runView(ctx) {
    const {progress, progressClass, nowMs} = ctx;
    const stalled = progressClass === Progress.STALLED;
    const run = {
        title: progress.command === 'backup'
            ? `Backup${progress.drive ? ` to ${progress.drive.name}` : ''}`
            : `zark ${progress.command}`,
        elapsed: `running for ${formatDuration((nowMs - parseTimestamp(progress.started_at)) / 1000)}`,
        step: progress.step
            ? `Step ${progress.step.index} of ${progress.step.total}: ${progress.step.label}`
            : null,
        waitingFor: progress.waiting_for_input ? progress.waiting_for : null,
        stalled: stalled
            ? `No update for ${Math.round((nowMs - parseTimestamp(progress.updated_at)) / 1000)} s. ` +
              'zark is still running; the figures below are not current.'
            : null,
        dataset: null,
        fraction: null,
        figures: null,
        transfers: null,
    };

    const transfer = progress.transfer;
    if (!transfer)
        return run;

    run.dataset = transfer.dataset
        ? `${transfer.dataset}${transfer.dataset_state ? ` (${transfer.dataset_state})` : ''}`
        : 'Between datasets';
    run.fraction = transferProgress(transfer).fraction;

    const parts = [];
    if (transfer.bytes_done !== null) {
        let sent = formatBytes(transfer.bytes_done);
        if (transfer.bytes_total !== null) {
            const of = transfer.bytes_total_partial ? 'of at least' : 'of';
            sent += ` ${of} ${formatBytes(transfer.bytes_total)}`;
        }
        parts.push(sent);
    }
    if (transfer.rate_bytes_per_s !== null)
        parts.push(formatRate(transfer.rate_bytes_per_s));
    const eta = transferEta(transfer);
    if (eta !== null && eta >= 60)
        parts.push(`about ${formatDuration(eta)} left`);
    else if (eta !== null)
        parts.push(eta > 0 ? 'under a minute left' : 'finishing');
    run.figures = parts.length ? parts.join(', ') : null;

    const failed = transfer.datasets_failed ? `, ${transfer.datasets_failed} failed` : '';
    run.transfers = `Transfers: ${transfer.datasets_done} of ${transfer.datasets_total} done${failed}`;
    return run;
}

function level(capacity, thresholds) {
    if (capacity >= thresholds.capacity_critical_pct)
        return 'critical';
    if (capacity >= thresholds.capacity_warning_pct)
        return 'warning';
    return 'ok';
}

function poolsView(status) {
    return status.source_pools.map(pool => {
        if (!pool.space)
            return {name: pool.name, label: 'Could not be read', fraction: 0, level: 'unknown'};
        const space = pool.space;
        return {
            name: pool.name,
            label: `${space.capacity_pct}% used, ${formatBytes(space.available_bytes)} free`,
            fraction: space.capacity_pct / 100,
            level: pool.level ?? level(space.capacity_pct, status.thresholds),
        };
    });
}

function drivesView(status, ctx) {
    const {progress, progressClass, connected, nowMs} = ctx;
    const active = progressClass === Progress.RUNNING || progressClass === Progress.STALLED;
    const live = active && progress.drive && progress.drive.space ? progress.drive : null;

    return status.drives.map(drive => {
        const last = parseTimestamp(drive.last_backup_at);
        const never = Number.isNaN(last);
        const run = drive.last_run && drive.last_run.result !== 'completed' ? drive.last_run : null;
        const isLive = live !== null && live.name === drive.name;
        const space = isLive ? live.space : drive.space;

        let fill = 'Fill not measured yet';
        if (space) {
            const when = isLive ? 'live' : `measured ${formatDate(parseTimestamp(space.measured_at))}`;
            fill = `${space.capacity_pct}% used, ${formatBytes(space.available_bytes)} free, ${when}`;
        }

        return {
            name: drive.name,
            connected: connected.has(drive.drive_id),
            last: never
                ? 'Never backed up'
                : `Last backup ${formatAge(nowMs - last)} (${formatWhen(last, nowMs)})`,
            lastIsOld: never || nowMs - last > status.thresholds.rpo_warning_days * DAY_MS,
            badge: run ? BADGES[run.result] ?? `Last run: ${run.result}` : null,
            badgeAttention: run !== null && run.result !== 'aborted',
            message: run && run.message
                ? `${run.message} (${formatWhen(parseTimestamp(run.ended_at), nowMs)})`
                : null,
            fraction: space ? space.capacity_pct / 100 : 0,
            fill,
            level: space ? level(space.capacity_pct, status.thresholds) : 'unknown',
        };
    });
}

/**
 * Everything the indicator and its menu show.
 *
 * `statusShown` is the status to display: the parsed file when it reads,
 * else the last good one, else null.
 *
 * @param {object} input
 * @param {{state: string, data: object|null}} input.progressParsed
 * @param {string} input.progressClass - from classifyProgress()
 * @param {{state: string, data: object|null}} input.statusParsed
 * @param {object|null} input.statusShown
 * @param {Set<string>} input.connected - drive_id values present in /dev/disk/by-id
 * @param {boolean} input.transferSeen - this run already sent data
 * @param {number} input.nowMs - the reader's clock
 * @returns {object}
 */
export function buildView(input) {
    const {progressParsed, progressClass, statusParsed, statusShown, nowMs} = input;
    const progress = progressParsed.data;
    const indicator = indicatorState(progressClass, progress, statusParsed, nowMs);
    const ctx = {...input, progress, status: statusShown};
    const active = progressClass === Progress.RUNNING || progressClass === Progress.STALLED;

    const status = statusShown;
    return {
        indicator,
        icon: panelIcon(indicator, progress, input.transferSeen),
        headline: headline(indicator, ctx),
        notes: notes(ctx),
        run: active ? runView(ctx) : null,
        pools: status ? poolsView(status) : [],
        drives: status ? drivesView(status, ctx) : [],
        notices: status
            ? status.notices.filter(n => n.level !== 'info').map(n => ({text: n.text, level: n.level}))
            : [],
        footer: status
            ? `Status written ${formatWhen(parseTimestamp(status.generated_at), nowMs)} ` +
              `by ${status.generated_by}, zark ${status.zark_version}`
            : null,
    };
}
