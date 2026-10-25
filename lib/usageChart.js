// SPDX-License-Identifier: GPL-2.0-or-later
//
// A pool's space as a donut or as a bar, one arc or stretch per segment of
// lib/usage.js. The colours come from the stylesheet (-zark-<segment>-color),
// so the light and dark stylesheets can each pick their own.

import GObject from 'gi://GObject';
import St from 'gi://St';

// Gap between two arcs, in radians; arcs smaller than two gaps get none.
const GAP = 0.02;

export const UsageChart = GObject.registerClass(
class ZarkUsageChart extends St.DrawingArea {
    _init() {
        super._init({style_class: 'zark-donut'});
        this._segments = [];
    }

    /**
     * @param {{id: string, bytes: number}[]} segments - in drawing order
     */
    setSegments(segments) {
        this._segments = segments;
        this.queue_repaint();
    }

    vfunc_repaint() {
        const node = this.get_theme_node();
        const thickness = node.get_length('-zark-donut-thickness');
        const [width, height] = this.get_surface_size();
        const total = this._segments.reduce((sum, s) => sum + s.bytes, 0);

        const cr = this.get_context();
        if (total > 0) {
            const radius = Math.min(width, height) / 2 - thickness / 2;
            cr.setLineWidth(thickness);
            let angle = -Math.PI / 2;
            for (const segment of this._segments) {
                const sweep = 2 * Math.PI * segment.bytes / total;
                if (sweep > 0) {
                    const gap = sweep > 2 * GAP ? GAP : 0;
                    cr.arc(width / 2, height / 2, radius, angle + gap / 2, angle + sweep - gap / 2);
                    cr.setSourceColor(node.get_color(`-zark-${segment.id}-color`));
                    cr.stroke();
                }
                angle += sweep;
            }
        }
        cr.$dispose();
    }
});

export const UsageBar = GObject.registerClass(
class ZarkUsageBar extends St.DrawingArea {
    /**
     * @param {string} [styleClass] - more style classes, e.g. for the height
     */
    _init(styleClass = '') {
        super._init({style_class: `zark-usage-bar ${styleClass}`, x_expand: true});
        this._segments = [];
        this._marker = null;
    }

    /**
     * @param {number|null} fraction - where to draw a mark, from the left; null for none
     */
    setMarker(fraction) {
        this._marker = fraction;
        this.queue_repaint();
    }

    /**
     * @param {{id: string, bytes: number}[]} segments - left to right
     */
    setSegments(segments) {
        this._segments = segments;
        this.queue_repaint();
    }

    vfunc_repaint() {
        const node = this.get_theme_node();
        const [width, height] = this.get_surface_size();
        const total = this._segments.reduce((sum, s) => sum + s.bytes, 0);

        const cr = this.get_context();
        if (total > 0 && width > 0 && height > 0) {
            // Rounded ends, as GNOME's own bars have.
            const r = height / 2;
            cr.newSubPath();
            cr.arc(r, r, r, Math.PI / 2, 3 * Math.PI / 2);
            cr.arc(width - r, r, r, -Math.PI / 2, Math.PI / 2);
            cr.closePath();
            cr.clip();

            let x = 0;
            for (const segment of this._segments) {
                const w = width * segment.bytes / total;
                if (w > 0) {
                    // A 1 px gap between stretches wide enough to keep one.
                    cr.rectangle(x, 0, w > 3 ? w - 1 : w, height);
                    cr.setSourceColor(node.get_color(`-zark-${segment.id}-color`));
                    cr.fill();
                }
                x += w;
            }

            if (this._marker !== null) {
                cr.resetClip();
                cr.rectangle(Math.round(width * this._marker) - 1, 0, 2, height);
                cr.setSourceColor(node.get_color('-zark-marker-color'));
                cr.fill();
            }
        }
        cr.$dispose();
    }
});

export const MonthChart = GObject.registerClass(
class ZarkMonthChart extends St.DrawingArea {
    _init() {
        super._init({style_class: 'zark-months', x_expand: true});
        this._months = [];
    }

    /**
     * @param {{count: number, next: boolean}[]} months - oldest first
     */
    setMonths(months) {
        this._months = months;
        this.queue_repaint();
    }

    vfunc_repaint() {
        const node = this.get_theme_node();
        const [width, height] = this.get_surface_size();
        const most = Math.max(1, ...this._months.map(m => m.count));
        const cr = this.get_context();
        const n = this._months.length;
        if (n > 0) {
            const slot = width / n;
            const gap = Math.min(3, slot / 4);
            this._months.forEach((month, i) => {
                // A month with points always shows: a 2 px stub at least.
                const h = month.count ? Math.max(2, height * month.count / most) : 0;
                cr.rectangle(i * slot + gap / 2, height - h, slot - gap, h);
                cr.setSourceColor(node.get_color(month.next ? '-zark-marker-color' : '-zark-used-color'));
                cr.fill();
            });
        }
        cr.$dispose();
    }
});
