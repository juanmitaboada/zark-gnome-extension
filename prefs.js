// SPDX-License-Identifier: GPL-2.0-or-later
//
// Preferences: which notifications to show, and where the status files are
// (for tests with example files).

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const NOTIFICATIONS = [
    ['notify-overdue', 'Backup overdue', 'Once a day while zark says the newest backup is too old'],
    ['notify-drive', 'Backup drive plugged in', 'When a drive zark knows appears, with its last backup'],
    ['notify-waiting', 'Question waiting', 'When zark has waited 15 s for an answer in its terminal'],
    ['notify-orphan', 'Run stopped answering', 'When a zark command ends without cleaning up its progress file'],
];

const PATHS = [
    ['status-path', 'Status file'],
    ['progress-path', 'Progress file'],
    ['by-id-path', 'Drive links directory'],
];

export default class ZarkPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // Kept with the window, so the bindings live as long as it does.
        window._settings = settings;
        window.add(this._generalPage(settings, window));
        window.add(this._developmentPage(settings));
    }

    _generalPage(settings, window) {
        const page = new Adw.PreferencesPage({title: 'General', icon_name: 'preferences-system-symbolic'});

        const notifications = new Adw.PreferencesGroup({
            title: 'Notifications',
            description: 'zark itself notifies when a backup starts and ends and when a pool fills up.',
        });
        for (const [key, title, subtitle] of NOTIFICATIONS) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            notifications.add(row);
        }
        page.add(notifications);

        const about = new Adw.PreferencesGroup({
            title: 'About',
            description: 'Read-only: it reads the status files zark writes, never starts or changes anything, ' +
                'uses no network, and writes to the clipboard only when a Copy button is pressed.',
        });
        about.add(new Adw.ActionRow({title: 'Version', subtitle: this.metadata['version-name'] ?? ''}));
        const source = new Adw.ActionRow({title: 'Source code', subtitle: this.metadata.url, activatable: true});
        source.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        source.connect('activated', () => new Gtk.UriLauncher({uri: this.metadata.url}).launch(window, null, null));
        about.add(source);
        about.add(new Adw.ActionRow({title: 'License', subtitle: 'GPL-2.0-or-later'}));
        page.add(about);
        return page;
    }

    _developmentPage(settings) {
        const page = new Adw.PreferencesPage({title: 'Development', icon_name: 'applications-engineering-symbolic'});
        const group = new Adw.PreferencesGroup({
            title: 'Files',
            description: 'Where the extension reads from. Change them only to test with example files; ' +
                'zark writes the defaults.',
        });
        for (const [key, title] of PATHS) {
            // Applied on Enter or the apply button, not on every key: each
            // change makes the extension watch a new path.
            const row = new Adw.EntryRow({title, text: settings.get_string(key), show_apply_button: true});
            row.connect('apply', () => settings.set_string(key, row.text));
            settings.connect(`changed::${key}`, () => {
                if (row.text !== settings.get_string(key))
                    row.text = settings.get_string(key);
            });
            group.add(row);
        }
        const reset = new Adw.ButtonRow({title: 'Restore defaults'});
        reset.connect('activated', () => PATHS.forEach(([key]) => settings.reset(key)));
        group.add(reset);
        page.add(group);
        return page;
    }
}
