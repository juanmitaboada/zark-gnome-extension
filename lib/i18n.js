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
 * The count that picks a plural form: GLib's ngettext takes an unsigned
 * integer and throws on a negative one, so a count read from a malformed
 * file is rounded and clamped to 0 or more, the same for both paths.
 *
 * @param {number} n - a count
 * @returns {number} a non-negative integer
 */
function pluralCount(n) {
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/**
 * @param {string} singular - English, for one
 * @param {string} plural - English, for other counts
 * @param {number} n - the count that picks the form
 * @returns {string} the form for `n`
 */
export function ngettext(singular, plural, n) {
    const count = pluralCount(n);
    if (translator)
        return translator.ngettext(singular, plural, count);
    return count === 1 ? singular : plural;
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
 * As N_(), for a text with a context: tr() translates it with pgettext().
 *
 * @param {string} context - what tells two equal English texts apart
 * @param {string} text - English
 * @returns {{context: string, text: string}}
 */
export function NC_(context, text) {
    return {context, text};
}

/**
 * Translates a text marked with N_() or NC_().
 *
 * @param {string|{context: string, text: string}} marked - from N_() or NC_()
 * @returns {string} the translation, or the English text
 */
export function tr(marked) {
    return typeof marked === 'string' ? _(marked) : pgettext(marked.context, marked.text);
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
