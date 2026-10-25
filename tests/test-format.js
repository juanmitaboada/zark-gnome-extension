// SPDX-License-Identifier: GPL-2.0-or-later

import {formatAge, formatBytes, formatDuration, formatPercent, formatRate} from '../lib/format.js';
import {assertEqual} from './harness.js';

export const tests = [
    ['bytes in binary units', () => {
        assertEqual(formatBytes(0), '0 B');
        assertEqual(formatBytes(1023), '1023 B');
        assertEqual(formatBytes(1024), '1.0 KiB');
        assertEqual(formatBytes(917611225088), '854.6 GiB');
        assertEqual(formatBytes(1005022347264), '936.0 GiB');
        assertEqual(formatBytes(2 * 1024 ** 4), '2.0 TiB');
    }],
    ['rate', () => {
        assertEqual(formatRate(117440512), '112.0 MiB/s');
    }],
    ['ages', () => {
        assertEqual(formatAge(30 * 1000), 'just now');
        assertEqual(formatAge(5 * 60 * 1000), '5 min ago');
        assertEqual(formatAge(60 * 60 * 1000), '1 hour ago');
        assertEqual(formatAge(5 * 3600 * 1000), '5 hours ago');
        assertEqual(formatAge(24 * 3600 * 1000), '1 day ago');
        assertEqual(formatAge(9 * 24 * 3600 * 1000), '9 days ago');
    }],
    ['durations', () => {
        assertEqual(formatDuration(40), 'under a minute');
        assertEqual(formatDuration(17 * 60), '17 min');
        assertEqual(formatDuration(72 * 60), '1 h 12 min');
    }],
    ['percent rounds down, as zpool does', () => {
        assertEqual(formatPercent(0.898), '89%');
    }],
];
