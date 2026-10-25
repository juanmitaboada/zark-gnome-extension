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

/**
 * Usage of one source pool, or null when the file has no dataset list.
 *
 * @param {object} pool - a source pool entry of status.json
 * @param {number} [largest] - how many datasets to list
 * @returns {object|null} `segments` ({id, bytes}), `total`, `snapshots`,
 *   `snapshotShare` (of the space in use), `largest` (datasets by own share)
 */
export function poolUsage(pool, largest = 8) {
    if (!pool.space || !Array.isArray(pool.datasets))
        return null;

    const sums = {user: [0, 0], system: [0, 0], other: [0, 0]};
    let snapshots = 0;
    for (const dataset of pool.datasets) {
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
    };
}
