// SPDX-License-Identifier: GPL-2.0-or-later
//
// zark backup status: a read-only view of zark's status files in the top bar.

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ZarkIndicator} from './lib/indicator.js';
import {Notifier} from './lib/notifier.js';
import {StatusReader} from './lib/reader.js';

export default class ZarkExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new ZarkIndicator(this.path);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._notifier = new Notifier(this._settings, this.path);
        this._reader = new StatusReader(this._settings,
            view => this._indicator.update(view),
            (events, nowMs) => this._notifier.show(events, nowMs));
    }

    disable() {
        this._reader.destroy();
        this._reader = null;
        this._notifier.destroy();
        this._notifier = null;
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
