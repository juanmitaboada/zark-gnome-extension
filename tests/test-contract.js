// SPDX-License-Identifier: GPL-2.0-or-later

import {FileState, PROGRESS_KIND, STATUS_KIND, parseFile, parseTimestamp} from '../lib/contract.js';
import {assertEqual, assertTrue} from './harness.js';

const status = (fields = {}) => JSON.stringify({kind: STATUS_KIND, schema_version: 1, ...fields});

export const tests = [
    ['absent file', () => {
        assertEqual(parseFile(null, STATUS_KIND), {state: FileState.ABSENT, data: null});
    }],
    ['valid file', () => {
        const parsed = parseFile(status({zark_version: '2.1.0'}), STATUS_KIND);
        assertEqual(parsed.state, FileState.OK);
        assertEqual(parsed.data.zark_version, '2.1.0');
    }],
    ['not JSON', () => {
        assertEqual(parseFile('{"kind": "zark-sta', STATUS_KIND).state, FileState.UNREADABLE);
    }],
    ['not an object', () => {
        assertEqual(parseFile('[1, 2]', STATUS_KIND).state, FileState.UNREADABLE);
        assertEqual(parseFile('null', STATUS_KIND).state, FileState.UNREADABLE);
    }],
    ['other kind', () => {
        assertEqual(parseFile(status(), PROGRESS_KIND).state, FileState.UNREADABLE);
    }],
    ['schema_version missing or not an integer', () => {
        assertEqual(parseFile(JSON.stringify({kind: STATUS_KIND}), STATUS_KIND).state, FileState.UNREADABLE);
        assertEqual(parseFile(status({schema_version: '1'}), STATUS_KIND).state, FileState.UNREADABLE);
    }],
    ['newer schema is not interpreted', () => {
        assertEqual(parseFile(status({schema_version: 2}), STATUS_KIND), {state: FileState.NEWER, data: null});
    }],
    ['timestamps', () => {
        assertEqual(parseTimestamp('2026-10-24T09:15:02Z'), Date.UTC(2026, 9, 24, 9, 15, 2));
        assertTrue(Number.isNaN(parseTimestamp(null)));
    }],
];
