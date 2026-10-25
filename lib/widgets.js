// SPDX-License-Identifier: GPL-2.0-or-later
//
// Small widget helpers shared by the menu and the details dialog.

import Pango from 'gi://Pango';
import St from 'gi://St';

/**
 * A label that wraps instead of ellipsizing.
 *
 * @param {string} text
 * @param {string} [styleClass]
 * @returns {St.Label}
 */
export function label(text, styleClass = '') {
    const widget = new St.Label({text, style_class: styleClass, x_expand: true});
    widget.clutter_text.line_wrap = true;
    widget.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    widget.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return widget;
}
