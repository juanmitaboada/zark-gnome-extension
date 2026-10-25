// SPDX-License-Identifier: GPL-2.0-or-later
//
// Parsing of zark's status files, schema version 1 (zark's
// docs/STATUS-FILES.md). Pure: no GObject imports, so it runs under the
// tests without a shell.

export const SCHEMA_VERSION = 1;

export const PROGRESS_KIND = 'zark-progress';
export const STATUS_KIND = 'zark-status';

export const DEFAULT_PROGRESS_PATH = '/run/zark/progress.json';
export const DEFAULT_STATUS_PATH = '/var/lib/zark/status.json';

/** How a file read turned out. */
export const FileState = Object.freeze({
    ABSENT: 'absent',
    OK: 'ok',
    UNREADABLE: 'unreadable',
    NEWER: 'newer',
});

/**
 * Parse one status file.
 *
 * Checks `kind` and `schema_version` before anything else, as the contract
 * asks; a file of a newer schema is not interpreted at all.
 *
 * @param {string|null} text - the file's contents, null when it is absent
 * @param {string} kind - PROGRESS_KIND or STATUS_KIND
 * @returns {{state: string, data: object|null}}
 */
export function parseFile(text, kind) {
    if (text === null)
        return {state: FileState.ABSENT, data: null};

    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return {state: FileState.UNREADABLE, data: null};
    }

    if (data === null || typeof data !== 'object' || Array.isArray(data) ||
        data.kind !== kind || !Number.isInteger(data.schema_version))
        return {state: FileState.UNREADABLE, data: null};

    if (data.schema_version > SCHEMA_VERSION)
        return {state: FileState.NEWER, data: null};

    return {state: FileState.OK, data};
}

/**
 * Milliseconds since the epoch of a contract timestamp
 * (`2026-10-24T09:15:02Z`), or NaN.
 *
 * @param {string|null|undefined} timestamp - ISO 8601 UTC
 * @returns {number}
 */
export function parseTimestamp(timestamp) {
    if (typeof timestamp !== 'string')
        return NaN;
    return Date.parse(timestamp);
}
