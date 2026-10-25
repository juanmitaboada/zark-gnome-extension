// SPDX-License-Identifier: GPL-2.0-or-later
//
// Which registered drives are plugged in: a drive is connected when its
// /dev/disk/by-id link exists. Nothing is imported or opened.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BY_ID = '/dev/disk/by-id';

export class DriveWatcher {
    /**
     * @param {function(): void} onChange - called when links come or go
     */
    constructor(onChange) {
        this._monitor = Gio.File.new_for_path(BY_ID).monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._monitorId = this._monitor.connect('changed', () => onChange());
    }

    /**
     * @param {string[]} driveIds - registry `drive_id` values
     * @returns {Set<string>} those whose link exists
     */
    connected(driveIds) {
        return new Set(driveIds.filter(id =>
            !id.includes('/') && GLib.file_test(`${BY_ID}/${id}`, GLib.FileTest.EXISTS)));
    }

    destroy() {
        this._monitor.disconnect(this._monitorId);
        this._monitor.cancel();
    }
}
