// SPDX-License-Identifier: GPL-2.0-or-later
//
// A small test harness for gjs: test files export `tests`, a list of
// [name, function] pairs; run.js runs them and exits non-zero on a failure.

export class AssertionError extends Error {}

/**
 * Compare two values by their JSON form.
 *
 * @param {*} actual
 * @param {*} expected
 * @param {string} [what] - prefix for the failure message
 */
export function assertEqual(actual, expected, what = '') {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new AssertionError(`${what ? `${what}: ` : ''}expected ${e}, got ${a}`);
}

/**
 * @param {*} value - must be truthy
 * @param {string} [what] - prefix for the failure message
 */
export function assertTrue(value, what = '') {
    if (!value)
        throw new AssertionError(`${what ? `${what}: ` : ''}expected true`);
}

/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} tolerance - largest accepted difference
 * @param {string} [what] - prefix for the failure message
 */
export function assertClose(actual, expected, tolerance, what = '') {
    if (Math.abs(actual - expected) > tolerance)
        throw new AssertionError(`${what ? `${what}: ` : ''}expected ${expected} +/- ${tolerance}, got ${actual}`);
}
