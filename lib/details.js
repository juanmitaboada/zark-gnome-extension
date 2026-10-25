// SPDX-License-Identifier: GPL-2.0-or-later
//
// The details dialog: one tab per source pool and per backup drive, drawn
// from the view's `details` (lib/view.js).

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {UsageBar, UsageChart} from './usageChart.js';
import {label} from './widgets.js';

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

        const largest = vbox('zark-largest');
        largest.add_child(new St.Label({text: 'Largest datasets', style_class: 'zark-small zark-name'}));
        for (const dataset of usage.largest) {
            largest.add_child(label(dataset.name, 'zark-small zark-mono'));
            largest.add_child(label(dataset.detail, 'zark-small zark-dim'));
        }
        largest.add_child(label(usage.measured, 'zark-small zark-dim'));
        this._body.add_child(largest);
    }

    _fillDrive(tab) {
        this._body.add_child(label(tab.summary,
            `zark-small zark-details-summary ${tab.connected ? 'zark-connected' : 'zark-dim'}`));
        if (tab.segments) {
            const bar = new UsageBar('zark-usage-bar-large');
            bar.setSegments(tab.segments);
            this._body.add_child(bar);
        }
        this._body.add_child(label(tab.fill, 'zark-small zark-dim'));

        const rows = vbox('zark-facts');
        for (const row of tab.rows) {
            const line = new St.BoxLayout({style_class: 'zark-fact', x_expand: true});
            line.add_child(new St.Label({text: row.label, style_class: 'zark-small zark-dim zark-fact-label'}));
            const style = {warning: 'zark-text-warning', critical: 'zark-text-critical', mono: 'zark-mono'}[row.style];
            line.add_child(label(row.value, `zark-small ${style ?? ''}`));
            rows.add_child(line);
        }
        this._body.add_child(rows);
    }
});
