/**
 * Formatting helpers shared by the scrapers and the Discord reports.
 * These were previously copy-pasted across four scripts.
 */

/** Calendar day as YYYY-MM-DD in UTC. Used as the snapshotDate key in Mongo. */
function getCalendarDayUTC(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD -> DD/MM for embed titles. Returns the input unchanged if it doesn't match. */
function snapshotDayToDDMM(dayStr) {
    const m = String(dayStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}` : dayStr;
}

/** First number in a rating string ("15234 rt" -> 15234). Returns null when absent. */
function parseRatingToNumber(rating) {
    if (rating == null) return null;
    if (typeof rating === 'number') return Number.isFinite(rating) ? rating : null;
    const m = String(rating).match(/(\d+(\.\d+)?)/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : null;
}

function safeName(name) {
    return name ? String(name).trim() : '(unknown)';
}

function formatRatingRt(ratingNum) {
    if (ratingNum == null || !Number.isFinite(ratingNum)) return 'N/A';
    return `${Math.trunc(ratingNum)}rt`;
}

function formatSignedInt(n) {
    if (n == null) return '0';
    const v = Math.trunc(n);
    return (v >= 0 ? '+' : '') + String(v);
}

/**
 * Packs lines into chunks that each stay under maxChars (and maxLines, if given).
 * A single line longer than maxChars gets its own chunk rather than being dropped.
 */
function chunkLines(lines, maxChars = 4000, maxLines = Infinity) {
    const chunks = [];
    let current = [];
    let currentLen = 0;

    for (const line of lines) {
        const tooLong = currentLen + line.length + 1 > maxChars;
        const tooMany = current.length >= maxLines;
        if ((tooLong || tooMany) && current.length > 0) {
            chunks.push(current.join('\n'));
            current = [];
            currentLen = 0;
        }
        current.push(line);
        currentLen += line.length + 1;
    }
    if (current.length > 0) chunks.push(current.join('\n'));
    return chunks;
}

module.exports = {
    getCalendarDayUTC,
    snapshotDayToDDMM,
    parseRatingToNumber,
    safeName,
    formatRatingRt,
    formatSignedInt,
    chunkLines,
};
