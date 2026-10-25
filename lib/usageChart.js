// SPDX-License-Identifier: GPL-2.0-or-later
//
// A donut of a pool's space, one arc per segment of lib/usage.js. The
// colours come from the stylesheet (-zark-<segment>-color), so the light
// and dark stylesheets can each pick their own.

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
