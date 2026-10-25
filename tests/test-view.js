// SPDX-License-Identifier: GPL-2.0-or-later
//
// The menu's view model on the contract's fixtures.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {FileState, PROGRESS_KIND, STATUS_KIND, parseFile, parseTimestamp} from '../lib/contract.js';
import {Indicator, classifyProgress} from '../lib/state.js';
import {buildView, iconFrames, panelIcon} from '../lib/view.js';
import {assertEqual, assertTrue} from './harness.js';

const ROOT = GLib.build_filenamev([GLib.path_get_dirname(import.meta.url.replace('file://', '')), 'fixtures']);
const decoder = new TextDecoder();

function readText(path) {
    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null))
        return null;
    return decoder.decode(file.load_contents(null)[1]);
}

// Builds the view for a case, with the process alive when the case says so.
function view(name, {connected = [], transferSeen = false} = {}) {
    const dir = GLib.build_filenamev([ROOT, name]);
    const expected = JSON.parse(readText(`${dir}/expected.json`));
    const nowMs = parseTimestamp(expected.now);
    const progressParsed = parseFile(readText(`${dir}/run/zark/progress.json`), PROGRESS_KIND);
    const statusParsed = parseFile(readText(`${dir}/var/lib/zark/status.json`), STATUS_KIND);
    const data = progressParsed.data;
    const proc = expected.progress_process === 'alive'
        ? {bootId: data.boot_id, pidExists: true, startTicks: data.pid_start_ticks}
        : {bootId: '', pidExists: false, startTicks: null};
    return buildView({
        progressParsed,
        progressClass: classifyProgress(progressParsed, proc, nowMs),
        statusParsed,
        statusShown: statusParsed.state === FileState.OK ? statusParsed.data : null,
        connected: new Set(connected),
        transferSeen,
        nowMs,
    });
}

const CASES = GLib.file_test(ROOT, GLib.FileTest.IS_DIR)
    ? ['aborted', 'completed', 'idle', 'incomplete', 'interrupted', 'newer-schema', 'no-byte-counts',
        'no-status', 'not-verified', 'orphan', 'overdue', 'partial-estimate', 'progress-unreadable',
        'running', 'stale', 'stalled', 'waiting', 'waiting-eject']
    : [];

export const tests = [
    ['every case has an indicator, a headline and the right icon kind', () => {
        for (const name of CASES) {
            const v = view(name);
            assertTrue(v.headline.length > 0, `${name} headline`);
            const kind = {waiting: 'waiting', running: 'progress'}[v.indicator] ?? 'symbolic';
            assertEqual(v.icon.kind, kind, `${name} icon`);
        }
    }],
    ['running: ring from bytes, figures and transfers', () => {
        const v = view('running');
        assertEqual(v.indicator, Indicator.RUNNING);
        assertEqual(v.headline, 'Backing up to black');
        assertEqual(v.icon.sectors, 3);
        assertTrue(v.run.figures.startsWith('7.0 GiB of 17.0 GiB, 107.0 MiB/s, about '), v.run.figures);
        assertEqual(v.run.transfers, 'Transfers: 9 of 21 done');
        assertEqual(v.run.stalled, null);
    }],
    ['running: the next sector pulses while data moves, not when stalled', () => {
        assertEqual(view('running').icon.pulse, true);
        assertEqual(view('stalled').icon.pulse, false);
        assertEqual(view('waiting').icon.pulse, false);
    }],
    ['a beat starts with the next sector white', () => {
        assertEqual(iconFrames({kind: 'progress', sectors: 3, pulse: true}),
            ['zark-progress-3-next', 'zark-progress-3']);
        assertEqual(iconFrames({kind: 'progress', sectors: 8, pulse: false}), ['zark-progress-8']);
        assertEqual(iconFrames({kind: 'waiting', sectors: 0, pulse: false}), ['zark-waiting-on', 'zark-waiting-off']);
    }],
    ['idle: disk usage of rpool, as on carmen', () => {
        const u = view('idle').usage;
        assertEqual(u.title, 'Disk usage (rpool)');
        assertEqual(u.summary, '89% used of 936.0 GiB');
        assertEqual(u.legend.length, 7);
        assertTrue(u.snapshots.startsWith('Snapshots hold 142.'), u.snapshots);
        assertTrue(u.largest[0].name.startsWith('USERDATA/home_'), u.largest[0].name);
        assertTrue(u.largest.length > 0 && u.largest.length <= 8, 'largest');
    }],
    ['no-status: no disk usage', () => {
        assertEqual(view('no-status').usage, null);
    }],
    ['stalled: still a run, figures marked', () => {
        const v = view('stalled');
        assertEqual(v.indicator, Indicator.RUNNING);
        assertTrue(v.run.stalled.startsWith('No update for 95 s.'), v.run.stalled);
    }],
    ['no-byte-counts: dataset counts, no figures', () => {
        const v = view('no-byte-counts');
        assertEqual(v.run.figures, null);
        assertTrue(v.run.fraction > 0, 'bar from dataset counts');
    }],
    ['partial-estimate: a floor, no ETA', () => {
        const v = view('partial-estimate');
        assertTrue(v.run.figures.includes(' of at least '), v.run.figures);
        assertTrue(!v.run.figures.includes('left'), v.run.figures);
    }],
    ['waiting: the prompt is shown', () => {
        const v = view('waiting');
        assertEqual(v.headline, 'Waiting for your answer in the terminal');
        assertTrue(typeof v.run.waitingFor === 'string' && v.run.waitingFor.length > 0, 'waiting_for');
    }],
    ['waiting-eject: full ring once the data was sent', () => {
        assertEqual(panelIcon(Indicator.RUNNING, {transfer: null}, true), {kind: 'progress', sectors: 8, pulse: false});
        assertEqual(view('waiting-eject').icon.kind, 'waiting');
    }],
    ['idle: pools from the file, drives with their ages', () => {
        const v = view('idle', {connected: []});
        assertEqual(v.pools.map(p => p.level), ['warning', 'ok']);
        assertEqual(v.pools[0].label.split(',')[0], '89% used');
        const blue = v.drives.find(d => d.name === 'blue');
        assertEqual(blue.lastIsOld, true);
        assertEqual(v.notes, []);
    }],
    ['connected drives come from /dev/disk/by-id names', () => {
        const blackId = 'usb-JMicron_Generic_DISK00_0123456789ABCDEF-0:0';
        const drives = view('idle', {connected: [blackId]}).drives;
        assertEqual(drives.find(d => d.name === 'black').connected, true);
        assertEqual(drives.find(d => d.name === 'blue').connected, false);
    }],
    ['incomplete: attention with the badge and the message', () => {
        const v = view('incomplete');
        assertEqual(v.headline, 'Last backup to black needs attention');
        const black = v.drives.find(d => d.name === 'black');
        assertEqual(black.badge, 'Last run incomplete');
        assertEqual(black.badgeAttention, true);
        assertTrue(black.message !== null, 'message');
    }],
    ['aborted: badge without attention', () => {
        const black = view('aborted').drives.find(d => d.name === 'black');
        assertEqual(black.badge, 'Last run aborted');
        assertEqual(black.badgeAttention, false);
    }],
    ['edge cases explain themselves', () => {
        assertEqual(view('newer-schema').notes.length, 1);
        assertEqual(view('orphan').headline, 'The last zark run ended abnormally');
        assertTrue(view('stale').headline.startsWith('Status not refreshed since '), 'stale');
        assertEqual(view('progress-unreadable').notes.length, 1);
    }],
    ['no-status: nothing to list', () => {
        const v = view('no-status');
        assertEqual(v.indicator, Indicator.NONE);
        assertEqual(v.drives, []);
        assertEqual(v.footer, null);
    }],
];
