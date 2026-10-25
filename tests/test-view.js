// SPDX-License-Identifier: GPL-2.0-or-later
//
// The menu's view model on the contract's fixtures.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {FileState, PROGRESS_KIND, STATUS_KIND, parseFile, parseTimestamp} from '../lib/contract.js';
import {Indicator, classifyProgress} from '../lib/state.js';
import {buildView, datasetRow, iconFrames, panelIcon} from '../lib/view.js';
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
    ['idle: details have a tab per pool, then per drive', () => {
        const tabs = view('idle').details;
        assertEqual(tabs.map(t => t.id), ['pool:rpool', 'pool:bpool', 'drive:black', 'drive:blue']);
        assertEqual(view('idle').pools.map(p => p.tab), ['pool:rpool', 'pool:bpool']);
        assertEqual(view('idle').drives.map(d => d.tab), ['drive:black', 'drive:blue']);
    }],
    ['idle: disk usage of rpool, as on carmen', () => {
        const rpool = view('idle').details[0];
        assertEqual(rpool.summary, '89% used of 936.0 GiB');
        const u = rpool.usage;
        assertEqual(u.legend.length, 7);
        assertTrue(u.snapshots.startsWith('Snapshots hold 142.'), u.snapshots);
        assertEqual(u.bySize[0].prefix, 'USERDATA/');
        assertTrue(u.bySize[0].name.startsWith('home_'), u.bySize[0].name);
        assertTrue(u.bySize.length > 8 && u.bySize.length <= 12, 'twelve rows at most');
        assertTrue(u.note.includes(` of ${u.datasetCount} datasets`), u.note);
    }],
    ['idle: datasets by snapshot space, for a prune', () => {
        const u = view('idle').details[0].usage;
        assertTrue(u.bySnapshots[0].name.startsWith('home_'), u.bySnapshots[0].name);
        const names = u.bySnapshots.map(r => r.prefix + r.name);
        assertTrue(names.indexOf('ROOT/ubuntu_7k2m4p/var/lib') < names.indexOf('ROOT/ubuntu_7k2m4p/var/lib/flatpak'),
            'var/lib holds more snapshots than flatpak');
    }],
    ['dataset rows: the shared part of the name dimmed, sizes or a dash', () => {
        const ds = (name, data, snaps) => ({name, usedbydataset_bytes: data, usedbysnapshots_bytes: snaps,
            usedbyrefreservation_bytes: 0});
        assertEqual(datasetRow(ds('rpool/ROOT/ubuntu_x/var/lib', 2048, 0)),
            {prefix: 'ROOT/ubuntu_x/', name: 'var/lib', data: '2.0 KiB', snapshots: '-'});
        assertEqual(datasetRow(ds('rpool/USERDATA/home_x', 0, 1024)).prefix, 'USERDATA/');
        assertEqual(datasetRow(ds('rpool/keystore', 1024, 0)).prefix, '');
        assertEqual(datasetRow(ds('rpool', 1024, 0)).name, 'rpool');
    }],
    ['idle: the rpool tab collects the cleanup notices', () => {
        const [rpool, bpool] = view('idle').details;
        assertEqual(rpool.cleanup.map(n => n.level), ['warning', 'info']);
        assertTrue(rpool.cleanup[1].text.startsWith('In origin: '), rpool.cleanup[1].text);
        assertEqual(bpool.cleanup, []);
    }],
    ['idle: the rpool bar shows what fills it', () => {
        const rpool = view('idle').pools[0];
        assertEqual(rpool.segments.length, 7);
        assertEqual(rpool.segments[0].id, 'user-data');
    }],
    ['idle: a drive tab with its space and its facts', () => {
        const blue = view('idle').details.find(t => t.id === 'drive:blue');
        assertEqual(blue.summary, 'Not connected');
        assertEqual(blue.segments.map(s => s.id), ['used', 'reserved', 'free']);
        assertEqual(blue.marker, 0.9);
        assertTrue(blue.fill.includes('reserved by ZFS; measured '), blue.fill);
        const rows = Object.fromEntries(blue.rows.map(r => [r.label, r]));
        assertEqual(rows['Retention'].value, '60-day window, nothing older than 365 days, 10% margin');
        assertEqual(rows['Ejects itself'].value, 'no');
        assertEqual(rows['Margin'].value, '32% free, above the 10% zark keeps before a backup');
        assertEqual(rows['Margin'].style, 'ok');
        assertEqual(rows['Last backup'].style, 'warning');
        assertTrue(rows['Last run'].value.startsWith('completed, '), rows['Last run'].value);
    }],
    ['bpool: no legend entry for an empty part', () => {
        const bpool = view('idle').details[1].usage;
        const ids = bpool.legend.map(e => e.id);
        assertTrue(!ids.includes('user-data') && !ids.includes('user-snapshots'), ids.join());
        assertTrue(ids.includes('free'), 'free stays');
    }],
    ['drive tab: the run progress.json describes for that drive', () => {
        const run = name => {
            const black = view(name).details.find(t => t.id === 'drive:black');
            return black.rows.find(r => r.label === 'Run') ?? null;
        };
        assertTrue(run('orphan').value.startsWith('Stopped answering at '), run('orphan').value);
        assertEqual(run('orphan').style, 'warning');
        assertTrue(run('stalled').value.startsWith('No update for 95 s: step 7 of 8'), run('stalled').value);
        assertTrue(run('running').value.startsWith('Running: step '), run('running').value);
        assertTrue(run('running').value.endsWith('% sent'), run('running').value);
        assertEqual(run('waiting').style, 'waiting');
        assertEqual(run('idle'), null);
        const blue = view('running').details.find(t => t.id === 'drive:blue');
        assertEqual(blue.rows.find(r => r.label === 'Run') ?? null, null);
    }],
    ['no-status: no details', () => {
        assertEqual(view('no-status').details, []);
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
        assertTrue(blue.last.startsWith('Last backup '), blue.last);
        assertEqual(v.drives.find(d => d.name === 'black').fill, '64%, 1.2 TiB free');
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
        const rows = v.details.find(t => t.id === 'drive:black').rows;
        const run = rows.findIndex(r => r.label === 'Last run');
        assertTrue(rows[run].value.startsWith('incomplete, '), rows[run].value);
        assertEqual(rows[run].style, 'critical');
        assertEqual(rows[run + 1].style, 'critical', 'message');
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
