// SPDX-License-Identifier: GPL-2.0-or-later
//
// The dialog that tells a backup's drive went away: GNOME Shell's system
// dialog layout, one OK button (Enter and Escape press it too).

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {_} from './i18n.js';

export const AlertDialog = GObject.registerClass(
class ZarkAlertDialog extends ModalDialog.ModalDialog {
    /**
     * @param {string} title - the dialog's title
     * @param {string} description - its text, shown as written
     * @param {Function} onOk - called when OK is pressed, before the dialog closes
     */
    _init(title, description, onOk) {
        super._init({styleClass: 'zark-alert'});
        this.contentLayout.add_child(new Dialog.MessageDialogContent({title, description}));
        this.setButtons([{
            label: _('OK'),
            action: () => {
                onOk();
                this.close();
            },
            key: Clutter.KEY_Escape,
            default: true,
        }]);
    }
});
