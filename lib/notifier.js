// SPDX-License-Identifier: GPL-2.0-or-later
//
// Shows the events of lib/events.js as GNOME notifications, each kind behind
// its own setting, and a backup's drive gone away as a dialog to close.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {AlertDialog} from './alert.js';
import {Event, localDate} from './events.js';
import {isCancelled} from './files.js';
import {_, fmt} from './i18n.js';
import {ancestry} from './procinfo.js';
import {BACKUP_COMMAND} from './view.js';

const SETTINGS = {
    [Event.OVERDUE]: 'notify-overdue',
    [Event.DRIVE]: 'notify-drive',
    [Event.WAITING]: 'notify-waiting',
    [Event.ORPHAN]: 'notify-orphan',
};

/**
 * The window of the terminal zark runs in: the first of zark's ancestors
 * (sudo, the shell, the terminal) that owns a window.
 *
 * @param {number} pid - zark's process
 * @param {Gio.Cancellable} cancellable
 * @returns {Promise<Meta.Window|null>}
 */
async function terminalWindow(pid, cancellable) {
    const chain = await ancestry(pid, cancellable);
    const windows = global.get_window_actors().map(a => a.meta_window);
    for (const ancestor of chain) {
        const window = windows.find(w => w.get_pid() === ancestor);
        if (window)
            return window;
    }
    return null;
}

export class Notifier {
    /**
     * @param {Gio.Settings} settings - the extension's settings
     * @param {string} extensionPath - the extension's directory
     */
    constructor(settings, extensionPath) {
        this._settings = settings;
        this._icon = new Gio.FileIcon({
            file: Gio.File.new_for_path(GLib.build_filenamev([extensionPath, 'icons', 'zark-symbolic.svg'])),
        });
        this._source = null;
        this._questions = new Map();
        this._alert = null;
        this._cancellable = new Gio.Cancellable();
    }

    /**
     * The drive-gone dialog for `event.key`, unless it is already open. OK
     * stores the key, so the reader stops asking for it; a dialog closed any
     * other way (the extension disabled, the screen locked) leaves the key
     * unacknowledged, and the dialog comes back at the next enable.
     *
     * @param {{title: string, body: string, key: string}} event - a DRIVE_GONE event
     */
    _showAlert(event) {
        if (this._alert?.key === event.key)
            return;
        this._dropAlert();
        const dialog = new AlertDialog(event.title, event.body,
            () => this._settings.set_string('drive-gone-acknowledged', event.key));
        dialog.connect('closed', () => {
            if (this._alert?.dialog === dialog)
                this._alert = null;
        });
        this._alert = {key: event.key, dialog};
        // Not shown (no grab): the next reading tries again.
        if (!dialog.open()) {
            this._alert = null;
            dialog.destroy();
        }
    }

    _dropAlert() {
        if (!this._alert)
            return;
        const {dialog} = this._alert;
        this._alert = null;
        dialog.popModal();
        dialog.destroy();
    }

    // The tray destroys a source once its last notification goes, so it is
    // made again when needed.
    _getSource() {
        if (!this._source) {
            this._source = new MessageTray.Source({title: 'zark', icon: this._icon});
            this._source.connect('destroy', () => {
                this._source = null;
            });
            Main.messageTray.add(this._source);
        }
        return this._source;
    }

    async _focusTerminal(pid) {
        try {
            const window = await terminalWindow(pid, this._cancellable);
            if (window)
                Main.activateWindow(window);
        } catch (e) {
            if (!isCancelled(e))
                console.warn(`zark: cannot find zark's terminal: ${e.message}`);
        }
    }

    /**
     * @param {{kind: string, title: string, body: string, key: string|null, pid: number|null}[]} events
     * @param {number} nowMs - the reader's clock
     */
    show(events, nowMs) {
        for (const event of events) {
            if (event.kind === Event.ANSWERED) {
                this._questions.get(event.key)?.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
                continue;
            }
            // Its setting is read in lib/events.js, with the acknowledged key.
            if (event.kind === Event.DRIVE_GONE) {
                this._showAlert(event);
                continue;
            }
            if (!this._settings.get_boolean(SETTINGS[event.kind]))
                continue;
            if (event.kind === Event.OVERDUE)
                this._settings.set_string('overdue-notified-on', localDate(nowMs));

            const source = this._getSource();
            const notification = new MessageTray.Notification({
                source,
                title: event.title,
                body: event.body,
                gicon: this._icon,
                urgency: event.kind === Event.ORPHAN
                    ? MessageTray.Urgency.HIGH
                    : MessageTray.Urgency.NORMAL,
            });
            if (event.kind === Event.WAITING) {
                notification.connect('activated', () => this._focusTerminal(event.pid));
                this._questions.set(event.key, notification);
                notification.connect('destroy', () => this._questions.delete(event.key));
            }
            if (event.kind === Event.DRIVE || event.kind === Event.OVERDUE) {
                notification.addAction(fmt(_('Copy "{command}"'), {command: BACKUP_COMMAND}), () =>
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, BACKUP_COMMAND));
            }
            source.addNotification(notification);
        }
    }

    destroy() {
        this._cancellable.cancel();
        this._dropAlert();
        this._questions.clear();
        this._source?.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
        this._source = null;
    }
}
