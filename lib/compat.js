// SPDX-License-Identifier: GPL-2.0-or-later
//
// What differs between the GNOME Shell versions metadata.json declares,
// kept out of the shell's modules so that the tests can run it.

/**
 * The argument that closes a PopupMenu without animating it.
 *
 * GNOME Shell 50 takes close(animate), a BoxPointer.PopupAnimation; 51
 * takes close(params), with params.animate a boolean
 * (js/ui/popupMenu.js). Given 50's NONE, 51 reads no animate key and
 * animates; given 51's object, 50 would get NaN as a bit mask, which
 * happens to mean no animation, so each version is given its own.
 *
 * @param {string} shellVersion - GNOME Shell's Config.PACKAGE_VERSION
 * @param {number} none - BoxPointer.PopupAnimation.NONE
 * @returns {number|{animate: boolean}}
 */
export function closeWithoutAnimation(shellVersion, none) {
    const major = Number.parseInt(shellVersion, 10);
    return major >= 51 ? {animate: false} : none;
}
