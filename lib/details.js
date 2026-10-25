// SPDX-License-Identifier: GPL-2.0-or-later
//
// The details dialog: one tab per source pool and per backup drive, drawn
// from the view's `details` (lib/view.js).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {MonthChart, UsageBar, UsageChart} from './usageChart.js';
import {PRUNE_COMMAND} from './view.js';
import {label} from './widgets.js';

const SORTS = [['size', 'Data'], ['snapshots', 'Snapshots']];

// A table cell: a size, right-aligned.
function sizeCell(text) {
    return new St.Label({text, style_class: 'zark-small', x_align: Clutter.ActorAlign.END});
}

// A dataset's name, the part shared with other rows dimmed.
function nameCell(prefix, name) {
    const cell = new St.Label({style_class: 'zark-small zark-mono zark-dataset', x_expand: true});
    const escape = text => GLib.markup_escape_text(text, -1);
    cell.clutter_text.set_markup(`<span alpha="55%">${escape(prefix)}</span>${escape(name)}`);
    cell.clutter_text.ellipsize = Pango.EllipsizeMode.START;
    return cell;
}

function vbox(styleClass) {
    return new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: styleClass, x_expand: true});
}

export const DetailsDialog = GObject.registerClass(
class ZarkDetailsDialog extends ModalDialog.ModalDialog {
    /**
     * @param {object[]} tabs - the view's `details`
     * @param {string} tabId - the tab to show first
     */
    _init(tabs, tabId) {
        super._init({styleClass: 'zark-details'});

        this._tabBar = new St.BoxLayout({style_class: 'zark-tabs', x_align: Clutter.ActorAlign.CENTER});
        this.contentLayout.add_child(this._tabBar);
        this._body = vbox('zark-details-body');
        this.contentLayout.add_child(this._body);

        this.setButtons([{
            label: 'Close',
            action: () => this.close(),
            key: Clutter.KEY_Escape,
            default: true,
        }]);

        this._tabs = [];
        this._shown = null;
        this._buttons = new Map();
        this._current = tabId;
        this._sort = 'size';
        this.update(tabs);
    }

    /**
     * Show new details, keeping the current tab when it still exists.
     *
     * @param {object[]} tabs - the view's `details`
     */
    update(tabs) {
        const ids = tabs.map(t => t.id).join();
        if (ids !== this._tabs.map(t => t.id).join())
            this._buildTabBar(tabs);
        this._tabs = tabs;
        if (!tabs.some(t => t.id === this._current))
            this._current = tabs.length ? tabs[0].id : null;
        this._showCurrent();
    }

    _buildTabBar(tabs) {
        this._tabBar.destroy_all_children();
        this._buttons.clear();
        let kind = null;
        for (const tab of tabs) {
            // A gap between the pools and the drives.
            if (kind !== null && tab.kind !== kind)
                this._tabBar.add_child(new St.Widget({style_class: 'zark-tab-gap'}));
            kind = tab.kind;
            const button = new St.Button({
                label: tab.title,
                style_class: 'zark-tab',
                toggle_mode: true,
                can_focus: true,
            });
            button.connect('clicked', () => {
                this._current = tab.id;
                this._showCurrent();
            });
            this._buttons.set(tab.id, button);
            this._tabBar.add_child(button);
        }
    }

    _showCurrent() {
        for (const [id, button] of this._buttons)
            button.checked = id === this._current;
        const tab = this._tabs.find(t => t.id === this._current);
        // Rebuild only on a change, as the menu does: a view arrives every few seconds.
        const json = JSON.stringify(tab ?? null);
        if (json === this._shown)
            return;
        this._shown = json;
        this._body.destroy_all_children();
        if (!tab)
            return;
        if (tab.kind === 'pool')
            this._fillPool(tab);
        else
            this._fillDrive(tab);
    }

    _fillPool(tab) {
        this._body.add_child(label(tab.summary, 'zark-small zark-dim zark-details-summary'));
        const usage = tab.usage;
        if (!usage)
            return;

        const chartRow = new St.BoxLayout({style_class: 'zark-chart-row', x_expand: true});
        const chart = new UsageChart();
        chart.setSegments(usage.segments);
        chartRow.add_child(chart);
        const legend = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'zark-legend',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        for (const entry of usage.legend) {
            const line = new St.BoxLayout({style_class: 'zark-legend-row', x_expand: true});
            line.add_child(new St.Widget({
                style_class: `zark-swatch zark-seg-${entry.id}`,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            line.add_child(new St.Label({text: entry.label, style_class: 'zark-small', x_expand: true}));
            line.add_child(new St.Label({text: entry.size, style_class: 'zark-small'}));
            legend.add_child(line);
        }
        chartRow.add_child(legend);
        this._body.add_child(chartRow);
        this._body.add_child(label(usage.snapshots, 'zark-small'));

        this._body.add_child(this._datasetTable(usage));
        this._body.add_child(label(usage.note, 'zark-small zark-dim'));
        this._fillCleanup(tab.cleanup);
    }

    _datasetTable(usage) {
        const layout = new Clutter.GridLayout({column_spacing: 14, row_spacing: 2});
        const table = new St.Widget({layout_manager: layout, style_class: 'zark-table', x_expand: true});
        layout.attach(new St.Label({text: 'Dataset', style_class: 'zark-small zark-dim', x_expand: true}), 0, 0, 1, 1);
        SORTS.forEach(([key, title], i) => {
            const on = key === this._sort;
            const box = new St.BoxLayout({style_class: 'zark-sort-box'});
            box.add_child(new St.Label({text: title, y_align: Clutter.ActorAlign.CENTER}));
            if (on)
                box.add_child(new St.Icon({icon_name: 'pan-down-symbolic', style_class: 'zark-sort-icon'}));
            const button = new St.Button({
                child: box,
                style_class: `zark-sort zark-small${on ? ' zark-sort-on' : ''}`,
                can_focus: true,
                x_align: Clutter.ActorAlign.END,
            });
            button.connect('clicked', () => {
                this._sort = key;
                this._shown = null;
                this._showCurrent();
            });
            layout.attach(button, i + 1, 0, 1, 1);
        });
        const rows = this._sort === 'snapshots' ? usage.bySnapshots : usage.bySize;
        rows.forEach((row, i) => {
            layout.attach(nameCell(row.prefix, row.name), 0, i + 1, 1, 1);
            layout.attach(sizeCell(row.data), 1, i + 1, 1, 1);
            layout.attach(sizeCell(row.snapshots), 2, i + 1, 1, 1);
        });
        return table;
    }

    _fillCleanup(notices) {
        if (!notices.length)
            return;
        const box = vbox('zark-cleanup');
        box.add_child(new St.Label({text: 'Cleanup', style_class: 'zark-small zark-name'}));
        for (const notice of notices)
            box.add_child(label(notice.text, `zark-small zark-text-${notice.level}`));
        const copy = new St.Button({
            label: `Copy "${PRUNE_COMMAND}"`,
            style_class: 'zark-copy zark-small',
            can_focus: true,
            x_align: Clutter.ActorAlign.START,
        });
        copy.connect('clicked', () =>
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, PRUNE_COMMAND));
        box.add_child(copy);
        this._body.add_child(box);
    }

    _fillDrive(tab) {
        this._body.add_child(label(tab.summary,
            `zark-small zark-details-summary ${tab.connected ? 'zark-connected' : 'zark-dim'}`));
        if (tab.segments) {
            const bar = new UsageBar('zark-usage-bar-large');
            bar.setSegments(tab.segments);
            bar.setMarker(tab.marker);
            this._body.add_child(bar);
        }
        this._body.add_child(label(tab.fill, 'zark-small zark-dim'));

        const rows = vbox('zark-facts');
        for (const row of tab.rows) {
            const line = new St.BoxLayout({style_class: 'zark-fact', x_expand: true});
            line.add_child(new St.Label({text: row.label, style_class: 'zark-small zark-dim zark-fact-label'}));
            const style = {
                ok: 'zark-connected',
                waiting: 'zark-waiting',
                warning: 'zark-text-warning',
                critical: 'zark-text-critical',
                mono: 'zark-mono',
            }[row.style];
            line.add_child(label(row.value, `zark-small ${style ?? ''}`));
            rows.add_child(line);
        }
        this._body.add_child(rows);
        if (tab.contents)
            this._fillContents(tab.contents);
    }

    _fillContents(contents) {
        if (contents.months) {
            const box = vbox('zark-points');
            box.add_child(new St.Label({text: 'Backup points on the drive', style_class: 'zark-small zark-name'}));
            box.add_child(label(contents.summary, 'zark-small zark-dim'));
            const chart = new MonthChart();
            chart.setMonths(contents.months);
            box.add_child(chart);
            const ends = new St.BoxLayout({style_class: 'zark-row', x_expand: true});
            const months = contents.months;
            ends.add_child(new St.Label({text: months[0].label, style_class: 'zark-small zark-dim', x_expand: true}));
            ends.add_child(new St.Label({text: months[months.length - 1].label, style_class: 'zark-small zark-dim'}));
            box.add_child(ends);
            if (contents.next)
                box.add_child(label(contents.next, 'zark-small'));
            if (contents.otherSnapshots)
                box.add_child(label(contents.otherSnapshots, 'zark-small zark-dim'));
            this._body.add_child(box);
        } else if (contents.next) {
            this._body.add_child(label(contents.next, 'zark-small'));
        }
        if (contents.datasets) {
            this._body.add_child(this._datasetTable(contents.datasets));
            this._body.add_child(label(contents.datasets.note, 'zark-small zark-dim'));
        }
    }
});
