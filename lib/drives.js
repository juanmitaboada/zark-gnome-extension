// SPDX-License-Identifier: GPL-2.0-or-later
//
// Which registered drives are plugged in: a drive is connected when its
// /dev/disk/by-id link exists. Nothing is imported or opened.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class DriveWatcher {
    /**
     * @param {string} dir - the directory of links, /dev/disk/by-id
     * @param {function(): void} onChange - called when links come or go
     */
    constructor(dir, onChange) {
        this._dir = dir;
        this._monitor = Gio.File.new_for_path(dir).monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._monitorId = this._monitor.connect('changed', () => onChange());
    }

    /**
     * @param {string[]} driveIds - registry `drive_id` values
     * @returns {Set<string>} those whose link exists
     */
    connected(driveIds) {
        return new Set(driveIds.filter(id =>
            !id.includes('/') && GLib.file_test(GLib.build_filenamev([this._dir, id]), GLib.FileTest.EXISTS)));
    }

    destroy() {
        this._monitor.disconnect(this._monitorId);
        this._monitor.cancel();
    }
}
