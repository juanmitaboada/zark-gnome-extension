// SPDX-License-Identifier: GPL-2.0-or-later
//
// Text for sizes, ages and durations. Binary units, as zfs list and
// zpool list show them.

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
        return 'just now';
    if (minutes < 60)
        return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
}

/**
 * @param {number} seconds - a duration
 * @returns {string} e.g. "1 h 12 min"
 */
export function formatDuration(seconds) {
    if (seconds < 60)
        return 'under a minute';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60)
        return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
        return `today ${time}`;
    if (days === 1)
        return `yesterday ${time}`;
    return `${date.getDate()} ${MONTHS[date.getMonth()]} ${time}`;
}

/**
 * @param {number} ms - the moment
 * @returns {string} "19 Oct", in local time
 */
export function formatDate(ms) {
    const date = new Date(ms);
    return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/**
 * @param {number} fraction - 0 to 1
 * @returns {string} e.g. "44%"
 */
export function formatPercent(fraction) {
    return `${Math.floor(fraction * 100)}%`;
}
