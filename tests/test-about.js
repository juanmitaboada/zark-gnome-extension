// SPDX-License-Identifier: GPL-2.0-or-later
//
// The About tab: dpkg's status file and what the tab shows. The samples
// are inline: `make fixtures` replaces tests/fixtures/ with zark's.

import {aboutCommands, aboutView, parseDpkgStatus, upstreamVersion} from '../lib/about.js';
import {assertEqual} from './harness.js';

const ZARK_INSTALLED = `Package: zark
Status: install ok installed
Priority: optional
Section: admin
Installed-Size: 2410
Maintainer: Juanmi Taboada <juanmi@juanmitaboada.com>
Architecture: all
Version: 2.2.0-1~ubuntu26.10.1
Depends: python3, zfsutils-linux
Description: bare-metal backup and recovery for ZFS on Ubuntu
 zark backs up and recovers Ubuntu systems on ZFS.
 .
 Package: zark-not-a-field
`;

const OTHER = `Package: zark-extra
Status: install ok installed
Version: 9.9

Package: zsh
Status: install ok installed
Version: 5.9-8
Description: shell with lots of features
 Package: zark
`;

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const AT = Date.UTC(2026, 10, 8, 10, 30, 0);

function view(dpkg, status, extra = {}) {
    return aboutView({
        dpkg,
        status,
        statusAtMs: status ? AT : NaN,
        extensionVersion: '1.1',
        shellVersion: '51.1',
        nowMs: NOW,
        ...extra,
    });
}

const STATUS_220 = {version: '2.2.0', generatedAt: '2026-11-08T10:30:00Z', generatedBy: 'timer'};
const STATUS_RC = {version: '2.3.0-rc1', generatedAt: '2026-11-08T10:30:00Z', generatedBy: 'backup'};
const PKG_220 = {version: '2.2.0-1~ubuntu26.10.1', state: 'installed'};

const INSTALLED_COMMANDS = ['sudo zark status', 'sudo zark selftest', 'sudo zark backup', 'zark monitor'];
const PORTABLE_COMMANDS = ['sudo ./zark status', 'sudo ./zark selftest', 'sudo ./zark backup', './zark monitor'];

const value = (v, label) => v.rows.find(r => r.label === label)?.value ?? null;

export const tests = [
    ['dpkg: an installed zark among other packages', () => {
        assertEqual(parseDpkgStatus(`${OTHER}\n${ZARK_INSTALLED}`, 'zark'),
            {version: '2.2.0-1~ubuntu26.10.1', state: 'installed'});
    }],
    ['dpkg: the stanza last, without a trailing blank line', () => {
        assertEqual(parseDpkgStatus(`${OTHER}\nPackage: zark\nStatus: install ok installed\nVersion: 2.2.0-1`, 'zark'),
            {version: '2.2.0-1', state: 'installed'});
    }],
    ['dpkg: other states', () => {
        assertEqual(parseDpkgStatus('Package: zark\nStatus: deinstall ok config-files\nVersion: 2.1.0-1\n', 'zark'),
            {version: '2.1.0-1', state: 'config-files'});
        assertEqual(parseDpkgStatus('Package: zark\nStatus: install reinstreq half-configured\nVersion: 2.2.0-1\n',
            'zark'), {version: '2.2.0-1', state: 'half-configured'});
        assertEqual(parseDpkgStatus('Package: zark\nStatus: install ok unpacked\n', 'zark'),
            {version: '', state: 'unpacked'});
    }],
    ['dpkg: zark-extra and a continuation line naming zark do not match', () => {
        assertEqual(parseDpkgStatus(OTHER, 'zark'), null);
    }],
    ['dpkg: an empty file', () => {
        assertEqual(parseDpkgStatus('', 'zark'), null);
    }],
    ['upstream version', () => {
        assertEqual(upstreamVersion('2.2.0-1~ubuntu26.10.1'), '2.2.0');
        assertEqual(upstreamVersion('2.3.0~rc1-1'), '2.3.0~rc1');
        assertEqual(upstreamVersion('1:2.2.0-1'), '2.2.0');
        assertEqual(upstreamVersion('2.2.0'), '2.2.0');
    }],
    ['commands: installed and portable forms, exactly as copied', () => {
        assertEqual(aboutCommands(false).map(c => c.command), INSTALLED_COMMANDS);
        assertEqual(aboutCommands(true).map(c => c.command), PORTABLE_COMMANDS);
        assertEqual(aboutCommands(false)[0].description, "Source pools' fill level and each drive's backup age");
    }],
    ['about: package installed, status written by the same version', () => {
        const v = view(PKG_220, STATUS_220);
        assertEqual(v.rows, [
            {label: 'zark', value: '2.2.0-1~ubuntu26.10.1 (package)', style: ''},
            {label: 'Extension', value: '1.1', style: ''},
            {label: 'GNOME Shell', value: '51.1', style: ''},
        ]);
        assertEqual(v.commandsNote, null);
        assertEqual(v.commands.map(c => c.command), INSTALLED_COMMANDS);
    }],
    ['about: package installed, no status file', () => {
        const v = view(PKG_220, null);
        assertEqual(value(v, 'zark'), '2.2.0-1~ubuntu26.10.1 (package)');
        assertEqual(value(v, 'Status file'), null);
        assertEqual(v.commands.map(c => c.command), INSTALLED_COMMANDS);
    }],
    ['about: package installed, status written by another zark', () => {
        const v = view(PKG_220, STATUS_RC);
        assertEqual(value(v, 'zark'), '2.2.0-1~ubuntu26.10.1 (package)');
        assertEqual(value(v, 'Status file'), 'written by zark 2.3.0-rc1, today 10:30');
        assertEqual(v.commands.map(c => c.command), INSTALLED_COMMANDS);
    }],
    ['about: package not fully installed', () => {
        const v = view({version: '2.2.0-1', state: 'half-configured'}, STATUS_220);
        assertEqual(v.rows[0], {label: 'zark', value: '2.2.0-1 (package half-configured)', style: 'warning'});
        assertEqual(value(v, 'Status file'), null);
        assertEqual(v.commands.map(c => c.command), INSTALLED_COMMANDS);
    }],
    ['about: no package, a status file: portable', () => {
        const v = view(null, STATUS_RC);
        assertEqual(value(v, 'zark'), '2.3.0-rc1 (not installed as a package; from the status file)');
        assertEqual(value(v, 'Status file'), 'written by zark 2.3.0-rc1, today 10:30');
        assertEqual(v.commandsNote, 'Run them in the directory that holds zark.');
        assertEqual(v.commands.map(c => c.command), PORTABLE_COMMANDS);
    }],
    ['about: neither package nor status file', () => {
        const v = view(null, null);
        assertEqual(v.rows[0], {label: 'zark', value: 'Not found on this system', style: 'warning'});
        assertEqual(v.commandsNote, 'Once zark is installed:');
        assertEqual(v.commands.map(c => c.command), INSTALLED_COMMANDS);
    }],
    ['about: while dpkg is read', () => {
        const v = view(undefined, STATUS_RC);
        assertEqual(v.rows[0], {label: 'zark', value: "Reading dpkg's database", style: 'dim'});
        assertEqual(value(v, 'Status file'), null);
        assertEqual(v.commandsNote, null);
        assertEqual(v.commands.map(c => c.command), INSTALLED_COMMANDS);
    }],
    ['about: status time unknown', () => {
        const v = view(null, STATUS_RC, {statusAtMs: NaN});
        assertEqual(value(v, 'Status file'), 'written by zark 2.3.0-rc1');
    }],
];
