// SPDX-License-Identifier: GPL-2.0-or-later
//
// The extension's translations. extension.js and prefs.js hand over their
// gettext functions (ExtensionBase binds the domain of metadata.json's
// gettext-domain); until then, and under the tests, every function returns
// the English text. The other modules import from here, so they keep no
// import of GNOME Shell's and stay testable under plain gjs.
//
// Sentences carry named placeholders ("{drive}", "{n}"), filled by fmt(), so a
// translation can put them in its own order. Shown commands, zark's own text
// and names never pass through _(): they reach a sentence as a placeholder.

let translator = null;

/**
 * Use these gettext functions from now on; null goes back to English.
 *
 * @param {{gettext: Function, ngettext: Function, pgettext: Function}|null} source -
 *   the Extension or ExtensionPreferences object, or null
 */
export function setTranslator(source) {
    translator = source;
}

/**
 * @param {string} text - English
 * @returns {string} the translation, or the English text
 */
export function _(text) {
    return translator ? translator.gettext(text) : text;
}

/**
 * @param {string} singular - English, for one
 * @param {string} plural - English, for other counts
 * @param {number} n - the count that picks the form
 * @returns {string} the form for `n`
 */
export function ngettext(singular, plural, n) {
    if (translator)
        return translator.ngettext(singular, plural, n);
    return n === 1 ? singular : plural;
}

/**
 * @param {string} context - what tells two equal English texts apart (e.g. "month")
 * @param {string} text - English
 * @returns {string} the translation, or the English text
 */
export function pgettext(context, text) {
    return translator ? translator.pgettext(context, text) : text;
}

/**
 * Marks a text for the template where it is defined; it is translated with
 * _() where it is shown, once the translator is set.
 *
 * @param {string} text - English
 * @returns {string} the same text
 */
export function N_(text) {
    return text;
}

/**
 * Fills "{name}" placeholders. An unknown placeholder stays as it is, so a
 * translation that misspells one shows it instead of dropping text.
 *
 * @param {string} template - a translated sentence
 * @param {object} values - placeholder name to value
 * @returns {string}
 */
export function fmt(template, values) {
    return template.replace(/\{(\w+)\}/g,
        (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
