// SPDX-License-Identifier: GPL-2.0-or-later
//
// The contract's fixtures (zark's tests/fixtures/status/, copied into
// tests/fixtures/ by `make fixtures`), each checked against its
// expected.json. Liveness: `alive` cases take the file's own boot id, pid
// and start ticks; `dead` cases run the real checks against /proc.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {PROGRESS_KIND, STATUS_KIND, parseFile, parseTimestamp} from '../lib/contract.js';
import {formatBytes} from '../lib/format.js';
import {
    classifyProgress, classifyStatus, indicatorState, startTicksFromStat, transferEta, transferProgress,
} from '../lib/state.js';
import {Segment, ownBytes, poolUsage} from '../lib/usage.js';
import {driveContents, marginBytes} from '../lib/view.js';
import {assertEqual, assertTrue} from './harness.js';

const ROOT = GLib.build_filenamev([GLib.path_get_dirname(import.meta.url.replace('file://', '')), 'fixtures']);
const decoder = new TextDecoder();

function readText(path) {
    try {
        const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
        return decoder.decode(bytes);
    } catch (e) {
        if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return null;
        throw e;
    }
}

function realProc(pid) {
    const stat = readText(`/proc/${pid}/stat`);
    return {
        bootId: readText('/proc/sys/kernel/random/boot_id').trim(),
        pidExists: GLib.file_test(`/proc/${pid}`, GLib.FileTest.EXISTS),
        startTicks: stat === null ? null : startTicksFromStat(stat),
    };
}

function caseNames() {
    const names = [];
    const children = Gio.File.new_for_path(ROOT).enumerate_children('standard::name,standard::type',
        Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = children.next_file(null)) !== null) {
        if (info.get_file_type() === Gio.FileType.DIRECTORY)
            names.push(info.get_name());
    }
    return names.sort();
}

function checkCase(name) {
    const dir = GLib.build_filenamev([ROOT, name]);
    const expected = JSON.parse(readText(`${dir}/expected.json`));
    const now = parseTimestamp(expected.now);

    const progress = parseFile(readText(`${dir}/run/zark/progress.json`), PROGRESS_KIND);
    const status = parseFile(readText(`${dir}/var/lib/zark/status.json`), STATUS_KIND);

    let proc = {bootId: '', pidExists: false, startTicks: null};
    if (expected.progress_process === 'alive') {
        const data = progress.data;
        proc = {bootId: data.boot_id, pidExists: true, startTicks: data.pid_start_ticks};
    } else if (expected.progress_process === 'dead') {
        proc = realProc(progress.data.pid);
    }

    const progressClass = classifyProgress(progress, proc, now);
    assertEqual(progressClass, expected.progress, `${name} progress`);
    assertEqual(classifyStatus(status, now), expected.status, `${name} status`);
    assertEqual(indicatorState(progressClass, progress.data, status, now), expected.indicator, `${name} indicator`);
}

function load(name, file, kind) {
    return parseFile(readText(GLib.build_filenamev([ROOT, name, file])), kind).data;
}

const names = GLib.file_test(ROOT, GLib.FileTest.IS_DIR) ? caseNames() : [];

export const tests = [
    ['the contract has 20 cases', () => {
        assertTrue(names.length === 20, `found ${names.length} cases in ${ROOT}; run make fixtures`);
    }],
    ...names.map(name => [name, () => checkCase(name)]),
    ['idle: own shares fall short of rpool used by the pool metadata, snapshots as on carmen', () => {
        const rpool = load('idle', 'var/lib/zark/status.json', STATUS_KIND).source_pools[0];
        const usage = poolUsage(rpool);
        const shares = rpool.datasets.reduce((a, d) => a + ownBytes(d), 0);
        assertTrue(shares < rpool.space.used_bytes, 'a hidden part');
        const metadata = usage.segments.find(s => s.id === Segment.METADATA).bytes;
        assertEqual(metadata, rpool.space.used_bytes - shares);
        assertEqual(formatBytes(usage.snapshots).split('.')[0], '142');
        assertEqual(usage.segments.reduce((a, s) => a + s.bytes, 0), usage.total);
    }],
    ...['drive-contents', 'drive-contents-partial'].map(name => [`${name}: drives as expected.json says`, () => {
        const expected = JSON.parse(readText(GLib.build_filenamev([ROOT, name, 'expected.json'])));
        const status = load(name, 'var/lib/zark/status.json', STATUS_KIND);
        const ctx = {nowMs: parseTimestamp(expected.now), progress: null, progressClass: 'idle', connected: new Set()};
        for (const [driveName, want] of Object.entries(expected.drives)) {
            const drive = status.drives.find(d => d.name === driveName);
            assertEqual(marginBytes(drive.space, drive.retention), want.margin_bytes, `${name} ${driveName} margin`);
            const got = driveContents(drive, ctx);
            if (want.contents === null) {
                assertEqual(got, null, `${name} ${driveName} contents`);
                continue;
            }
            const c = want.contents;
            assertEqual(drive.points.length, c.points, `${name} ${driveName} points`);
            const months = Object.fromEntries(got.months.filter(m => m.count > 0).map(m => [m.month, m.count]));
            assertEqual(months, c.months, `${name} ${driveName} months`);
            assertEqual(drive.retention_next.points.length, c.next_points, `${name} ${driveName} next`);
            assertEqual(drive.retention_next.reclaim_bytes, c.next_reclaim_bytes, `${name} ${driveName} reclaim`);
            assertEqual(got.afterPolicy, c.available_after_policy_bytes, `${name} ${driveName} after policy`);
            assertEqual(got.datasets === null ? null : got.datasets.count, c.datasets, `${name} ${driveName} datasets`);
        }
    }]),
    ['running: bytes ring and ETA', () => {
        const {transfer} = load('running', 'run/zark/progress.json', PROGRESS_KIND);
        assertEqual(transferProgress(transfer).source, 'bytes');
        assertTrue(transferEta(transfer) > 0, 'ETA');
    }],
    ['no-byte-counts: dataset counts, no ETA', () => {
        const {transfer} = load('no-byte-counts', 'run/zark/progress.json', PROGRESS_KIND);
        assertEqual(transferProgress(transfer).source, 'datasets');
        assertEqual(transferEta(transfer), null);
    }],
    ['partial-estimate: no ETA', () => {
        const {transfer} = load('partial-estimate', 'run/zark/progress.json', PROGRESS_KIND);
        assertEqual(transferEta(transfer), null);
    }],
];
