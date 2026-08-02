const cheerio = require('cheerio');

// Confirmed live: each musicDetail/?idx=... page has one hidden
// <form action=".../ranking/musicRankingDetail/"> per difficulty the song
// has, each with its own diff number (0=basic..4=remaster, standard maimai
// convention) and its own signed idx token — a different token than the one
// used to reach musicDetail itself, and required to reach the ranking page.
const DIFF_NUM_BY_DIFFICULTY = { basic: 0, advanced: 1, expert: 2, master: 3, remaster: 4 };

/** Maps difficulty -> ranking-page idx token, for whichever difficulties this song actually has. */
function parseRankingFormTokens(musicDetailHtml) {
    const $ = cheerio.load(musicDetailHtml);
    const tokensByDiffNum = {};
    $('form[action*="musicRankingDetail"]').each((_, form) => {
        const $form = $(form);
        const diffNum = $form.find('input[name="diff"]').attr('value');
        const idx = $form.find('input[name="idx"]').attr('value');
        if (diffNum !== undefined && idx) tokensByDiffNum[diffNum] = idx;
    });
    const tokensByDifficulty = {};
    for (const [difficulty, num] of Object.entries(DIFF_NUM_BY_DIFFICULTY)) {
        if (tokensByDiffNum[String(num)]) tokensByDifficulty[difficulty] = tokensByDiffNum[String(num)];
    }
    return tokensByDifficulty;
}

/**
 * Parses a musicRankingDetail page (scoreType=2, i.e. ACHIEVEMENT) into
 * ranked {name, achievement, is_you} entries, in on-page rank order.
 * Works for both rankingType=99 (EX/global) and rankingType=3 (friend) —
 * global rows also carry a date, which isn't parsed out separately since
 * it's not needed for AP/AP+ counting.
 */
function parseRankingEntries(html) {
    const $ = cheerio.load(html);
    const entries = [];
    $('.ranking_top_inner_block, .ranking_inner_block').each((i, el) => {
        const $el = $(el);
        const lines = $el
            .text()
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
        if (lines.length === 0) return;
        const name = lines[0];
        const scoreLine = lines.find((l) => l.includes('%'));
        const achievement = scoreLine ? parseFloat(scoreLine.replace('%', '')) : null;
        if (name && achievement !== null) {
            entries.push({ rank: i + 1, name, achievement, is_you: $el.hasClass('ranking_you') });
        }
    });
    return entries;
}

/**
 * Pulls this tracked account's own "Your SCORE" achievement % shown at the
 * top of the ranking page, if present. There's a closing </div> between the
 * label and the value in the raw markup (confirmed live), so this matches
 * loosely across it rather than assuming plain whitespace.
 */
function parseYourScore(html) {
    const match = /Your SCORE[\s\S]{0,50}?([\d.]+%)/.exec(html);
    return match ? match[1] : null;
}

module.exports = { DIFF_NUM_BY_DIFFICULTY, parseRankingFormTokens, parseRankingEntries, parseYourScore };
