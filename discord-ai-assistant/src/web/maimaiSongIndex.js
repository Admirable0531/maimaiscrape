const cheerio = require('cheerio');
const { fetchAccountPage } = require('./maimaiAccountSession');

// record/musicMybest/search/ (the previous approach here) returns exactly
// 20 entries for EVERY diff value (0/1/2/3/4/99), confirmed live against a
// heavily-played account — it's a top-20-by-play-count view, not "every
// song ever played" like it looks on a lightly-played test account where
// the cap never gets hit. record/musicLevel/search/?level=<bucket> has no
// such cap (confirmed live: 214 real entries at level=13 alone) and is
// keyed by the song's own internal level, which we already know from
// loadSongData — so look the song up directly by level bucket instead of
// scanning a capped list.
const DIFFICULTY_PRIORITY = ['master', 'remaster', 'expert', 'advanced', 'basic'];

/** Displayed-level bucket string (e.g. "13", "13+") for an exact internal level, matching musicLevel/search's own convention. */
function levelToBucketLabel(levelValue) {
    const intLevel = Math.floor(levelValue);
    const frac = levelValue - intLevel;
    return frac >= 0.6 - 1e-9 ? `${intLevel}+` : `${intLevel}`;
}

/**
 * Finds this tracked account's musicDetail idx for a song already resolved
 * against loadSongData (so its real chart levels are known) — tries each of
 * the song's distinct level buckets (Master/Re:Master first, since that's
 * what's asked about most), stopping at the first bucket where the account
 * has actually played it. Usually 1-2 requests, never more than the song's
 * own distinct chart levels (at most 5, one per difficulty).
 */
async function findPlayedSongIdx(song) {
    const orderedSheets = [...song.sheets].sort(
        (a, b) => DIFFICULTY_PRIORITY.indexOf(a.difficulty) - DIFFICULTY_PRIORITY.indexOf(b.difficulty)
    );
    const checkedBuckets = new Set();

    for (const sheet of orderedSheets) {
        const level = sheet.internalLevelValue ?? sheet.levelValue;
        if (level == null) continue;
        const bucket = levelToBucketLabel(level);
        if (checkedBuckets.has(bucket)) continue;
        checkedBuckets.add(bucket);

        const { html } = await fetchAccountPage(`/maimai-mobile/record/musicLevel/search/?level=${encodeURIComponent(bucket)}`);
        const $ = cheerio.load(html);
        let foundIdx = null;
        $('[class*="_score_back"]').each((_, block) => {
            if (foundIdx) return;
            const $block = $(block);
            const name = $block.find('.music_name_block').first().text().trim();
            if (name === song.title) {
                foundIdx = $block.find('input[name="idx"]').attr('value') || null;
            }
        });
        if (foundIdx) return foundIdx;
    }
    return null;
}

/** Exact-then-unique-substring title match against loadSongData's song list, same convention as the other maimai tools. */
function findSongInLocalData(songData, query) {
    const q = query.trim().toLowerCase();
    const matches = songData.songs.filter((s) => s.title.toLowerCase().includes(q));
    if (matches.length === 0) return null;
    const exact = matches.find((s) => s.title.toLowerCase() === q);
    if (exact) return exact;
    if (matches.length > 1) return { ambiguous: matches.map((s) => s.title) };
    return matches[0];
}

module.exports = { findSongInLocalData, findPlayedSongIdx, levelToBucketLabel };
