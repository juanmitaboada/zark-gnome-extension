// SPDX-License-Identifier: GPL-2.0-or-later
//
// Asynchronous reads and change notification for zark's status files and
// /proc.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const decoder = new TextDecoder();

// Writes come in bursts (a backup's events are at most a second apart);
// one read per burst is enough.
const COALESCE_MS = 200;

/**
 * Read a whole file.
 *
 * @param {string} path
 * @param {Gio.Cancellable} cancellable
 * @returns {Promise<string|null>} the text, null when the file is absent; any
 *   other error rejects
 */
export function readText(path, cancellable) {
    return new Promise((resolve, reject) => {
        Gio.File.new_for_path(path).load_contents_async(cancellable, (file, result) => {
            try {
                const [, bytes] = file.load_contents_finish(result);
                resolve(decoder.decode(bytes));
            } catch (e) {
                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                    resolve(null);
                else
                    reject(e);
            }
        });
    });
}

/**
 * Whether an error only means the read was cancelled by disable().
 *
 * @param {Error} error
 * @returns {boolean}
 */
export function isCancelled(error) {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

/**
 * Watches one file and reports its contents after every change.
 *
 * GLib's file monitor watches the parent directory for the name, so it hears
 * a rename into place and a directory that appears later.
 */
export class FileWatcher {
    /**
     * @param {string} path
     * @param {function(string|null): void} onText - the new contents; null
     *   when the file is absent; '' when it cannot be read
     */
    constructor(path, onText) {
        this._path = path;
        this._onText = onText;
        this._cancellable = new Gio.Cancellable();
        this._monitor = Gio.File.new_for_path(path).monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._monitorId = this._monitor.connect('changed', () => this._schedule());
        this._timeoutId = 0;
        this._sequence = 0;
        this._lastError = null;
        this._read();
    }

    /** Read the file again now. */
    refresh() {
        this._read();
    }

    _schedule() {
        if (this._timeoutId)
            return;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, COALESCE_MS, () => {
            this._timeoutId = 0;
            this._read();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _read() {
        const sequence = ++this._sequence;
        let text;
        try {
            text = await readText(this._path, this._cancellable);
            this._lastError = null;
        } catch (e) {
            if (isCancelled(e))
                return;
            // Log each failure once, not on every change.
            if (e.message !== this._lastError)
                console.warn(`zark: cannot read ${this._path}: ${e.message}`);
            this._lastError = e.message;
            text = '';
        }
        if (sequence === this._sequence)
            this._onText(text);
    }

    destroy() {
        this._cancellable.cancel();
        if (this._timeoutId)
            GLib.Source.remove(this._timeoutId);
        this._timeoutId = 0;
        this._monitor.disconnect(this._monitorId);
        this._monitor.cancel();
    }
}
