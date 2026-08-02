const cheerio = require('cheerio');

// Confirmed live from the <select name="level"> on
// /maimai-mobile/friend/friendLevelVs/?idx=... — maimai's displayed-level
// buckets (not exact chart constants): "14" covers internal constants
// 14.0-14.5, "14+" covers 14.6-14.9, matching the site's own convention.
// This is the general form of the same mapping Discord_Bot/commands/
// constant/constant.js hardcoded narrowly (only 14.0-15.0, values 21-23) —
// scraped here for the full 1-15 range instead of guessing the pattern.
const LEVEL_BUCKETS = {
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
    '7': 7, '7+': 8, '8': 9, '8+': 10, '9': 11, '9+': 12,
    '10': 13, '10+': 14, '11': 15, '11+': 16, '12': 17, '12+': 18,
    '13': 19, '13+': 20, '14': 21, '14+': 22, '15': 23,
};

/** Maps an exact chart constant (e.g. 14.3) to the displayed-level bucket the friendLevelVs page needs. */
function constantToLevelBucket(constant) {
    const intLevel = Math.floor(constant);
    const frac = constant - intLevel;
    const label = frac >= 0.6 - 1e-9 ? `${intLevel}+` : `${intLevel}`;
    return LEVEL_BUCKETS[label] || null;
}

// Full-width Latin (U+FF01-FF5E) -> ASCII, full-width space -> regular space.
// Friend names on maimai DX NET are commonly stored full-width (e.g.
// "Ｍｉｎｊｉｎ"); asked-for names are typically plain ASCII ("minjin").
function normalizeName(s) {
    return (s || '')
        .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
        .replace(/　/g, ' ')
        .trim()
        .toLowerCase();
}

/** Parses one friend/pages/ listing page into [{name, idx}]. */
function parseFriendListPage(html) {
    const $ = cheerio.load(html);
    const friends = [];
    $('form[action*="friendDetail"]').each((_, form) => {
        const $form = $(form);
        const idx = $form.find('input[name="idx"]').attr('value');
        const container = $form.closest('div, li, tr');
        const text = container.text().replace(/\s+/g, ' ').trim();
        // The name is the leading token before the trailing rating number
        // (confirmed live layout: "ＩＮＦＩＮＩＴＹ 15575").
        const match = text.match(/^(\S+)/);
        if (idx && match) friends.push({ name: match[1], idx });
    });
    return friends;
}

/**
 * Parses a friendLevelVs/battleStart page (scoreType=2, i.e. ACHIEVEMENT)
 * into [{song_name, difficulty, own_achievement, friend_achievement}].
 * Only Master/Re:Master charts are on this page at all (same scope
 * Discord_Bot's /constant already uses) — that's the whole point of the
 * level-bucket filter, which only spans the top of the difficulty curve.
 */
function parseLevelVsEntries(html) {
    const $ = cheerio.load(html);
    const entries = [];
    $('.music_master_score_back, .music_remaster_score_back').each((_, block) => {
        const $block = $(block);
        const songName = $block.find('.music_name_block').first().text().trim();
        if (!songName) return;
        const difficulty = $block.hasClass('music_remaster_score_back') ? 'remaster' : 'master';
        const scoreCells = $block.find('td.master_score_label, td.remaster_score_label');
        const own = scoreCells.eq(0).text().trim();
        const friend = scoreCells.eq(1).text().trim();
        const parsePercent = (s) => {
            if (!s || s.includes('―')) return null;
            const n = parseFloat(s.replace('%', ''));
            return Number.isNaN(n) ? null : n;
        };
        entries.push({
            song_name: songName,
            difficulty,
            own_achievement: parsePercent(own),
            friend_achievement: parsePercent(friend),
        });
    });
    return entries;
}

module.exports = { LEVEL_BUCKETS, constantToLevelBucket, normalizeName, parseFriendListPage, parseLevelVsEntries };
