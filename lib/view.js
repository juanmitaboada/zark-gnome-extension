// SPDX-License-Identifier: GPL-2.0-or-later
//
// What the panel shows, built from both status files. Pure: the shell side
// passes what it read, which drives are connected and its clock.

import {FileState, parseTimestamp} from './contract.js';
import {
    formatAge, formatBytes, formatDate, formatDuration, formatRate, formatWhen, monthNames,
} from './format.js';
import {NC_, N_, _, fmt, ngettext, pgettext, tr} from './i18n.js';
import {
    Indicator, Progress, indicatorState, isStale, ringSectors, transferEta, transferProgress,
} from './state.js';
import {Segment, ownBytes, poolUsage, reservedBytes} from './usage.js';

const DAY_MS = 86400000;

const NEWER_NOTE = N_('zark wrote its status in a newer format. This shows the last state it could read; ' +
    'update the extension.');

const BADGES = {
    incomplete: N_('Last run incomplete'),
    not_verified: N_('Last run not verified'),
    interrupted: N_('Last run interrupted'),
    aborted: N_('Last run aborted'),
};

// The legend of a pool's usage bar: what each part of the space holds.
const SEGMENT_LABELS = {
    [Segment.USER_DATA]: N_('User data'),
    [Segment.USER_SNAPSHOTS]: N_('User snapshots'),
    // Translators: the system's data (the root and boot datasets), a part of a pool's usage bar
    [Segment.SYSTEM_DATA]: N_('System'),
    [Segment.SYSTEM_SNAPSHOTS]: N_('System snapshots'),
    [Segment.OTHER]: N_('Other datasets'),
    [Segment.METADATA]: N_('Pool metadata'),
    // Translators: free space, a part of a usage bar
    [Segment.FREE]: NC_('free space', 'Free'),
    // Translators: ZFS is a name; space the file system keeps for itself
    [Segment.RESERVED]: N_('Reserved by ZFS'),
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
            .map(s => ({id: s.id, label: tr(SEGMENT_LABELS[s.id]), size: formatBytes(s.bytes)})),
        snapshots: fmt(_('Snapshots hold {size}, {percent}% of the space in use'),
            {size: formatBytes(usage.snapshots), percent: snapshotShare}),
        bySize,
        bySnapshots: usage.mostSnapshots.filter(d => ownBytes(d) > 0).map(datasetRow),
        datasetCount: usage.datasetCount,
        note: fmt(ngettext(
            "Snapshots: what removing all of a dataset's snapshots would free. " +
                '{shown} of {n} dataset; measured {when} by zark.',
            "Snapshots: what removing all of a dataset's snapshots would free. " +
                '{shown} of {n} datasets; measured {when} by zark.',
            usage.datasetCount),
        {shown: bySize.length, n: usage.datasetCount, when: formatWhen(parseTimestamp(pool.space.measured_at), nowMs)}),
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
        return _('Waiting for your answer in the terminal');
    case Indicator.RUNNING:
        if (progress.command !== 'backup')
            // Translators: {command} is zark's subcommand as typed, such as prune
            return fmt(_('zark {command} is running'), {command: progress.command});
        return progress.drive ? fmt(_('Backing up to {drive}'), {drive: progress.drive.name}) : _('Backup starting');
    case Indicator.ATTENTION: {
        const drive = status.drives.find(d => d.last_run && BADGES[d.last_run.result] &&
            d.last_run.result !== 'aborted');
        if (drive)
            return fmt(_('Last backup to {drive} needs attention'), {drive: drive.name});
        const critical = status.notices.find(n => n.level === 'critical');
        return capitalise(critical.text);
    }
    case Indicator.EDGE:
        if (statusParsed.state === FileState.NEWER)
            return _('Status written by a newer zark');
        if (statusParsed.state === FileState.UNREADABLE)
            return _('The status file cannot be read');
        if (status && isStale(status, nowMs)) {
            // Translators: {when} is "today 09:18", "yesterday 23:50" or "24 Oct 09:18"
            return fmt(_('Status not refreshed since {when}'),
                {when: formatWhen(parseTimestamp(status.generated_at), nowMs)});
        }
        if (progressClass === Progress.ORPHAN)
            return _('The last zark run ended abnormally');
        return _('zark is running; its progress cannot be read');
    case Indicator.NONE:
        return _('No status from zark yet');
    default: {
        const newest = status ? newestBackup(status) : null;
        if (!newest)
            return _('No backup yet');
        const values = {age: formatAge(nowMs - newest.at), drive: newest.name};
        return indicator === Indicator.OVERDUE
            ? fmt(_('Backup overdue, last one {age} on {drive}'), values)
            : fmt(_('Backups up to date, last one {age} on {drive}'), values);
    }
    }
}

function notes(ctx) {
    const {progress, progressClass, statusParsed, status, nowMs} = ctx;
    const out = [];
    if (statusParsed.state === FileState.NEWER)
        out.push(_(NEWER_NOTE));
    if (statusParsed.state === FileState.UNREADABLE)
        out.push(_('The status file exists but does not parse. This shows the last state it could read.'));
    if (statusParsed.state === FileState.ABSENT)
        out.push(_('zark 2.1 or later writes its status at the end of every run and from its hourly timer.'));
    if (status && isStale(status, nowMs))
        out.push(_('Is the zark alerts timer installed? The figures below are as old as their dates say.'));
    if (progressClass === Progress.ORPHAN)
        out.push(stoppedAnswering(progress, nowMs));
    if (progressClass === Progress.UNKNOWN)
        out.push(_('The progress file does not parse or comes from a newer zark.'));
    return out;
}

function runTitle(progress) {
    if (progress.command !== 'backup')
        return fmt(_('zark {command}'), {command: progress.command});
    if (progress.drive)
        return fmt(_('Backup to {drive}'), {drive: progress.drive.name});
    // Translators: a noun, the title of a running backup whose drive is not known yet
    return pgettext('run title', 'Backup');
}

/**
 * The sentence for a run left behind, as the menu's note and the notification
 * say it.
 *
 * @param {object} progress - progress.json's data
 * @param {number} nowMs - the reader's clock
 * @returns {string}
 */
export function stoppedAnswering(progress, nowMs) {
    const values = {
        command: progress.command,
        drive: progress.drive?.name,
        when: formatWhen(parseTimestamp(progress.updated_at), nowMs),
    };
    return progress.drive
        ? fmt(_('zark {command} to {drive} stopped answering at {when}. The next zark command records it.'), values)
        : fmt(_('zark {command} stopped answering at {when}. The next zark command records it.'), values);
}

/**
 * A backup's drive_gone (zark 2.3.1): set once the run's drive went away.
 *
 * @param {object|null} progress - progress.json's data
 * @returns {object|null} the drive_gone object, or null
 */
export function driveGoneOf(progress) {
    const gone = progress?.command === 'backup' ? progress.drive_gone : null;
    return gone !== null && typeof gone === 'object' && !Array.isArray(gone) ? gone : null;
}

/**
 * @param {object} gone - drive_gone
 * @param {number} nowMs - the reader's clock
 * @returns {string} the menu's line, e.g. "Drive went away today 09:18; see zark's terminal"
 */
function driveGoneLine(gone, nowMs) {
    const since = parseTimestamp(gone.since);
    if (Number.isNaN(since))
        return _("Drive went away; see zark's terminal");
    return fmt(_("Drive went away {when}; see zark's terminal"), {when: formatWhen(since, nowMs)});
}

function runView(ctx) {
    const {progress, progressClass, nowMs} = ctx;
    const stalled = progressClass === Progress.STALLED;
    const run = {
        title: runTitle(progress),
        // Translators: {duration} is "5 min", "1 h 12 min" or "under a minute"
        elapsed: fmt(_('running for {duration}'),
            {duration: formatDuration((nowMs - parseTimestamp(progress.started_at)) / 1000)}),
        step: progress.step
            // Translators: {label} is zark's own English text for the step
            ? fmt(_('Step {index} of {total}: {label}'),
                {index: progress.step.index, total: progress.step.total, label: progress.step.label})
            : null,
        waitingFor: progress.waiting_for_input ? progress.waiting_for : null,
        driveGone: driveGoneOf(progress) ? driveGoneLine(driveGoneOf(progress), nowMs) : null,
        stalled: stalled
            ? fmt(_('No update for {seconds} s. zark is still running; the figures below are not current.'),
                {seconds: Math.round((nowMs - parseTimestamp(progress.updated_at)) / 1000)})
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
        : _('Between datasets');
    run.fraction = transferProgress(transfer).fraction;

    const parts = [];
    if (transfer.bytes_done !== null) {
        const values = {done: formatBytes(transfer.bytes_done), total: formatBytes(transfer.bytes_total)};
        if (transfer.bytes_total === null)
            parts.push(values.done);
        else if (transfer.bytes_total_partial)
            parts.push(fmt(_('{done} of at least {total}'), values));
        else
            parts.push(fmt(_('{done} of {total}'), values));
    }
    if (transfer.rate_bytes_per_s !== null)
        parts.push(formatRate(transfer.rate_bytes_per_s));
    const eta = transferEta(transfer);
    if (eta !== null && eta >= 60)
        // Translators: one part of a comma-separated line: "7.0 GiB of 17.0 GiB, 107.0 MiB/s, about 5 min left"
        parts.push(fmt(_('about {duration} left'), {duration: formatDuration(eta)}));
    else if (eta > 0)
        parts.push(_('under a minute left'));
    else if (eta !== null)
        // Translators: the transfer is ending; one part of a comma-separated line
        parts.push(_('finishing'));
    run.figures = parts.length ? parts.join(', ') : null;

    const counts = {done: transfer.datasets_done, total: transfer.datasets_total, failed: transfer.datasets_failed};
    run.transfers = transfer.datasets_failed
        // Translators: {failed} picks the plural form; {done} and {total} count datasets
        ? fmt(ngettext('Transfers: {done} of {total} done, {failed} failed',
            'Transfers: {done} of {total} done, {failed} failed', transfer.datasets_failed), counts)
        : fmt(_('Transfers: {done} of {total} done'), counts);
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
        if (!pool.space) {
            return {
                tab,
                name: pool.name,
                // Translators: said of a pool whose figures zark could not read
                label: _('Could not be read'),
                fraction: 0,
                level: 'unknown',
                segments: null,
            };
        }
        const space = pool.space;
        const usage = poolUsage(pool);
        return {
            tab,
            name: pool.name,
            label: fmt(_('{percent}% used, {size} free'),
                {percent: space.capacity_pct, size: formatBytes(space.available_bytes)}),
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
            last: never ? _('Never backed up') : fmt(_('Last backup {age}'), {age: formatAge(nowMs - last)}),
            lastIsOld: never || nowMs - last > status.thresholds.rpo_warning_days * DAY_MS,
            fill: space
                ? fmt(_('{percent}%, {size} free'),
                    {percent: space.capacity_pct, size: formatBytes(space.available_bytes)})
                : _('Not measured yet'),
            badge: run ? badge(run.result) : null,
            badgeAttention: run !== null && run.result !== 'aborted',
            fraction: space ? space.capacity_pct / 100 : 0,
            level: space ? level(space.capacity_pct, status.thresholds) : 'unknown',
        };
    });
}

// zark's result names; one zark adds later is shown as zark writes it.
const RESULTS = {
    // Translators: the result of a backup run, placed in "{result}, {when}, took {duration}"
    completed: N_('completed'),
    // Translators: the result of a backup run, placed in "{result}, {when}, took {duration}"
    incomplete: N_('incomplete'),
    // Translators: the result of a backup run, placed in "{result}, {when}, took {duration}"
    not_verified: N_('not verified'),
    // Translators: the result of a backup run, placed in "{result}, {when}, took {duration}"
    aborted: N_('aborted'),
    // Translators: the result of a backup run, placed in "{result}, {when}, took {duration}"
    interrupted: N_('interrupted'),
};

function resultText(result) {
    return RESULTS[result] ? _(RESULTS[result]) : result;
}

function badge(result) {
    if (BADGES[result])
        return _(BADGES[result]);
    // Translators: {result} is a result name zark wrote that this version does not know, in English
    return fmt(_('Last run: {result}'), {result});
}

// Shown commands stay as typed in every language: a sentence takes them as a
// placeholder.
export const BACKUP_COMMAND = 'sudo zark backup';
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
        return {...tab, summary: _('Could not be read'), usage: null};
    return {
        ...tab,
        summary: fmt(_('{percent}% used of {size}'),
            {percent: pool.space.capacity_pct, size: formatBytes(pool.space.pool_size_bytes)}),
        usage: usageView(pool, nowMs),
    };
}

function retentionText(retention) {
    const parts = [fmt(ngettext('{n}-day window', '{n}-day window', retention.window_days),
        {n: retention.window_days})];
    if (retention.max_age_days) {
        parts.push(fmt(ngettext('nothing older than {n} day', 'nothing older than {n} days', retention.max_age_days),
            {n: retention.max_age_days}));
    }
    parts.push(fmt(_('{percent}% margin'), {percent: retention.margin_pct}));
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
        // Translators: {label} is zark's English text for the step; the whole fills {step} and {where} below
        ? fmt(_('step {index} of {total}, {label}'),
            {index: progress.step.index, total: progress.step.total, label: progress.step.label})
        // Translators: the run has not reached its first step; fills {step} and {where} below
        : _('starting');
    const transfer = progress.transfer ? transferProgress(progress.transfer) : null;
    const where = transfer
        // Translators: {step} is "step 7 of 9, <zark's label>" or "starting"; fills {where} below
        ? fmt(_('{step}, {percent}% sent'), {step, percent: Math.floor(transfer.fraction * 100)})
        : step;
    // Translators: a noun, the title of the row for the command running on this drive
    const label = pgettext('running command', 'Run');
    const gone = driveGoneOf(progress);
    if (gone && (progressClass === Progress.RUNNING || progressClass === Progress.STALLED))
        return {label, value: driveGoneLine(gone, nowMs), style: 'warning'};
    switch (progressClass) {
    case Progress.ORPHAN:
        return {
            label,
            value: fmt(_('Stopped answering at {when}; the next zark command records it as interrupted'),
                {when: formatWhen(updated, nowMs)}),
            style: 'warning',
        };
    case Progress.STALLED:
        return {
            label,
            // Translators: {where} is "step 7 of 9, <zark's label>, 40% sent" or "starting"
            value: fmt(_('No update for {seconds} s: {where}'),
                {seconds: Math.round((nowMs - updated) / 1000), where}),
            style: 'warning',
        };
    case Progress.RUNNING:
        if (progress.waiting_for_input) {
            return {
                label,
                // Translators: {question} is zark's own English question, or the step
                value: fmt(_('Waiting for your answer: {question}'), {question: progress.waiting_for ?? step}),
                style: 'waiting',
            };
        }
        // Translators: {where} is "step 7 of 9, <zark's label>, 40% sent" or "starting"
        return {label, value: fmt(_('Running: {where}'), {where}), style: null};
    default:
        return null;
    }
}

/**
 * The free space a backup tries to leave on a drive, as zark computes it.
 *
 * @param {object} space - the drive's Space object
 * @param {object} retention - the drive's policy
 * @returns {number} bytes
 */
export function marginBytes(space, retention) {
    return Math.floor((space.used_bytes + space.available_bytes) * retention.margin_pct / 100);
}

// Fewer rows than a pool's table: the drive tab also holds the points chart.
const DRIVE_ROWS = 8;

// "2026-09", the UTC month the contract groups points by.
function utcMonth(ms) {
    const d = new Date(ms);
    const m = d.getUTCMonth() + 1;
    return `${d.getUTCFullYear()}-${m < 10 ? '0' : ''}${m}`;
}

function monthLabel(month) {
    const [year, m] = month.split('-');
    return fmt(_('{month} {year}'), {month: monthNames()[Number(m) - 1], year});
}

// Every month from `first` to `last`, both "YYYY-MM".
function monthRange(first, last) {
    const out = [];
    let [y, m] = first.split('-').map(Number);
    const [ly, lm] = last.split('-').map(Number);
    while (y < ly || (y === ly && m <= lm)) {
        out.push(`${y}-${m < 10 ? '0' : ''}${m}`);
        m++;
        if (m > 12) {
            y++;
            m = 1;
        }
    }
    return out;
}

// A month's "frees if older removed": the cumulative figure, "not measured"
// for a null one, nothing for a month with no entry.
function olderFigure(byAge, month) {
    if (byAge === null || !byAge.has(month))
        return {olderBytes: null, older: ''};
    const bytes = byAge.get(month);
    if (bytes === null)
        // Translators: a table cell: zark did not measure this figure
        return {olderBytes: bytes, older: _('not measured')};
    return {olderBytes: bytes, older: formatBytes(bytes)};
}

/**
 * What a drive holds and what its policy removes next, from the drive
 * contents fields; null when the drive carries none of them.
 *
 * @param {object} drive - a drive entry of status.json
 * @param {object} ctx - buildView()'s input
 * @returns {object|null}
 */
export function driveContents(drive, ctx) {
    const {nowMs} = ctx;
    const {points, datasets, retention_next: next} = drive;
    const space = drive.space;
    if (!space || (!points && !datasets && !next))
        return null;
    const measured = parseTimestamp(space.measured_at);
    const out = {
        months: null, monthsNote: null, older: false, summary: null, next: null,
        afterPolicy: null, datasets: null, otherSnapshots: null,
    };

    if (Array.isArray(points) && points.length) {
        const byMonth = new Map();
        for (const point of points) {
            const month = utcMonth(parseTimestamp(point.created_at));
            const entry = byMonth.get(month) ?? {count: 0, bytes: 0};
            entry.count++;
            entry.bytes += point.used_bytes;
            byMonth.set(month, entry);
        }
        const going = new Set((next?.points ?? []).map(name => {
            const point = points.find(p => p.name === name);
            return point ? utcMonth(parseTimestamp(point.created_at)) : null;
        }));
        const first = utcMonth(parseTimestamp(points[0].created_at));
        const most = Math.max(1, ...[...byMonth.values()].map(e => e.bytes));
        // The row of month M shows the entry whose `before` is M (contract,
        // "Reading the drive contents"); a month with none gets no figure.
        const byAge = Array.isArray(drive.reclaim_by_age)
            ? new Map(drive.reclaim_by_age.map(e => [e.before, e.reclaim_bytes]))
            : null;
        out.months = monthRange(first, utcMonth(measured)).map(month => {
            const bytes = byMonth.get(month)?.bytes ?? 0;
            return {
                month,
                label: monthLabel(month),
                count: byMonth.get(month)?.count ?? 0,
                bytes,
                size: bytes ? formatBytes(bytes) : '-',
                fraction: bytes / most,
                next: going.has(month),
                ...olderFigure(byAge, month),
            };
        });
        // With "Frees if older removed" the bar, under its title, draws that
        // figure; a month without one (no entry, not measured) gets no bar.
        if (byAge !== null) {
            const measuredOlder = out.months.map(m => m.olderBytes).filter(b => b !== null);
            const mostOlder = Math.max(1, ...measuredOlder);
            for (const m of out.months)
                m.fraction = m.olderBytes === null ? null : m.olderBytes / mostOlder;
        }
        out.older = byAge !== null;
        out.monthsNote = byAge
            ? fmt(_('Frees if older removed, and its bar: what removing every older point zark would remove ' +
                "frees, as measured {when}. Held alone: what a month's points hold that no other snapshot " +
                'shares; those figures do not add up.'), {when: formatWhen(measured, nowMs)})
            : _("Held alone: what a month's points hold that no other snapshot shares. " +
                'Removing several months frees more than their sum.');
        const oldest = parseTimestamp(points[0].created_at);
        // Translators: backup points on the drive; {date} is "{day} {month}", as "19 Oct"
        out.summary = fmt(ngettext('{n} point, oldest {date} {year}', '{n} points, oldest {date} {year}',
            points.length), {n: points.length, date: formatDate(oldest), year: new Date(oldest).getFullYear()});
    }

    if (next) {
        const late = nowMs > measured + next.horizon_days * DAY_MS;
        const count = next.points.length;
        if (count === 0) {
            out.next = _("The next backup's retention removes no point");
        } else {
            const names = Array.isArray(points)
                ? next.points.map(n => points.find(p => p.name === n)).filter(p => p)
                : [];
            // Past the horizon the figure is only a floor (contract, "retention_next").
            let text = late
                ? fmt(ngettext("The next backup's retention removes at least {n} point",
                    "The next backup's retention removes at least {n} points", count), {n: count})
                : fmt(ngettext("The next backup's retention removes {n} point",
                    "The next backup's retention removes {n} points", count), {n: count});
            if (names.length) {
                // Translators: {sentence} is "The next backup's retention removes 3 points";
                // {first} and {last} are dates as "19 Oct"
                text = fmt(_('{sentence} ({first} to {last})'), {
                    sentence: text,
                    first: formatDate(parseTimestamp(names[0].created_at)),
                    last: formatDate(parseTimestamp(names[names.length - 1].created_at)),
                });
            }
            if (next.reclaim_bytes !== null) {
                // Translators: {sentence} is "The next backup's retention removes 3 points (19 Oct to 24 Oct)"
                text = fmt(_('{sentence}, freeing about {size}'),
                    {sentence: text, size: formatBytes(next.reclaim_bytes)});
            }
            out.next = text;
        }
        if (next.reclaim_bytes !== null)
            out.afterPolicy = space.available_bytes + next.reclaim_bytes;
    }

    if (Array.isArray(datasets) && datasets.length) {
        const own = d => ownBytes(d) > 0;
        const bySize = [...datasets].filter(own).sort((a, b) => ownBytes(b) - ownBytes(a)).slice(0, DRIVE_ROWS);
        const bySnapshots = [...datasets].filter(own)
            .sort((a, b) => b.usedbysnapshots_bytes - a.usedbysnapshots_bytes).slice(0, DRIVE_ROWS);
        out.datasets = {
            bySize: bySize.map(datasetRow),
            bySnapshots: bySnapshots.map(datasetRow),
            count: datasets.length,
            note: fmt(ngettext('{shown} of {n} dataset on the drive; measured {when} by zark.',
                '{shown} of {n} datasets on the drive; measured {when} by zark.', datasets.length),
            {shown: bySize.length, n: datasets.length, when: formatWhen(measured, nowMs)}),
        };
    }

    const other = drive.non_point_snapshots;
    if (other) {
        out.otherSnapshots = fmt(_('Also {intermediate} intermediate snapshots ({intermediateSize}), ' +
            'removed with their points, and {other} other snapshots ({otherSize}), which it never removes'), {
            intermediate: other.intermediate.count,
            intermediateSize: formatBytes(other.intermediate.used_bytes),
            other: other.other.count,
            otherSize: formatBytes(other.other.used_bytes),
        });
    }
    return out;
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
        label: _('Last backup'),
        value: never
            // Translators: the drive's last backup: there was none
            ? _('Never')
            // Translators: {age} is "3 hours ago"; {when} is "today 09:18", "yesterday 23:50" or "24 Oct 09:18"
            : fmt(_('{age}, {when}'), {age: formatAge(nowMs - last), when: formatWhen(last, nowMs)}),
        style: never || nowMs - last > status.thresholds.rpo_warning_days * DAY_MS ? 'warning' : null,
    });
    if (drive.last_backup_point)
        rows.push({label: _('Backup point'), value: drive.last_backup_point, style: 'mono'});
    const run = drive.last_run;
    if (run) {
        const started = parseTimestamp(run.started_at);
        const ended = parseTimestamp(run.ended_at);
        const took = formatDuration((ended - started) / 1000);
        const attention = ['incomplete', 'not_verified', 'interrupted'].includes(run.result);
        rows.push({
            label: _('Last run'),
            // Translators: {result} is "completed", "not verified" and the like, said of the run
            value: fmt(_('{result}, {when}, took {duration}'),
                {result: resultText(run.result), when: formatWhen(started, nowMs), duration: took}),
            style: attention ? 'critical' : null,
        });
        if (run.message)
            rows.push({label: '', value: run.message, style: attention ? 'critical' : null});
    }
    rows.push({label: _('Retention'), value: retentionText(drive.retention), style: null});
    const margin = space ? marginBytes(space, drive.retention) : null;
    if (space) {
        const above = space.available_bytes >= margin;
        rows.push({
            // Translators: the free space zark keeps on the drive before a backup
            label: _('Margin'),
            value: fmt(above
                ? _('{free} free, above the {margin} zark keeps free before a backup')
                : _('{free} free, below the {margin} zark keeps free before a backup'),
            {free: formatBytes(space.available_bytes), margin: formatBytes(margin)}),
            style: above ? 'ok' : 'warning',
        });
    }
    const contents = driveContents(drive, ctx);
    if (contents?.afterPolicy !== null && contents?.afterPolicy !== undefined) {
        const above = contents.afterPolicy >= margin;
        rows.push({
            label: _('After retention'),
            value: fmt(_("about {free} free once the next backup's retention has run"),
                {free: formatBytes(contents.afterPolicy)}),
            style: above ? 'ok' : 'warning',
        });
    }
    rows.push({
        // Translators: whether zark powers the drive down at the end of a backup; the value is yes or no
        label: _('Ejects itself'),
        value: drive.autoeject
            // Translators: the value of "Ejects itself"
            ? pgettext('ejects itself', 'yes')
            // Translators: the value of "Ejects itself"
            : pgettext('ejects itself', 'no'),
        style: null,
    });

    let fill = _('Fill not measured yet');
    let segments = null;
    let marker = null;
    let legend = null;
    if (space) {
        const reserved = reservedBytes(space);
        const values = {percent: space.capacity_pct, size: formatBytes(space.pool_size_bytes)};
        fill = live
            ? fmt(_('{percent}% used of {size}; live'), values)
            : fmt(_('{percent}% used of {size}; measured {when}'),
                {...values, when: formatWhen(parseTimestamp(space.measured_at), nowMs)});
        legend = [
            // Translators: used space, a part of the drive's bar
            {id: 'used', label: _('Used'), size: formatBytes(space.used_bytes)},
            {id: Segment.RESERVED, label: tr(SEGMENT_LABELS[Segment.RESERVED]), size: formatBytes(reserved)},
            {id: Segment.FREE, label: tr(SEGMENT_LABELS[Segment.FREE]), size: formatBytes(space.available_bytes)},
        ];
        segments = [
            // Free last, so the margin marker sits in front of it.
            {id: 'used', bytes: space.used_bytes},
            {id: Segment.RESERVED, bytes: reserved},
            {id: Segment.FREE, bytes: space.available_bytes},
        ];
        const total = space.used_bytes + reserved + space.available_bytes;
        marker = total > 0 ? Math.max(0, total - margin) / total : null;
    }

    return {
        id: `drive:${drive.name}`,
        title: drive.name,
        kind: 'drive',
        summary: isConnected
            // Translators: said of a backup drive
            ? _('Connected')
            // Translators: said of a backup drive
            : _('Not connected'),
        connected: isConnected,
        segments,
        // Where the margin starts on the bar, from the left.
        marker,
        marginBytes: margin,
        legend,
        markerLabel: space ? fmt(_('Margin: the last {size} zark keeps free'), {size: formatBytes(margin)}) : null,
        fill,
        rows,
        contents,
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
 * The About tab, last in the details dialog whether or not zark wrote a
 * status file. What dpkg says is read by the dialog when the tab is shown.
 *
 * @param {object|null} status - status.json as shown
 * @returns {object} the tab
 */
export function aboutTab(status) {
    return {
        id: 'about',
        title: _('About'),
        kind: 'about',
        status: status
            ? {version: status.zark_version, generatedAt: status.generated_at, generatedBy: status.generated_by}
            : null,
    };
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
        details: [...status ? detailsView(status, ctx) : [], aboutTab(status)],
        notices: status
            ? status.notices.filter(n => n.level !== 'info').map(n => ({text: n.text, level: n.level}))
            : [],
        footer: status
            // Translators: {who} is zark's own word for what wrote it (timer, backup, ...), in English
            ? fmt(_('Status written {when} by {who}, zark {version}'), {
                when: formatWhen(parseTimestamp(status.generated_at), nowMs),
                who: status.generated_by,
                version: status.zark_version,
            })
            : null,
    };
}
