// SPDX-License-Identifier: GPL-2.0-or-later
//
// What the orphan rules need from /proc, read without privileges. The proc
// root is a parameter so the contract's fixtures can stand in for /proc.

import Gio from 'gi://Gio';

import {isCancelled, readText} from './files.js';
import {parentPidFromStat, startTicksFromStat} from './state.js';

export const PROC = '/proc';

/**
 * @param {Gio.Cancellable} cancellable
 * @param {string} [path] - the boot id file
 * @returns {Promise<string>} this boot's id
 */
export async function readBootId(cancellable, path = `${PROC}/sys/kernel/random/boot_id`) {
    const text = await readText(path, cancellable);
    return (text ?? '').trim();
}

/**
 * Whether /proc hides root's processes from this reader (contract, orphan
 * rule 4): pid 1 always exists and runs as root, as zark does, so when
 * /proc/1 does not exist for the reader, /proc is mounted with
 * hidepid=invisible or ptraceable and zark's process may be hidden too.
 *
 * @param {string} [proc] - the proc root
 * @returns {boolean}
 */
export function procHidesRoot(proc = PROC) {
    return !Gio.File.new_for_path(`${proc}/1`).query_exists(null);
}

/**
 * Whether a process exists and when it started.
 *
 * @param {number} pid
 * @param {Gio.Cancellable} cancellable
 * @param {string} [proc] - the proc root
 * @returns {Promise<{pidExists: boolean, rootHidden: boolean, startTicks: number|null}>}
 *   rootHidden is procHidesRoot()'s answer when the pid is missing, else
 *   false; startTicks is null when /proc/<pid>/stat cannot be read
 *   (hidepid=noaccess)
 */
export async function readProcess(pid, cancellable, proc = PROC) {
    if (!Number.isInteger(pid) || pid <= 0)
        return {pidExists: false, rootHidden: false, startTicks: null};
    try {
        const stat = await readText(`${proc}/${pid}/stat`, cancellable);
        if (stat === null)
            return {pidExists: false, rootHidden: procHidesRoot(proc), startTicks: null};
        return {pidExists: true, rootHidden: false, startTicks: startTicksFromStat(stat)};
    } catch (e) {
        if (isCancelled(e))
            throw e;
        return {pidExists: true, rootHidden: false, startTicks: null};
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
