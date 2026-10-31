// SPDX-License-Identifier: GPL-2.0-or-later
//
// Runs every test module: gjs -m tests/run.js

import System from 'system';

const MODULES = [
    './test-contract.js',
    './test-state.js',
    './test-format.js',
    './test-usage.js',
    './test-fixtures.js',
    './test-view.js',
    './test-events.js',
];

let failed = 0;
let passed = 0;
for (const path of MODULES) {
    // Modules load one after another so that failures print in order.
    // eslint-disable-next-line no-await-in-loop
    const {tests} = await import(path);
    for (const [name, fn] of tests) {
        try {
            // A test may be async (the /proc reads of the fixtures' liveness).
            // eslint-disable-next-line no-await-in-loop
            await fn();
            passed++;
        } catch (e) {
            failed++;
            print(`FAIL ${path.slice(2)}: ${name}\n     ${e.message}`);
        }
    }
}
print(`${passed} passed, ${failed} failed`);
System.exit(failed ? 1 : 0);
