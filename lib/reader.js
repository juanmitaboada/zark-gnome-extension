// SPDX-License-Identifier: GPL-2.0-or-later
//
// Keeps the latest reading of zark's status files and turns it into a view
// whenever a file, a drive or the clock changes.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {FileState, PROGRESS_KIND, STATUS_KIND, parseFile} from './contract.js';
import {DriveWatcher} from './drives.js';
import {FileWatcher, isCancelled} from './files.js';
import {readBootId, readProcess} from './procinfo.js';
import {newEvents, snapshot} from './events.js';
import {classifyProgress} from './state.js';
import {buildView} from './view.js';

// While a command runs the heartbeat rule needs the clock (stalled after
// 30 s without a file event); otherwise ages and staleness move slowly.
const TICK_RUNNING_S = 5;
const TICK_IDLE_S = 60;

export class StatusReader {
    /**
     * @param {Gio.Settings} settings - the extension's settings
     * @param {function(object): void} onView - receives every new view
     * @param {function(object[], number): void} onEvents - receives the
     *   notifications a reading calls for, with the reader's clock
     */
    constructor(settings, onView, onEvents) {
        this._settings = settings;
        this._onView = onView;
        this._onEvents = onEvents;
        this._cancellable = new Gio.Cancellable();

        this._bootId = null;
        this._progressParsed = {state: FileState.ABSENT, data: null};
        this._statusParsed = {state: FileState.ABSENT, data: null};
        this._lastGoodStatus = null;
        this._proc = {pidExists: false, startTicks: null};
        this._runKey = null;
        this._transferSeen = false;
        // Events start once both files have been read: that first reading
        // is the baseline.
        this._read = {progress: false, status: false};
        this._snapshot = null;

        this._tickId = 0;
        this._tickSeconds = 0;
        this._watchers = [];
        this._drives = null;
        this._settingsIds = ['changed::status-path', 'changed::progress-path', 'changed::by-id-path']
            .map(signal => settings.connect(signal, () => this._watch()));

        this._start();
    }

    async _start() {
        try {
            this._bootId = await readBootId(this._cancellable);
        } catch (e) {
            if (isCancelled(e))
                return;
            console.warn(`zark: cannot read the boot id: ${e.message}`);
            this._bootId = '';
        }
        this._watch();
    }

    _watch() {
        this._watchers.forEach(w => w.destroy());
        this._drives?.destroy();
        this._read = {progress: false, status: false};
        this._snapshot = null;
        this._drives = new DriveWatcher(this._settings.get_string('by-id-path'), () => this._update());
        this._watchers = [
            new FileWatcher(this._settings.get_string('progress-path'), text => this._onProgress(text)),
            new FileWatcher(this._settings.get_string('status-path'), text => this._onStatus(text)),
        ];
    }

    async _onProgress(text) {
        this._read.progress = true;
        this._progressParsed = parseFile(text, PROGRESS_KIND);
        const data = this._progressParsed.data;
        if (data) {
            const key = `${data.pid}:${data.started_at}`;
            if (key !== this._runKey) {
                this._runKey = key;
                this._transferSeen = false;
            }
            if (data.transfer)
                this._transferSeen = true;
        }
        await this._readProcess();
        this._update();
    }

    _onStatus(text) {
        this._read.status = true;
        this._statusParsed = parseFile(text, STATUS_KIND);
        if (this._statusParsed.state === FileState.OK)
            this._lastGoodStatus = this._statusParsed.data;
        this._update();
    }

    async _readProcess() {
        const data = this._progressParsed.data;
        if (!data)
            return;
        try {
            this._proc = await readProcess(data.pid, this._cancellable);
        } catch (e) {
            if (!isCancelled(e))
                throw e;
        }
    }

    _setTick(seconds) {
        if (seconds === this._tickSeconds)
            return;
        if (this._tickId)
            GLib.Source.remove(this._tickId);
        this._tickSeconds = seconds;
        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._onTick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    async _onTick() {
        await this._readProcess();
        this._update();
    }

    _update() {
        if (this._bootId === null || this._cancellable.is_cancelled())
            return;

        const nowMs = Date.now();
        const progressClass = classifyProgress(this._progressParsed,
            {bootId: this._bootId, ...this._proc}, nowMs);
        const statusShown = this._statusParsed.state === FileState.OK
            ? this._statusParsed.data
            : this._lastGoodStatus;
        const driveIds = statusShown ? statusShown.drives.map(d => d.drive_id) : [];

        this._setTick(this._progressParsed.state === FileState.ABSENT ? TICK_IDLE_S : TICK_RUNNING_S);
        const input = {
            progressParsed: this._progressParsed,
            progressClass,
            statusParsed: this._statusParsed,
            statusShown,
            connected: this._drives.connected(driveIds),
            transferSeen: this._transferSeen,
            nowMs,
        };
        this._onView(buildView(input));

        if (!this._read.progress || !this._read.status)
            return;
        const next = snapshot(input);
        const events = newEvents(this._snapshot, next, input, this._settings.get_string('overdue-notified-on'));
        this._snapshot = next;
        if (events.length)
            this._onEvents(events, nowMs);
    }

    destroy() {
        this._cancellable.cancel();
        if (this._tickId)
            GLib.Source.remove(this._tickId);
        this._tickId = 0;
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        this._watchers.forEach(w => w.destroy());
        this._watchers = [];
        this._drives?.destroy();
        this._drives = null;
    }
}
