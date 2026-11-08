// SPDX-License-Identifier: GPL-2.0-or-later
//
// The details dialog's About tab: zark's installed version, read from
// dpkg's database, and the commands it offers to copy. Pure, so the tests
// can run it.

import {formatWhen} from './format.js';

export const ZARK_PACKAGE = 'zark';

export const SOURCE_URL = 'https://github.com/juanmitaboada/zark-gnome-extension';

export const READ_ONLY_NOTE = "Read-only: it reads zark's status files and dpkg's database, never starts or " +
    'changes anything, uses no network, and writes to the clipboard only when a Copy button is pressed.';

// zark's commands and their help lines (zark's lib/cli_spec.py); every one
// but monitor needs root (zark's entry script refuses them without it).
const COMMANDS = [
    {name: 'status', root: true, description: "Source pools' fill level and each drive's backup age"},
    {name: 'selftest', root: true, description: 'Check that this platform behaves as zark relies on'},
    {name: 'backup', root: true, description: 'Run incremental backup to connected drive'},
    {name: 'monitor', root: false, description: "Live view of a running command and the backups' state (no root)"},
];

/**
 * One package's state in dpkg's status file.
 *
 * Stanzas are separated by blank lines; a field starts at the beginning of
 * a line, a continuation line starts with a space or a tab.
 *
 * @param {string} text - /var/lib/dpkg/status
 * @param {string} pkg - the package name
 * @returns {{version: string, state: string}|null} the Status field's
 *   third word (installed, unpacked, half-configured, config-files, ...)
 *   and the Version field ('' when absent); null when no stanza names it
 */
export function parseDpkgStatus(text, pkg) {
    for (const stanza of text.split(/\n[ \t]*\n/)) {
        const fields = new Map();
        for (const line of stanza.split('\n')) {
            if (line === '' || line.startsWith(' ') || line.startsWith('\t'))
                continue;
            const colon = line.indexOf(':');
            if (colon > 0)
                fields.set(line.slice(0, colon), line.slice(colon + 1).trim());
        }
        if (fields.get('Package') !== pkg)
            continue;
        const words = (fields.get('Status') ?? '').split(/\s+/);
        return {version: fields.get('Version') ?? '', state: words[2] ?? ''};
    }
    return null;
}

/**
 * A Debian version's upstream part: without its epoch and its revision.
 *
 * @param {string} version - e.g. "2.2.0-1~ubuntu26.10.1"
 * @returns {string} e.g. "2.2.0"
 */
export function upstreamVersion(version) {
    let v = version;
    const colon = v.indexOf(':');
    if (colon >= 0)
        v = v.slice(colon + 1);
    const dash = v.lastIndexOf('-');
    return dash > 0 ? v.slice(0, dash) : v;
}

/**
 * The commands to copy, in the form that runs this system's zark.
 *
 * @param {boolean} portable - zark is not installed as a package
 * @returns {{command: string, description: string}[]}
 */
export function aboutCommands(portable) {
    // zark's own rule for a tip (zark_command in its lib/config.py): `zark`
    // when installed, `./zark` from a checkout or a stick.
    const zark = portable ? './zark' : 'zark';
    return COMMANDS.map(c => ({
        command: `${c.root ? 'sudo ' : ''}${zark} ${c.name}`,
        description: c.description,
    }));
}

/**
 * What the About tab shows.
 *
 * @param {object} input
 * @param {{version: string, state: string}|null|undefined} input.dpkg -
 *   parseDpkgStatus()'s result; undefined while dpkg's file is being read
 * @param {{version: string, generatedAt: string, generatedBy: string}|null} input.status -
 *   what status.json says of its writer; null without a status file
 * @param {number} input.statusAtMs - status.generatedAt parsed, NaN when unknown
 * @param {string} input.extensionVersion - metadata.json's version-name
 * @param {string} input.shellVersion - GNOME Shell's Config.PACKAGE_VERSION
 * @param {number} input.nowMs - the reader's clock
 * @returns {object} rows ({label, value, style}), commandsNote, commands
 */
export function aboutView({dpkg, status, statusAtMs, extensionVersion, shellVersion, nowMs}) {
    const rows = [];
    const packaged = Boolean(dpkg);
    if (dpkg === undefined) {
        rows.push({label: 'zark', value: "Reading dpkg's database", style: 'dim'});
    } else if (dpkg) {
        const version = dpkg.version ? `${dpkg.version} ` : '';
        const installed = dpkg.state === 'installed';
        rows.push({
            label: 'zark',
            value: installed ? `${version}(package)` : `${version}(package ${dpkg.state || 'state unknown'})`,
            style: installed ? '' : 'warning',
        });
    } else if (status) {
        rows.push({
            label: 'zark',
            value: `${status.version} (not installed as a package; from the status file)`,
            style: '',
        });
    } else {
        rows.push({label: 'zark', value: 'Not found on this system', style: 'warning'});
    }

    // The status file's writer may be another zark than the package: a
    // portable one, or the package before an upgrade until the next write.
    const differs = !packaged || !dpkg.version || upstreamVersion(dpkg.version) !== status?.version;
    if (status && dpkg !== undefined && differs) {
        const when = Number.isFinite(statusAtMs) ? `, ${formatWhen(statusAtMs, nowMs)}` : '';
        rows.push({label: 'Status file', value: `written by zark ${status.version}${when}`, style: ''});
    }
    rows.push({label: 'Extension', value: extensionVersion, style: ''});
    rows.push({label: 'GNOME Shell', value: shellVersion, style: ''});

    // Portable only when there is evidence of a zark run without the
    // package; with no zark at all, the installed form is the one to come.
    const portable = dpkg === null && Boolean(status);
    let commandsNote = null;
    if (portable)
        commandsNote = 'Run them in the directory that holds zark.';
    else if (dpkg === null)
        commandsNote = 'Once zark is installed:';
    return {rows, commandsNote, commands: aboutCommands(portable)};
}
