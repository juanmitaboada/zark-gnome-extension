// SPDX-License-Identifier: GPL-2.0-or-later
//
// make test-i18n: the TRANSLATED tests of test-i18n.js with real gettext,
// as GNOME Shell's initTranslations() binds the domain, and the pseudo
// catalogue "xx" the Makefile builds from the template in a temporary
// directory (ZARK_LOCALEDIR). Run with LANGUAGE=xx and a UTF-8 locale:
// gettext ignores LANGUAGE under the C locale.

import Gettext from 'gettext';
import GLib from 'gi://GLib';
import System from 'system';

import {_, setTranslator} from '../lib/i18n.js';
import {TRANSLATED, useTranslator} from './test-i18n.js';

const DOMAIN = 'zark@juanmitaboada.com';

const dir = GLib.getenv('ZARK_LOCALEDIR');
if (!dir) {
    print('ZARK_LOCALEDIR is not set: run make test-i18n');
    System.exit(2);
}
Gettext.bindtextdomain(DOMAIN, dir);
const domain = Gettext.domain(DOMAIN);

// Without this the tests below would fail on every text, for a reason they do not name.
setTranslator(domain);
const probe = _('Free');
setTranslator(null);
if (probe !== '[[Free]]') {
    print(`the pseudo catalogue is not used ("${probe}"): LANGUAGE=${GLib.getenv('LANGUAGE')}, ` +
        `LC_ALL=${GLib.getenv('LC_ALL')}; it needs a UTF-8 locale other than C`);
    System.exit(1);
}

useTranslator(domain);
let failed = 0;
for (const [name, fn] of TRANSLATED) {
    try {
        // eslint-disable-next-line no-await-in-loop
        await fn();
    } catch (e) {
        failed++;
        print(`FAIL test-i18n.js (gettext): ${name}\n     ${e.message}`);
    }
}
print(`${TRANSLATED.length - failed} passed, ${failed} failed, with gettext and the pseudo catalogue`);
System.exit(failed ? 1 : 0);
