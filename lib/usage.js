// SPDX-License-Identifier: GPL-2.0-or-later
//
// Disk usage of a source pool, from status.json's Space object and its
// `datasets` list: chart segments and the largest datasets.

/** Chart segments, in drawing order. */
export const Segment = Object.freeze({
    USER_DATA: 'user-data',
    USER_SNAPSHOTS: 'user-snapshots',
    SYSTEM_DATA: 'system-data',
    SYSTEM_SNAPSHOTS: 'system-snapshots',
    OTHER: 'other',
    METADATA: 'metadata',
    FREE: 'free',
    RESERVED: 'reserved',
});

/**
 * Group of a dataset by the installer's layout: `<pool>/USERDATA/...` holds
 * user data, `<pool>/ROOT/...` and `<pool>/BOOT/...` the system.
 *
 * @param {string} name - full dataset name
 * @returns {string} 'user', 'system' or 'other'
 */
export function datasetGroup(name) {
    const top = name.split('/')[1];
    if (top === 'USERDATA')
        return 'user';
    if (top === 'ROOT' || top === 'BOOT')
        return 'system';
    return 'other';
}

/**
 * A dataset's own share: the parts that no other dataset counts.
 *
 * @param {object} dataset - a `datasets` entry
 * @returns {number} bytes
 */
export function ownBytes(dataset) {
    return dataset.usedbydataset_bytes + dataset.usedbysnapshots_bytes +
        dataset.usedbyrefreservation_bytes;
}

/**
 * Space ZFS keeps back (the slop reserve), as the contract defines it.
 *
 * @param {object} space - a Space object
 * @returns {number} bytes
 */
export function reservedBytes(space) {
    return Math.max(0, space.pool_free_bytes - space.available_bytes);
}

// Gap between two arcs of the donut, in radians; arcs smaller than two gaps get none.
export const DONUT_GAP = 0.02;

// The shortest arc the donut draws, in pixels along the ring. A stroked arc
// shorter than that (pool metadata is a few MiB of hundreds of GiB) gets no
// direction for its ends and comes out slanted across the ring (M15X.1).
export const MIN_ARC_PX = 0.5;

/**
 * The donut's arcs: one per segment long enough to draw, in drawing order,
 * clockwise from the top. A segment too short to draw still takes its angle,
 * so the others keep their place.
 *
 * @param {{id: string, bytes: number}[]} segments - in drawing order
 * @param {number} radius - the ring's radius, in pixels
 * @returns {{id: string, start: number, end: number}[]} angles in radians
 */
export function donutArcs(segments, radius) {
    const total = segments.reduce((sum, s) => sum + s.bytes, 0);
    const arcs = [];
    if (total <= 0)
        return arcs;
    let angle = -Math.PI / 2;
    for (const segment of segments) {
        const sweep = 2 * Math.PI * segment.bytes / total;
        if (sweep * radius >= MIN_ARC_PX) {
            const gap = sweep > 2 * DONUT_GAP ? DONUT_GAP : 0;
            arcs.push({id: segment.id, start: angle + gap / 2, end: angle + sweep - gap / 2});
        }
        angle += sweep;
    }
    return arcs;
}

/**
 * Usage of one source pool, or null when the file has no dataset list.
 *
 * @param {object} pool - a source pool entry of status.json
 * @param {number} [largest] - how many datasets to list
 * @returns {object|null} `segments` ({id, bytes}), `total`, `snapshots`,
 *   `snapshotShare` (of the space in use), `largest` (datasets by own
 *   share), `mostSnapshots` (datasets by snapshot space), `datasetCount`
 */
export function poolUsage(pool, largest = 12) {
    if (!pool.space || !Array.isArray(pool.datasets))
        return null;

    const sums = {user: [0, 0], system: [0, 0], other: [0, 0]};
    let snapshots = 0;
    let shares = 0;
    for (const dataset of pool.datasets) {
        shares += ownBytes(dataset);
        const group = sums[datasetGroup(dataset.name)];
        group[0] += dataset.usedbydataset_bytes + dataset.usedbyrefreservation_bytes;
        group[1] += dataset.usedbysnapshots_bytes;
        snapshots += dataset.usedbysnapshots_bytes;
    }

    const space = pool.space;
    const segments = [
        {id: Segment.USER_DATA, bytes: sums.user[0]},
        {id: Segment.USER_SNAPSHOTS, bytes: sums.user[1]},
        {id: Segment.SYSTEM_DATA, bytes: sums.system[0]},
        {id: Segment.SYSTEM_SNAPSHOTS, bytes: sums.system[1]},
        {id: Segment.OTHER, bytes: sums.other[0] + sums.other[1]},
        // The shares sum to a little less than used: the rest is what ZFS
        // keeps under the root that zfs list never shows (contract, "Source
        // pool entry").
        {id: Segment.METADATA, bytes: Math.max(0, space.used_bytes - shares)},
        {id: Segment.FREE, bytes: space.available_bytes},
        {id: Segment.RESERVED, bytes: reservedBytes(space)},
    ];

    return {
        segments,
        total: space.used_bytes + space.available_bytes + reservedBytes(space),
        snapshots,
        snapshotShare: space.used_bytes > 0 ? snapshots / space.used_bytes : 0,
        largest: [...pool.datasets]
            .sort((a, b) => ownBytes(b) - ownBytes(a))
            .slice(0, largest),
        mostSnapshots: [...pool.datasets]
            .sort((a, b) => b.usedbysnapshots_bytes - a.usedbysnapshots_bytes)
            .slice(0, largest),
        datasetCount: pool.datasets.length,
    };
}
