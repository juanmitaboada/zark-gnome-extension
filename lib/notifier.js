// SPDX-License-Identifier: GPL-2.0-or-later
//
// Shows the events of lib/events.js as GNOME notifications, each kind behind
// its own setting.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {Event, localDate} from './events.js';
import {BACKUP_COMMAND} from './indicator.js';

const SETTINGS = {
    [Event.OVERDUE]: 'notify-overdue',
    [Event.DRIVE]: 'notify-drive',
    [Event.WAITING]: 'notify-waiting',
    [Event.ORPHAN]: 'notify-orphan',
};

export class Notifier {
    /**
     * @param {Gio.Settings} settings - the extension's settings
     * @param {string} extensionPath - the extension's directory
     * @param {function(string|null): void} openDetails - opens the details dialog on a tab
     */
    constructor(settings, extensionPath, openDetails) {
        this._settings = settings;
        this._openDetails = openDetails;
        this._icon = new Gio.FileIcon({
            file: Gio.File.new_for_path(GLib.build_filenamev([extensionPath, 'icons', 'zark-symbolic.svg'])),
        });
        this._source = null;
    }

    /**
     * @returns {string} the local date of the last overdue notification
     */
    get overdueNotifiedOn() {
        return this._settings.get_string('overdue-notified-on');
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

    /**
     * @param {{kind: string, title: string, body: string, tab: string|null}[]} events
     * @param {number} nowMs - the reader's clock
     */
    show(events, nowMs) {
        for (const event of events) {
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
            notification.connect('activated', () => this._openDetails(event.tab));
            if (event.kind === Event.DRIVE || event.kind === Event.OVERDUE) {
                notification.addAction(`Copy "${BACKUP_COMMAND}"`, () =>
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, BACKUP_COMMAND));
            }
            source.addNotification(notification);
        }
    }

    destroy() {
        this._source?.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
        this._source = null;
    }
}
