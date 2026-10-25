// SPDX-License-Identifier: GPL-2.0-or-later
//
// What the orphan rules need from /proc, read without privileges.

import {isCancelled, readText} from './files.js';
import {startTicksFromStat} from './state.js';

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
