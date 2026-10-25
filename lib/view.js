// SPDX-License-Identifier: GPL-2.0-or-later
//
// What the panel shows, built from both status files. Pure: the shell side
// passes what it read, which drives are connected and its clock.

import {FileState, parseTimestamp} from './contract.js';
import {
    formatAge, formatBytes, formatDuration, formatRate, formatWhen,
} from './format.js';
import {
    Indicator, Progress, indicatorState, isStale, ringSectors, transferEta, transferProgress,
} from './state.js';
import {Segment, ownBytes, poolUsage, reservedBytes} from './usage.js';

const DAY_MS = 86400000;

const NEWER_NOTE = 'zark wrote its status in a newer format. This shows the last state it could read; ' +
    'update the extension.';

const BADGES = {
    incomplete: 'Last run incomplete',
    not_verified: 'Last run not verified',
    interrupted: 'Last run interrupted',
    aborted: 'Last run aborted',
};

const SEGMENT_LABELS = {
    [Segment.USER_DATA]: 'User data',
    [Segment.USER_SNAPSHOTS]: 'User snapshots',
    [Segment.SYSTEM_DATA]: 'System',
    [Segment.SYSTEM_SNAPSHOTS]: 'System snapshots',
    [Segment.OTHER]: 'Other datasets',
    [Segment.FREE]: 'Free',
    [Segment.RESERVED]: 'Reserved by ZFS',
};

/**
 * Panel icon for a state.
 *
 * `pulse` asks for the next sector to beat while data moves, so a transfer
 * that has barely started still shows activity.
 *
 * @param {string} indicator - an Indicator value
 * @param {object|null} progress - the parsed progress.json
 * @param {boolean} transferSeen - this run already sent data
 * @param {boolean} [stalled] - the heartbeat stopped
 * @returns {{kind: string, sectors: number, pulse: boolean}} kind:
 *   'symbolic', 'progress' or 'waiting'
 */
export function panelIcon(indicator, progress, transferSeen, stalled = false) {
    if (indicator === Indicator.WAITING)
        return {kind: 'waiting', sectors: 0, pulse: false};
    if (indicator !== Indicator.RUNNING)
        return {kind: 'symbolic', sectors: 0, pulse: false};

    const transfer = transferProgress(progress.transfer);
    if (transfer) {
        const sectors = ringSectors(transfer.fraction);
        return {kind: 'progress', sectors, pulse: !stalled && sectors < 8};
    }
    // After the transfer a backup verifies and exports: the data is sent.
    return {kind: 'progress', sectors: transferSeen ? 8 : 0, pulse: false};
}

/**
 * The icon files the panel cycles through for an icon, one a second.
 *
 * A beat starts on the frame with the next sector white: when a sector
 * fills, the one after it lights up at once instead of a second later.
 *
 * @param {{kind: string, sectors: number, pulse: boolean}} icon - from panelIcon()
 * @returns {string[]} icon names, without the .svg
 */
export function iconFrames(icon) {
    if (icon.kind === 'waiting')
        return ['zark-waiting-on', 'zark-waiting-off'];
    if (icon.kind === 'progress') {
        const base = `zark-progress-${icon.sectors}`;
        return icon.pulse ? [`${base}-next`, base] : [base];
    }
    return ['zark-symbolic'];
}

/**
 * The disk usage of a source pool, or null without a dataset list.
 *
 * @param {object} pool - a source pool entry of status.json
 * @param {number} nowMs - the reader's clock
 * @returns {object|null}
 */
export function usageView(pool, nowMs) {
    const usage = poolUsage(pool);
    if (!usage)
        return null;
    const snapshotShare = Math.round(usage.snapshotShare * 100);
    const bySize = usage.largest.filter(d => ownBytes(d) > 0).map(datasetRow);
    return {
        segments: usage.segments,
        // Empty parts say nothing (bpool has no user data); Free stays, even at zero.
        legend: usage.segments.filter(s => s.bytes > 0 || s.id === Segment.FREE)
            .map(s => ({id: s.id, label: SEGMENT_LABELS[s.id], size: formatBytes(s.bytes)})),
        snapshots: `Snapshots hold ${formatBytes(usage.snapshots)}, ${snapshotShare}% of the space in use`,
        bySize,
        bySnapshots: usage.mostSnapshots.filter(d => ownBytes(d) > 0).map(datasetRow),
        datasetCount: usage.datasetCount,
        note: "Snapshots: what removing all of a dataset's snapshots would free. " +
            `${bySize.length} of ${usage.datasetCount} datasets; ` +
            `measured ${formatWhen(parseTimestamp(pool.space.measured_at), nowMs)} by zark.`,
    };
}

function sizeOrDash(bytes) {
    return bytes > 0 ? formatBytes(bytes) : '-';
}

/**
 * A row of the datasets table. The name loses the pool; `prefix` is the part
 * many rows share (the top dataset and, below it, the boot environment or
 * home), shown dimmed so the rest stands out.
 *
 * @param {object} dataset - a `datasets` entry
 * @returns {{prefix: string, name: string, data: string, snapshots: string}}
 */
export function datasetRow(dataset) {
    const parts = dataset.name.split('/').slice(1);
    if (!parts.length)
        parts.push(dataset.name);
    const shared = parts.length >= 3 ? 2 : parts.length - 1;
    return {
        prefix: shared > 0 ? `${parts.slice(0, shared).join('/')}/` : '',
        name: parts.slice(shared).join('/'),
        data: sizeOrDash(dataset.usedbydataset_bytes + dataset.usedbyrefreservation_bytes),
        snapshots: sizeOrDash(dataset.usedbysnapshots_bytes),
    };
}

/**
 * @param {object} status - status.json
 * @returns {{at: number, name: string}|null} the newest completed backup
 */
export function newestBackup(status) {
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
        const tab = `pool:${pool.name}`;
        if (!pool.space)
            return {tab, name: pool.name, label: 'Could not be read', fraction: 0, level: 'unknown', segments: null};
        const space = pool.space;
        const usage = poolUsage(pool);
        return {
            tab,
            name: pool.name,
            label: `${space.capacity_pct}% used, ${formatBytes(space.available_bytes)} free`,
            fraction: space.capacity_pct / 100,
            level: pool.level ?? level(space.capacity_pct, status.thresholds),
            segments: usage ? usage.segments : null,
        };
    });
}

// The drive's space: as measured, or live from the run writing to it.
function driveSpace(drive, ctx) {
    const {progress, progressClass} = ctx;
    const active = progressClass === Progress.RUNNING || progressClass === Progress.STALLED;
    if (active && progress.drive && progress.drive.space && progress.drive.name === drive.name)
        return {space: progress.drive.space, live: true};
    return {space: drive.space, live: false};
}

function drivesView(status, ctx) {
    const {connected, nowMs} = ctx;
    return status.drives.map(drive => {
        const last = parseTimestamp(drive.last_backup_at);
        const never = Number.isNaN(last);
        const run = drive.last_run && drive.last_run.result !== 'completed' ? drive.last_run : null;
        const {space} = driveSpace(drive, ctx);
        return {
            tab: `drive:${drive.name}`,
            name: drive.name,
            connected: connected.has(drive.drive_id),
            last: never ? 'Never backed up' : `Last backup ${formatAge(nowMs - last)}`,
            lastIsOld: never || nowMs - last > status.thresholds.rpo_warning_days * DAY_MS,
            fill: space
                ? `${space.capacity_pct}%, ${formatBytes(space.available_bytes)} free`
                : 'Not measured yet',
            badge: run ? BADGES[run.result] ?? `Last run: ${run.result}` : null,
            badgeAttention: run !== null && run.result !== 'aborted',
            fraction: space ? space.capacity_pct / 100 : 0,
            level: space ? level(space.capacity_pct, status.thresholds) : 'unknown',
        };
    });
}

const RESULTS = {
    completed: 'completed',
    incomplete: 'incomplete',
    not_verified: 'not verified',
    aborted: 'aborted',
    interrupted: 'interrupted',
};

export const PRUNE_COMMAND = 'sudo zark prune';

// zark's notices about cleaning a source pool: its capacity, and the
// snapshots in the origin no drive needs (no subject: shown with rpool).
function cleanupNotices(pool, status) {
    return status.notices
        .filter(n => (n.code === 'capacity' && n.subject === pool.name) ||
            (n.code === 'origin_residues' && pool.name === 'rpool'))
        .map(n => ({text: n.text, level: n.level}));
}

function poolTab(pool, status, nowMs) {
    const tab = {id: `pool:${pool.name}`, title: pool.name, kind: 'pool', cleanup: cleanupNotices(pool, status)};
    if (!pool.space)
        return {...tab, summary: 'Could not be read', usage: null};
    return {
        ...tab,
        summary: `${pool.space.capacity_pct}% used of ${formatBytes(pool.space.pool_size_bytes)}`,
        usage: usageView(pool, nowMs),
    };
}

function retentionText(retention) {
    const parts = [`${retention.window_days}-day window`];
    if (retention.max_age_days)
        parts.push(`nothing older than ${retention.max_age_days} days`);
    parts.push(`${retention.margin_pct}% margin`);
    return parts.join(', ');
}

// The run progress.json describes, when it writes to this drive. status.json
// only learns of a run when it ends, or at the next zark command for one
// left behind.
function driveRunRow(drive, ctx) {
    const {progress, progressClass, nowMs} = ctx;
    if (!progress || !progress.drive || progress.drive.name !== drive.name)
        return null;
    const updated = parseTimestamp(progress.updated_at);
    const step = progress.step
        ? `step ${progress.step.index} of ${progress.step.total}, ${progress.step.label}`
        : 'starting';
    const transfer = progress.transfer ? transferProgress(progress.transfer) : null;
    const sent = transfer ? `, ${Math.floor(transfer.fraction * 100)}% sent` : '';
    switch (progressClass) {
    case Progress.ORPHAN:
        return {
            label: 'Run',
            value: `Stopped answering at ${formatWhen(updated, nowMs)}; ` +
                'the next zark command records it as interrupted',
            style: 'warning',
        };
    case Progress.STALLED:
        return {
            label: 'Run',
            value: `No update for ${Math.round((nowMs - updated) / 1000)} s: ${step}${sent}`,
            style: 'warning',
        };
    case Progress.RUNNING:
        if (progress.waiting_for_input) {
            return {
                label: 'Run',
                value: `Waiting for your answer: ${progress.waiting_for ?? step}`,
                style: 'waiting',
            };
        }
        return {label: 'Run', value: `Running: ${step}${sent}`, style: null};
    default:
        return null;
    }
}

function driveTab(drive, status, ctx) {
    const {connected, nowMs} = ctx;
    const {space, live} = driveSpace(drive, ctx);
    const last = parseTimestamp(drive.last_backup_at);
    const never = Number.isNaN(last);
    const isConnected = connected.has(drive.drive_id);

    const rows = [];
    const runRow = driveRunRow(drive, ctx);
    if (runRow)
        rows.push(runRow);
    rows.push({
        label: 'Last backup',
        value: never ? 'Never' : `${formatAge(nowMs - last)}, ${formatWhen(last, nowMs)}`,
        style: never || nowMs - last > status.thresholds.rpo_warning_days * DAY_MS ? 'warning' : null,
    });
    if (drive.last_backup_point)
        rows.push({label: 'Backup point', value: drive.last_backup_point, style: 'mono'});
    const run = drive.last_run;
    if (run) {
        const started = parseTimestamp(run.started_at);
        const ended = parseTimestamp(run.ended_at);
        const took = formatDuration((ended - started) / 1000);
        const attention = ['incomplete', 'not_verified', 'interrupted'].includes(run.result);
        rows.push({
            label: 'Last run',
            value: `${RESULTS[run.result] ?? run.result}, ${formatWhen(started, nowMs)}, took ${took}`,
            style: attention ? 'critical' : null,
        });
        if (run.message)
            rows.push({label: '', value: run.message, style: attention ? 'critical' : null});
    }
    rows.push({label: 'Retention', value: retentionText(drive.retention), style: null});
    const margin = drive.retention.margin_pct;
    if (space) {
        const free = 100 - space.capacity_pct;
        const where = free >= margin ? 'above' : 'below';
        rows.push({
            label: 'Margin',
            value: `${free}% free, ${where} the ${margin}% zark keeps before a backup`,
            style: free >= margin ? 'ok' : 'warning',
        });
    }
    rows.push({label: 'Ejects itself', value: drive.autoeject ? 'yes' : 'no', style: null});

    let fill = 'Fill not measured yet';
    let segments = null;
    if (space) {
        const reserved = reservedBytes(space);
        const when = live ? 'live' : `measured ${formatWhen(parseTimestamp(space.measured_at), nowMs)}`;
        fill = `${space.capacity_pct}% used, ${formatBytes(space.available_bytes)} free, ` +
            `${formatBytes(reserved)} reserved by ZFS; ${when}`;
        segments = [
            // Free last, so the margin marker sits in front of it.
            {id: 'used', bytes: space.used_bytes},
            {id: Segment.RESERVED, bytes: reserved},
            {id: Segment.FREE, bytes: space.available_bytes},
        ];
    }

    return {
        id: `drive:${drive.name}`,
        title: drive.name,
        kind: 'drive',
        summary: isConnected ? 'Connected' : 'Not connected',
        connected: isConnected,
        segments,
        // Where the margin starts on the bar, from the left.
        marker: space ? 1 - margin / 100 : null,
        fill,
        rows,
    };
}

/**
 * The details dialog: one tab per source pool, then one per drive.
 *
 * @param {object} status - status.json as shown
 * @param {object} ctx - buildView()'s input with `progress`
 * @returns {object[]} tabs
 */
export function detailsView(status, ctx) {
    return [
        ...status.source_pools.map(pool => poolTab(pool, status, ctx.nowMs)),
        ...status.drives.map(drive => driveTab(drive, status, ctx)),
    ];
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
        icon: panelIcon(indicator, progress, input.transferSeen, progressClass === Progress.STALLED),
        headline: headline(indicator, ctx),
        notes: notes(ctx),
        run: active ? runView(ctx) : null,
        pools: status ? poolsView(status) : [],
        drives: status ? drivesView(status, ctx) : [],
        details: status ? detailsView(status, ctx) : [],
        notices: status
            ? status.notices.filter(n => n.level !== 'info').map(n => ({text: n.text, level: n.level}))
            : [],
        footer: status
            ? `Status written ${formatWhen(parseTimestamp(status.generated_at), nowMs)} ` +
              `by ${status.generated_by}, zark ${status.zark_version}`
            : null,
    };
}
