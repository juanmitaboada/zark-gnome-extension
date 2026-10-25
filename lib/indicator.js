// SPDX-License-Identifier: GPL-2.0-or-later
//
// The panel button and its menu, drawn from a view (lib/view.js).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {BarLevel} from 'resource:///org/gnome/shell/ui/barLevel.js';
import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {DetailsDialog} from './details.js';
import {UsageBar} from './usageChart.js';
import {iconFrames} from './view.js';
import {label} from './widgets.js';

export const BACKUP_COMMAND = 'sudo zark backup';

const FRAME_MS = 1000;

// Menu sections, top to bottom; each is rebuilt only when its part of the
// view changes, so a hover survives a progress update.
const SECTIONS = ['header', 'notes', 'run', 'pools', 'drives', 'notices'];

function bar(fraction, level) {
    return new BarLevel({
        style_class: `zark-bar zark-level-${level}`,
        value: fraction,
        x_expand: true,
    });
}

// A pool's bar: what fills it when the file lists its datasets, else its level.
function poolBar(pool) {
    if (!pool.segments)
        return bar(pool.fraction, pool.level);
    const usage = new UsageBar();
    usage.setSegments(pool.segments);
    return usage;
}

/**
 * A menu row that shows information and does nothing when clicked.
 *
 * @param {PopupMenu.PopupMenuBase} menu
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

/**
 * A menu row that opens the details dialog on one of its tabs.
 *
 * @param {PopupMenu.PopupMenuBase} menu
 * @param {function(): void} onActivate
 * @returns {St.BoxLayout} the row's content box
 */
function detailsItem(menu, onActivate) {
    const item = new PopupMenu.PopupBaseMenuItem();
    item.connect('activate', onActivate);
    const box = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'zark-item',
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

        this._frames = ['zark-symbolic'];
        this._frame = 0;
        this._frameId = 0;

        this._sections = new Map();
        this._shown = new Map();
        for (const key of SECTIONS) {
            const section = new PopupMenu.PopupMenuSection();
            this._sections.set(key, section);
            this.menu.addMenuItem(section);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._detailsItem = new PopupMenu.PopupMenuItem('Show details...');
        this._detailsItem.connect('activate', () => this.openDetails(null));
        this._detailsItem.visible = false;
        this.menu.addMenuItem(this._detailsItem);

        this._details = [];
        this._dialog = null;

        const copy = new PopupMenu.PopupMenuItem(`Copy "${BACKUP_COMMAND}"`);
        copy.connect('activate', () =>
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, BACKUP_COMMAND));
        this.menu.addMenuItem(copy);

        this._footer = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._footer);
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
        this._updateIcon(view);

        const section = key => this._sections.get(key);
        this._refresh('header', section('header'), {headline: view.headline, indicator: view.indicator},
            this._fillHeader);
        this._refresh('notes', section('notes'), view.notes, this._fillNotes);
        this._refresh('run', section('run'), view.run, this._fillRun);
        this._refresh('pools', section('pools'), view.pools, this._fillPools);
        this._refresh('drives', section('drives'), view.drives, this._fillDrives);
        this._refresh('notices', section('notices'), view.notices, this._fillNotices);
        this._refresh('footer', this._footer, view.footer, this._fillFooter);

        this._details = view.details;
        this._detailsItem.visible = view.details.length > 0;
        if (this._dialog)
            this._dialog.update(view.details);
    }

    /**
     * Open the details dialog.
     *
     * @param {string|null} tabId - the tab to show; null for the first
     */
    openDetails(tabId) {
        if (!this._details.length || this._dialog)
            return;
        // Close the menu before the dialog takes the input, as the system menu does.
        this.menu.close(PopupAnimation.NONE);
        const known = this._details.some(t => t.id === tabId);
        const dialog = new DetailsDialog(this._details, known ? tabId : this._details[0].id);
        dialog.connect('closed', () => {
            if (this._dialog === dialog)
                this._dialog = null;
        });
        this._dialog = dialog;
        dialog.open();
    }

    _refresh(key, section, part, fill) {
        const json = JSON.stringify(part);
        if (this._shown.get(key) === json)
            return;
        this._shown.set(key, json);
        section.removeAll();
        fill.call(this, section, part);
    }

    _updateIcon(view) {
        this._icon.style_class = `system-status-icon zark-state-${view.indicator}`;

        const frames = iconFrames(view.icon);
        if (frames.join() !== this._frames.join()) {
            // Restart the timer too, so the new first frame stays a full second.
            this._stopFrames();
            this._frames = frames;
        }

        const animate = frames.length > 1 && St.Settings.get().enable_animations;
        if (animate && !this._frameId) {
            this._frameId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FRAME_MS, () => {
                this._frame = (this._frame + 1) % this._frames.length;
                this._icon.gicon = this._gicon(this._frames[this._frame]);
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!animate) {
            this._stopFrames();
        }
        this._icon.gicon = this._gicon(this._frames[this._frame]);
    }

    _stopFrames() {
        if (this._frameId)
            GLib.Source.remove(this._frameId);
        this._frameId = 0;
        this._frame = 0;
    }

    _fillHeader(section, header) {
        const box = infoItem(section, 'zark-header');
        box.add_child(new St.Label({text: 'zark', style_class: 'zark-title'}));
        box.add_child(label(header.headline, `zark-headline zark-state-${header.indicator}`));
    }

    _fillNotes(section, notes) {
        for (const note of notes)
            infoItem(section).add_child(label(note, 'zark-small zark-note'));
    }

    _fillRun(section, run) {
        if (!run)
            return;
        section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const box = infoItem(section);
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

    _fillPools(section, pools) {
        if (!pools.length)
            return;
        section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('This computer'));
        for (const pool of pools) {
            const box = detailsItem(section, () => this.openDetails(pool.tab));
            box.add_child(row(pool.name, pool.label, `zark-text-${pool.level}`));
            box.add_child(poolBar(pool));
        }
    }

    _fillDrives(section, drives) {
        if (!drives.length)
            return;
        section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Backup drives'));
        for (const drive of drives) {
            const box = detailsItem(section, () => this.openDetails(drive.tab));
            box.add_child(row(drive.name, drive.connected ? 'Connected' : 'Not connected',
                drive.connected ? 'zark-connected' : 'zark-dim'));
            const line = new St.BoxLayout({style_class: 'zark-row', x_expand: true});
            line.add_child(new St.Label({
                text: drive.last,
                style_class: `zark-small${drive.lastIsOld ? ' zark-text-warning' : ''}`,
                x_expand: true,
            }));
            line.add_child(new St.Label({text: drive.fill, style_class: 'zark-small zark-dim'}));
            box.add_child(line);
            if (drive.badge) {
                box.add_child(label(drive.badge,
                    `zark-small ${drive.badgeAttention ? 'zark-text-critical' : ''}`));
            }
            box.add_child(bar(drive.fraction, drive.level));
        }
    }

    _fillNotices(section, notices) {
        if (!notices.length)
            return;
        section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (const notice of notices)
            infoItem(section).add_child(label(notice.text, `zark-small zark-text-${notice.level}`));
    }

    _fillFooter(section, footer) {
        if (footer)
            infoItem(section).add_child(label(footer, 'zark-small zark-dim'));
    }

    destroy() {
        if (this._dialog) {
            // Drop the dialog's grab now: close() would wait for its fade-out.
            this._dialog.popModal();
            this._dialog.destroy();
            this._dialog = null;
        }
        this._stopFrames();
        this._gicons.clear();
        super.destroy();
    }
});
