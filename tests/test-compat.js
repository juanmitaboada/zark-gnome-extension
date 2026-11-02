// SPDX-License-Identifier: GPL-2.0-or-later

import {closeWithoutAnimation} from '../lib/compat.js';
import {assertEqual} from './harness.js';

const NONE = 0;

export const tests = [
    ['menu close without animation, per shell version', () => {
        assertEqual(closeWithoutAnimation('50.1', NONE), NONE, '50.1');
        assertEqual(closeWithoutAnimation('50.alpha', NONE), NONE, '50.alpha');
        assertEqual(closeWithoutAnimation('51.0', NONE), {animate: false}, '51.0');
        assertEqual(closeWithoutAnimation('51.1', NONE), {animate: false}, '51.1');
        assertEqual(closeWithoutAnimation('52.beta', NONE), {animate: false}, '52.beta');
    }],
];
