// SPDX-License-Identifier: GPL-2.0-or-later

import {DONUT_GAP, Segment, datasetGroup, donutArcs, ownBytes, poolUsage, reservedBytes} from '../lib/usage.js';
import {assertEqual, assertTrue} from './harness.js';

const ds = (name, data, snapshots, children = 0, refreservation = 0) => ({
    name, type: refreservation ? 'volume' : 'filesystem',
    used_bytes: data + snapshots + children + refreservation,
    usedbydataset_bytes: data, usedbysnapshots_bytes: snapshots,
    usedbychildren_bytes: children, usedbyrefreservation_bytes: refreservation,
});

// A small pool laid out as Ubuntu's installer does.
const POOL = {
    name: 'rpool',
    space: {
        used_bytes: 999, available_bytes: 300, pool_size_bytes: 1400,
        pool_alloc_bytes: 979, pool_free_bytes: 420, capacity_pct: 70,
        measured_at: '2026-10-24T09:00:00Z',
    },
    level: 'ok',
    datasets: [
        ds('rpool', 1, 0, 998),
        ds('rpool/ROOT', 1, 0, 299),
        ds('rpool/ROOT/ubuntu_x', 200, 99, 0),
        ds('rpool/USERDATA', 1, 0, 588),
        ds('rpool/USERDATA/home_x', 450, 120, 0),
        ds('rpool/USERDATA/root_x', 15, 3, 0),
        ds('rpool/keystore', 100, 0, 0, 9),
    ],
};

// rpool on eli's 26.10 as the details dialog drew it (M15X.1), in bytes.
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const ELI = [
    {id: Segment.USER_DATA, bytes: 73.2 * MIB},
    {id: Segment.USER_SNAPSHOTS, bytes: 22.9 * MIB},
    {id: Segment.SYSTEM_DATA, bytes: 6.5 * GIB},
    {id: Segment.SYSTEM_SNAPSHOTS, bytes: 455.9 * MIB},
    {id: Segment.OTHER, bytes: 17.7 * MIB},
    {id: Segment.METADATA, bytes: 7.2 * MIB},
    {id: Segment.FREE, bytes: 446.5 * GIB},
    {id: Segment.RESERVED, bytes: 14.5 * GIB},
];

export const tests = [
    ['the donut draws no arc shorter than half a pixel', () => {
        // The ring's radius of the stylesheet's donut: 140 px wide, 20 px thick.
        const arcs = donutArcs(ELI, 60);
        assertEqual(arcs.map(a => a.id), [Segment.SYSTEM_DATA, Segment.FREE, Segment.RESERVED]);
        // A dropped segment still takes its angle: free starts after every
        // segment before it, its gap's half later.
        const total = ELI.reduce((sum, s) => sum + s.bytes, 0);
        const before = ELI.slice(0, 6).reduce((sum, s) => sum + s.bytes, 0);
        const freeStart = -Math.PI / 2 + 2 * Math.PI * before / total + DONUT_GAP / 2;
        assertTrue(Math.abs(arcs[1].start - freeStart) < 1e-12, 'free starts in its place');
        // The last arc ends where the ring began, less its gap's half.
        const reservedEnd = 3 * Math.PI / 2 - DONUT_GAP / 2;
        assertTrue(Math.abs(arcs[2].end - reservedEnd) < 1e-12, 'reserved ends at the top');
    }],
    ['the donut keeps every segment of a pool used at large', () => {
        const segments = [{id: 'a', bytes: 1}, {id: 'b', bytes: 3}];
        const arcs = donutArcs(segments, 60);
        assertEqual(arcs.map(a => a.id), ['a', 'b']);
        assertEqual(donutArcs([{id: 'a', bytes: 0}], 60), []);
        assertEqual(donutArcs(segments, 0), []);
    }],
    ['groups follow the installer layout', () => {
        assertEqual(datasetGroup('rpool/USERDATA/home_x'), 'user');
        assertEqual(datasetGroup('rpool/ROOT/ubuntu_x/var/lib'), 'system');
        assertEqual(datasetGroup('bpool/BOOT/ubuntu_x'), 'system');
        assertEqual(datasetGroup('rpool/keystore'), 'other');
        assertEqual(datasetGroup('rpool'), 'other');
    }],
    ['own shares add up to the pool root used', () => {
        const sum = POOL.datasets.reduce((a, d) => a + ownBytes(d), 0);
        assertEqual(sum, POOL.space.used_bytes);
    }],
    ['reserve is pool free minus available, never negative', () => {
        assertEqual(reservedBytes(POOL.space), 120);
        assertEqual(reservedBytes({...POOL.space, pool_free_bytes: 100}), 0);
    }],
    ['segments and total', () => {
        const usage = poolUsage(POOL);
        const bytes = Object.fromEntries(usage.segments.map(s => [s.id, s.bytes]));
        assertEqual(bytes[Segment.USER_DATA], 1 + 450 + 15);
        assertEqual(bytes[Segment.USER_SNAPSHOTS], 123);
        assertEqual(bytes[Segment.SYSTEM_DATA], 201);
        assertEqual(bytes[Segment.SYSTEM_SNAPSHOTS], 99);
        assertEqual(bytes[Segment.OTHER], 1 + 109);
        assertEqual(bytes[Segment.FREE], 300);
        assertEqual(bytes[Segment.RESERVED], 120);
        assertEqual(usage.total, 1419);
        assertEqual(usage.segments.reduce((a, s) => a + s.bytes, 0), usage.total);
        assertEqual(usage.snapshots, 222);
    }],
    ['largest datasets by own share', () => {
        const names = poolUsage(POOL, 3).largest.map(d => d.name);
        assertEqual(names, ['rpool/USERDATA/home_x', 'rpool/ROOT/ubuntu_x', 'rpool/keystore']);
    }],
    ['no dataset list, no usage', () => {
        assertEqual(poolUsage({...POOL, datasets: undefined}), null);
        assertEqual(poolUsage({...POOL, space: null}), null);
    }],
];
