// SPDX-License-Identifier: GPL-2.0-or-later
//
// What the orphan rules need from /proc, read without privileges.

import {isCancelled, readText} from './files.js';
import {parentPidFromStat, startTicksFromStat} from './state.js';

/**
 * @param {Gio.Cancellable} cancellable
 * @returns {Promise<string>} this boot's id
 */
export async function readBootId(cancellable) {
    const text = await readText('/proc/sys/kernel/random/boot_id', cancellable);
    return (text ?? '').trim();
}

/**
 * Whether a process exists and when it started.
 *
 * @param {number} pid
 * @param {Gio.Cancellable} cancellable
 * @returns {Promise<{pidExists: boolean, startTicks: number|null}>}
 *   startTicks is null when /proc/<pid>/stat cannot be read (hidepid)
 */
export async function readProcess(pid, cancellable) {
    if (!Number.isInteger(pid) || pid <= 0)
        return {pidExists: false, startTicks: null};
    try {
        const stat = await readText(`/proc/${pid}/stat`, cancellable);
        if (stat === null)
            return {pidExists: false, startTicks: null};
        return {pidExists: true, startTicks: startTicksFromStat(stat)};
    } catch (e) {
        if (isCancelled(e))
            throw e;
        return {pidExists: true, startTicks: null};
    }
}

/**
 * A process and its ancestors, nearest first, as far as /proc shows them.
 *
 * @param {number} pid
 * @param {Gio.Cancellable} cancellable
 * @returns {Promise<number[]>} pid, its parent, and so on up to init
 */
export async function ancestry(pid, cancellable) {
    const chain = [];
    let current = pid;
    // A loop guard: a chain deeper than this is not a terminal's.
    while (Number.isInteger(current) && current > 1 && chain.length < 32) {
        chain.push(current);
        // Each read depends on the one before.
        // eslint-disable-next-line no-await-in-loop
        const stat = await readText(`/proc/${current}/stat`, cancellable);
        current = stat === null ? null : parentPidFromStat(stat);
    }
    return chain;
}
