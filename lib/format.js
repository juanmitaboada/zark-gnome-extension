// SPDX-License-Identifier: GPL-2.0-or-later
//
// Text for sizes, ages and durations. Binary units, as zfs list and
// zpool list show them. The unit symbols stay as they are in every language.

import {_, fmt, ngettext, pgettext} from './i18n.js';

const UNITS = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

/**
 * @param {number} bytes - a size in bytes
 * @returns {string} e.g. "854.6 GiB"
 */
export function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    let value = bytes;
    let unit = -1;
    do {
        value /= 1024;
        unit++;
    } while (value >= 1024 && unit < UNITS.length - 1);
    return `${value.toFixed(1)} ${UNITS[unit]}`;
}

/**
 * @param {number} bytesPerSecond - a rate
 * @returns {string} e.g. "112.0 MiB/s"
 */
export function formatRate(bytesPerSecond) {
    return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * @param {number} ms - time elapsed
 * @returns {string} e.g. "3 hours ago"
 */
export function formatAge(ms) {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1)
        // Translators: an age, as "3 hours ago"; it fills {age} in other texts
        return _('just now');
    if (minutes < 60)
        // Translators: an age; "min" is a unit and stays as it is
        return fmt(_('{n} min ago'), {n: minutes});
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return fmt(ngettext('{n} hour ago', '{n} hours ago', hours), {n: hours});
    const days = Math.floor(hours / 24);
    return fmt(ngettext('{n} day ago', '{n} days ago', days), {n: days});
}

/**
 * @param {number} seconds - a duration
 * @returns {string} e.g. "1 h 12 min"
 */
export function formatDuration(seconds) {
    if (seconds < 60)
        // Translators: a duration; it fills {duration} in other texts
        return _('under a minute');
    const minutes = Math.round(seconds / 60);
    if (minutes < 60)
        // Translators: a duration; "min" is a unit and stays as it is
        return fmt(_('{n} min'), {n: minutes});
    // Translators: a duration; "h" and "min" are units and stay as they are
    return fmt(_('{hours} h {minutes} min'), {hours: Math.floor(minutes / 60), minutes: minutes % 60});
}

/**
 * The months' short names, built at each call so that they follow the
 * translator set in enable().
 *
 * @returns {string[]} January first
 */
export function monthNames() {
    return [
        // Translators: a month's short name, as in "19 Oct"
        pgettext('month', 'Jan'), pgettext('month', 'Feb'), pgettext('month', 'Mar'),
        pgettext('month', 'Apr'), pgettext('month', 'May'), pgettext('month', 'Jun'),
        pgettext('month', 'Jul'), pgettext('month', 'Aug'), pgettext('month', 'Sep'),
        pgettext('month', 'Oct'), pgettext('month', 'Nov'), pgettext('month', 'Dec'),
    ];
}

function pad(n) {
    return n < 10 ? `0${n}` : `${n}`;
}

function dayNumber(date) {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

/**
 * A moment in local time, relative to today.
 *
 * @param {number} ms - the moment
 * @param {number} nowMs - the reader's clock
 * @returns {string} "today 11:45", "yesterday 08:02" or "19 Oct 08:02"
 */
export function formatWhen(ms, nowMs) {
    const date = new Date(ms);
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const days = dayNumber(new Date(nowMs)) - dayNumber(date);
    if (days === 0)
        // Translators: a moment; {time} is "09:18"; it fills {when} in other texts
        return fmt(_('today {time}'), {time});
    if (days === 1)
        // Translators: a moment; {time} is "09:18"; it fills {when} in other texts
        return fmt(_('yesterday {time}'), {time});
    return fmt(_('{day} {month} {time}'), {day: date.getDate(), month: monthNames()[date.getMonth()], time});
}

/**
 * @param {number} ms - the moment
 * @returns {string} "19 Oct", in local time
 */
export function formatDate(ms) {
    const date = new Date(ms);
    return fmt(_('{day} {month}'), {day: date.getDate(), month: monthNames()[date.getMonth()]});
}

/**
 * @param {number} fraction - 0 to 1
 * @returns {string} e.g. "44%"
 */
export function formatPercent(fraction) {
    return fmt(_('{percent}%'), {percent: Math.floor(fraction * 100)});
}
