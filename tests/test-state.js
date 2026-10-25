// SPDX-License-Identifier: GPL-2.0-or-later

import {FileState} from '../lib/contract.js';
import {
    Indicator, Progress, classifyProgress, indicatorState, isStale, parentPidFromStat, ringSectors,
    startTicksFromStat, transferEta, transferProgress,
} from '../lib/state.js';
import {assertClose, assertEqual} from './harness.js';

const NOW = Date.UTC(2026, 9, 24, 9, 20, 0);
const BOOT = '6f1c0b8e-3d52-4a8e-9c1f-2b7d4e5a9c03';
const LIVE = {bootId: BOOT, pidExists: true, startTicks: 2961734};

const progress = (fields = {}) => ({
    kind: 'zark-progress', schema_version: 1, pid: 48213, pid_start_ticks: 2961734,
    boot_id: BOOT, updated_at: '2026-10-24T09:19:58Z', waiting_for_input: false,
    waiting_for: null, transfer: null, ...fields,
});
const ok = data => ({state: FileState.OK, data});

const status = (fields = {}) => ({
    kind: 'zark-status', schema_version: 1, generated_at: '2026-10-24T09:00:00Z',
    thresholds: {
        capacity_warning_pct: 80, capacity_critical_pct: 90, rpo_warning_days: 7, stale_after_s: 10800,
    },
    source_pools: [], drives: [], notices: [], ...fields,
});

const transfer = (fields = {}) => ({
    datasets_total: 12, datasets_done: 3, datasets_failed: 0, dataset: null, dataset_state: null,
    bytes_total: 1000, bytes_total_partial: false, bytes_done: 250, rate_bytes_per_s: 50, ...fields,
});

export const tests = [
    ['stat field 22 after the last parenthesis', () => {
        const line = '48213 (zark (a) b) S 1 48213 48213 0 -1 4194560 2000 0 0 0 10 5 0 0 20 0 3 0 ' +
            '2961734 30000000 4000';
        assertEqual(startTicksFromStat(line), 2961734);
        assertEqual(startTicksFromStat('garbage'), null);
    }],
    ['stat field 4, the parent', () => {
        const line = '48213 (zark (a) b) S 1207 48213 48213 0 -1 4194560 2000 0 0 0 10 5 0 0 20 0 3 0 ' +
            '2961734 30000000 4000';
        assertEqual(parentPidFromStat(line), 1207);
        assertEqual(parentPidFromStat('1 (systemd) S 0 1 1'), null, 'init has none');
        assertEqual(parentPidFromStat('garbage'), null);
    }],
    ['progress: absent, unreadable, newer', () => {
        assertEqual(classifyProgress({state: FileState.ABSENT, data: null}, LIVE, NOW), Progress.IDLE);
        assertEqual(classifyProgress({state: FileState.UNREADABLE, data: null}, LIVE, NOW), Progress.UNKNOWN);
        assertEqual(classifyProgress({state: FileState.NEWER, data: null}, LIVE, NOW), Progress.UNKNOWN);
    }],
    ['progress: orphan rules in order', () => {
        assertEqual(classifyProgress(ok(progress()), {...LIVE, bootId: 'other'}, NOW), Progress.ORPHAN);
        assertEqual(classifyProgress(ok(progress()), {...LIVE, pidExists: false}, NOW), Progress.ORPHAN);
        assertEqual(classifyProgress(ok(progress()), {...LIVE, startTicks: 1}, NOW), Progress.ORPHAN);
    }],
    ['progress: unreadable stat skips the reuse check', () => {
        assertEqual(classifyProgress(ok(progress()), {...LIVE, startTicks: null}, NOW), Progress.RUNNING);
    }],
    ['progress: stalled after 30 s, running before', () => {
        const at = updated => classifyProgress(ok(progress({updated_at: updated})), LIVE, NOW);
        assertEqual(at('2026-10-24T09:19:30Z'), Progress.RUNNING);
        assertEqual(at('2026-10-24T09:19:29Z'), Progress.STALLED);
    }],
    ['stale against stale_after_s', () => {
        assertEqual(isStale(status({generated_at: '2026-10-24T06:20:00Z'}), NOW), false);
        assertEqual(isStale(status({generated_at: '2026-10-24T06:19:59Z'}), NOW), true);
        const shortTimer = status({generated_at: '2026-10-24T08:00:00Z'});
        shortTimer.thresholds.stale_after_s = 1800;
        assertEqual(isStale(shortTimer, NOW), true);
    }],
    ['indicator: waiting before running, stalled counts', () => {
        const waiting = progress({waiting_for_input: true});
        assertEqual(indicatorState(Progress.RUNNING, waiting, ok(status()), NOW), Indicator.WAITING);
        assertEqual(indicatorState(Progress.STALLED, waiting, ok(status()), NOW), Indicator.WAITING);
        assertEqual(indicatorState(Progress.STALLED, progress(), ok(status()), NOW), Indicator.RUNNING);
    }],
    ['indicator: attention before edge', () => {
        const failed = status({
            generated_at: '2026-10-23T00:00:00Z',
            drives: [{name: 'black', last_run: {result: 'not_verified'}}],
        });
        assertEqual(indicatorState(Progress.ORPHAN, null, ok(failed), NOW), Indicator.ATTENTION);
        const critical = status({notices: [{level: 'critical', code: 'capacity'}]});
        assertEqual(indicatorState(Progress.IDLE, null, ok(critical), NOW), Indicator.ATTENTION);
    }],
    ['indicator: aborted does not call for attention', () => {
        const aborted = status({drives: [{name: 'black', last_run: {result: 'aborted'}}]});
        assertEqual(indicatorState(Progress.IDLE, null, ok(aborted), NOW), Indicator.OK);
    }],
    ['indicator: edge cases', () => {
        const idle = parsed => indicatorState(Progress.IDLE, null, parsed, NOW);
        assertEqual(idle({state: FileState.NEWER, data: null}), Indicator.EDGE);
        assertEqual(idle({state: FileState.UNREADABLE, data: null}), Indicator.EDGE);
        assertEqual(idle(ok(status({generated_at: '2026-10-24T01:00:00Z'}))), Indicator.EDGE);
        assertEqual(indicatorState(Progress.ORPHAN, null, ok(status()), NOW), Indicator.EDGE);
        assertEqual(indicatorState(Progress.UNKNOWN, null, {state: FileState.ABSENT, data: null}, NOW), Indicator.EDGE);
    }],
    ['indicator: overdue, none, ok', () => {
        const overdue = status({notices: [{level: 'warning', code: 'backup_age'}]});
        assertEqual(indicatorState(Progress.IDLE, null, ok(overdue), NOW), Indicator.OVERDUE);
        assertEqual(indicatorState(Progress.IDLE, null, {state: FileState.ABSENT, data: null}, NOW), Indicator.NONE);
        const info = status({notices: [{level: 'info', code: 'backup_age'}]});
        assertEqual(indicatorState(Progress.IDLE, null, ok(info), NOW), Indicator.OK);
    }],
    ['transfer: bytes when both are known', () => {
        assertEqual(transferProgress(transfer()), {fraction: 0.25, source: 'bytes'});
    }],
    ['transfer: dataset counts when a byte figure is null', () => {
        assertEqual(transferProgress(transfer({bytes_done: null})), {fraction: 0.25, source: 'datasets'});
        assertEqual(transferProgress(transfer({bytes_total: null})), {fraction: 0.25, source: 'datasets'});
    }],
    ['transfer: stays below 1 while running', () => {
        assertEqual(transferProgress(transfer({bytes_done: 1500})).fraction, 0.99);
        assertEqual(transferProgress(null), null);
    }],
    ['transfer: ETA only when the contract allows it', () => {
        assertClose(transferEta(transfer()), 15, 1e-9);
        assertEqual(transferEta(transfer({bytes_total_partial: true})), null);
        assertEqual(transferEta(transfer({rate_bytes_per_s: null})), null);
        assertEqual(transferEta(transfer({rate_bytes_per_s: 0})), null);
        assertEqual(transferEta(transfer({bytes_total: null})), null);
    }],
    ['ring sectors', () => {
        assertEqual(ringSectors(0), 0);
        assertEqual(ringSectors(0.124), 0);
        assertEqual(ringSectors(0.125), 1);
        assertEqual(ringSectors(0.99), 7);
        assertEqual(ringSectors(1), 8);
    }],
];
