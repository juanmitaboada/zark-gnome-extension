// SPDX-License-Identifier: GPL-2.0-or-later
//
// The panel button and its menu, drawn from a view (lib/view.js).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {BarLevel} from 'resource:///org/gnome/shell/ui/barLevel.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export const BACKUP_COMMAND = 'sudo zark backup';

const BLINK_MS = 1000;

function label(text, styleClass = '') {
    const widget = new St.Label({text, style_class: styleClass, x_expand: true});
    widget.clutter_text.line_wrap = true;
    widget.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    widget.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return widget;
}

function bar(fraction, level) {
    return new BarLevel({
        style_class: `zark-bar zark-level-${level}`,
        value: fraction,
        x_expand: true,
    });
}

/**
 * A menu row that shows information and does nothing when clicked.
 *
 * @param {PopupMenu.PopupMenu} menu
 * @param {string} [styleClass]
 * @returns {St.BoxLayout} the row's content box
 */
function infoItem(menu, styleClass = '') {
    // A non-reactive St widget takes the :insensitive style (greyed text), so
    // the row stays reactive but cannot be activated, focused or hovered.
    const item = new PopupMenu.PopupBaseMenuItem({activate: false, hover: false, can_focus: false});
    item.track_hover = false;
    const box = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: `zark-item ${styleClass}`,
        x_expand: true,
    });
    item.add_child(box);
    menu.addMenuItem(item);
    return box;
}

function row(left, right, rightClass = '') {
    const box = new St.BoxLayout({style_class: 'zark-row', x_expand: true});
    box.add_child(new St.Label({text: left, style_class: 'zark-name', x_expand: true}));
    box.add_child(new St.Label({text: right, style_class: `zark-small ${rightClass}`}));
    return box;
}

export const ZarkIndicator = GObject.registerClass(
class ZarkIndicator extends PanelMenu.Button {
    /**
     * @param {string} extensionPath - the extension's directory
     */
    _init(extensionPath) {
        super._init(0.0, 'zark backup status');

        this._iconsDir = GLib.build_filenamev([extensionPath, 'icons']);
        this._gicons = new Map();
        this._icon = new St.Icon({style_class: 'system-status-icon'});
        this.add_child(this._icon);

        this._blinkId = 0;
        this._blinkOn = true;
        this._view = null;
    }

    _gicon(name) {
        if (!this._gicons.has(name)) {
            const file = Gio.File.new_for_path(GLib.build_filenamev([this._iconsDir, `${name}.svg`]));
            this._gicons.set(name, new Gio.FileIcon({file}));
        }
        return this._gicons.get(name);
    }

    /**
     * Show a new view.
     *
     * @param {object} view - from buildView()
     */
    update(view) {
        this._view = view;
        this._updateIcon();
        this._rebuildMenu();
    }

    _updateIcon() {
        const {indicator, icon} = this._view;
        this._icon.style_class = `system-status-icon zark-state-${indicator}`;

        const blink = icon.kind === 'waiting' && St.Settings.get().enable_animations;
        if (blink && !this._blinkId) {
            this._blinkId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, BLINK_MS, () => {
                this._blinkOn = !this._blinkOn;
                this._icon.gicon = this._gicon(this._blinkOn ? 'zark-waiting-on' : 'zark-waiting-off');
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!blink) {
            this._stopBlink();
        }

        if (icon.kind === 'waiting')
            this._icon.gicon = this._gicon(this._blinkOn ? 'zark-waiting-on' : 'zark-waiting-off');
        else if (icon.kind === 'progress')
            this._icon.gicon = this._gicon(`zark-progress-${icon.sectors}`);
        else
            this._icon.gicon = this._gicon('zark-symbolic');
    }

    _stopBlink() {
        if (this._blinkId)
            GLib.Source.remove(this._blinkId);
        this._blinkId = 0;
        this._blinkOn = true;
    }

    _rebuildMenu() {
        const view = this._view;
        const menu = this.menu;
        menu.removeAll();

        const header = infoItem(menu, 'zark-header');
        header.add_child(new St.Label({text: 'zark', style_class: 'zark-title'}));
        header.add_child(label(view.headline, `zark-headline zark-state-${view.indicator}`));

        for (const note of view.notes)
            infoItem(menu).add_child(label(note, 'zark-small zark-note'));

        if (view.run)
            this._addRun(view.run);

        if (view.pools.length) {
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('This computer'));
            for (const pool of view.pools) {
                const box = infoItem(menu);
                box.add_child(row(pool.name, pool.label, `zark-text-${pool.level}`));
                box.add_child(bar(pool.fraction, pool.level));
            }
        }

        if (view.drives.length) {
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Backup drives'));
            for (const drive of view.drives)
                this._addDrive(drive);
        }

        if (view.notices.length) {
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            for (const notice of view.notices)
                infoItem(menu).add_child(label(notice.text, `zark-small zark-text-${notice.level}`));
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const copy = new PopupMenu.PopupMenuItem(`Copy "${BACKUP_COMMAND}"`);
        copy.connect('activate', () =>
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, BACKUP_COMMAND));
        menu.addMenuItem(copy);

        if (view.footer)
            infoItem(menu).add_child(label(view.footer, 'zark-small zark-dim'));
    }

    _addRun(run) {
        const menu = this.menu;
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const box = infoItem(menu);
        box.add_child(row(run.title, run.elapsed));
        if (run.step)
            box.add_child(label(run.step, 'zark-small'));
        if (run.waitingFor)
            box.add_child(label(`Waiting for: ${run.waitingFor}`, 'zark-small zark-waiting'));
        if (run.stalled)
            box.add_child(label(run.stalled, 'zark-small zark-text-warning'));
        if (run.dataset)
            box.add_child(label(run.dataset, 'zark-small zark-mono'));
        if (run.fraction !== null)
            box.add_child(bar(run.fraction, 'progress'));
        if (run.figures)
            box.add_child(label(run.figures, 'zark-small'));
        if (run.transfers)
            box.add_child(label(run.transfers, 'zark-small zark-dim'));
    }

    _addDrive(drive) {
        const box = infoItem(this.menu);
        box.add_child(row(drive.name, drive.connected ? 'Connected' : 'Not connected',
            drive.connected ? 'zark-connected' : 'zark-dim'));
        box.add_child(label(drive.last, `zark-small${drive.lastIsOld ? ' zark-text-warning' : ''}`));
        if (drive.badge)
            box.add_child(label(drive.badge, `zark-small ${drive.badgeAttention ? 'zark-text-critical' : ''}`));
        if (drive.message)
            box.add_child(label(drive.message, 'zark-small zark-dim'));
        box.add_child(bar(drive.fraction, drive.level));
        box.add_child(label(drive.fill, 'zark-small zark-dim'));
    }

    destroy() {
        this._stopBlink();
        this._gicons.clear();
        super.destroy();
    }
});
