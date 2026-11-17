// SPDX-License-Identifier: GPL-2.0-or-later
//
// Preferences: which notifications to show, and where the files the
// extension reads are (for tests and screenshots with example files).

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {N_, _, setTranslator} from './lib/i18n.js';

const NOTIFICATIONS = [
    ['notify-overdue', N_('Backup overdue'), N_('Once a day while zark says the newest backup is too old')],
    ['notify-drive', N_('Backup drive plugged in'), N_('When a drive zark knows appears, with its last backup')],
    ['notify-waiting', N_('Question waiting'), N_('When zark has waited 15 s for an answer in its terminal')],
    ['notify-orphan', N_('Run stopped answering'),
        N_('When a zark command ends without cleaning up its progress file')],
    ['notify-drive-gone', N_('Backup drive went away'),
        N_('A dialog to close, when the drive of a running backup goes away')],
];

const FOR_TESTS = N_('It is here so that tests and screenshots can point at example files; ' +
    'leave it as it is otherwise.');

const PATHS = [
    ['status-path', N_('Status file'),
        N_('The status.json zark writes at the end of each command and from its hourly timer: the pools, ' +
        'the backup drives and their last backups, which the menu shows.')],
    ['progress-path', N_('Progress file'),
        N_("The progress.json zark writes while a command runs: the running backup's step and figures.")],
    ['by-id-path', N_('Drive links directory'),
        N_("Where a backup drive's link appears when it is plugged in; the extension looks there for each " +
        'drive zark registered.')],
    ['dpkg-status-path', N_("dpkg's database"),
        N_("dpkg's list of installed packages, read without privileges when the About tab opens, for the " +
        'version of the zark package.')],
];

export default class ZarkPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        setTranslator(this);
        const settings = this.getSettings();
        // Kept with the window, so the bindings live as long as it does.
        window._settings = settings;
        window.add(this._generalPage(settings, window));
        window.add(this._developmentPage(settings));
    }

    _generalPage(settings, window) {
        const page = new Adw.PreferencesPage({title: _('General'), icon_name: 'preferences-system-symbolic'});

        const notifications = new Adw.PreferencesGroup({
            title: _('Notifications'),
            description: _('zark itself notifies when a backup starts and ends, when its drive goes away, ' +
                'and when a pool fills up.'),
        });
        for (const [key, title, subtitle] of NOTIFICATIONS) {
            const row = new Adw.SwitchRow({title: _(title), subtitle: _(subtitle)});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            notifications.add(row);
        }
        page.add(notifications);

        const about = new Adw.PreferencesGroup({
            title: _('About'),
            description: _("Read-only: it reads the status files zark writes and dpkg's database, never starts or " +
                'changes anything, uses no network, and writes to the clipboard only when a Copy button is pressed.'),
        });
        about.add(new Adw.ActionRow({title: _('Version'), subtitle: this.metadata['version-name'] ?? ''}));
        const source = new Adw.ActionRow({title: _('Source code'), subtitle: this.metadata.url, activatable: true});
        source.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        source.connect('activated', () => new Gtk.UriLauncher({uri: this.metadata.url}).launch(window, null, null));
        about.add(source);
        about.add(new Adw.ActionRow({title: _('License'), subtitle: 'GPL-2.0-or-later'}));
        page.add(about);
        return page;
    }

    _developmentPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Development'),
            icon_name: 'applications-engineering-symbolic',
            description: _('Where the extension reads from. Only for tests and screenshots with example files: ' +
                'zark, udev and dpkg write the defaults.'),
        });
        for (const [key, title, what] of PATHS) {
            // Adw.EntryRow has no subtitle (libadwaita 1.9 and 1.10): each
            // entry gets a group of its own, whose description says what it is.
            const group = new Adw.PreferencesGroup({description: `${_(what)} ${_(FOR_TESTS)}`});
            // Applied on Enter or the apply button, not on every key: each
            // change makes the extension watch or read a new path.
            const row = new Adw.EntryRow({title: _(title), text: settings.get_string(key), show_apply_button: true});
            row.connect('apply', () => settings.set_string(key, row.text));
            settings.connect(`changed::${key}`, () => {
                if (row.text !== settings.get_string(key))
                    row.text = settings.get_string(key);
            });
            group.add(row);
            page.add(group);
        }
        const resetGroup = new Adw.PreferencesGroup();
        const reset = new Adw.ButtonRow({title: _('Restore defaults')});
        reset.connect('activated', () => PATHS.forEach(([key]) => settings.reset(key)));
        resetGroup.add(reset);
        page.add(resetGroup);
        return page;
    }
}
