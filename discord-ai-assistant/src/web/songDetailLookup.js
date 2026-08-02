const cheerio = require('cheerio');

// Confirmed live: the bare /record/musicMybest/ is just a tab-switcher
// landing page with no results on it — the actual listing needs this
// search/?diff=99 query (diff=99 = "all difficulties"). Lists every song
// this account has ever played, each as a <form method="get" action=".../
// record/musicDetail/"> with the song name, a total PLAY COUNT already
// inline, and a hidden signed `idx` token. Since the form is method="get",
// that token can be reused directly as a query param on musicDetail/ — no
// need to actually simulate a form submit — see findBestMatch/idx usage in
// tools/getMaimaiSongPlayHistory.js.
const MYBEST_PATH = '/maimai-mobile/record/musicMybest/search/?diff=99';

/** Parses the My Best listing HTML into [{name, playCount, idx}]. */
function parseSongList(html) {
    const $ = cheerio.load(html);
    const songs = [];
    $('form[action*="musicDetail"]').each((_, form) => {
        const $form = $(form);
        const name = $form.find('.music_name_block').first().text().trim();
        const idx = $form.find('input[name="idx"]').attr('value');
        const scoreText = $form.find('.music_score_block').first().text();
        // Full-width colon (：), not ':' — confirmed live in the raw HTML.
        const match = /PLAY COUNT[：:]\s*(\d+)/.exec(scoreText);
        const playCount = match ? Number(match[1]) : null;
        if (name && idx) songs.push({ name, playCount, idx });
    });
    return songs;
}

/**
 * Case-insensitive match against a song list — exact match first, then a
 * unique substring match. Returns null (no match), a song object, or
 * {ambiguous: [name, ...]} when multiple songs share the substring.
 */
function findBestMatch(songs, query) {
    const q = query.trim().toLowerCase();
    if (!q) return null;

    const exact = songs.find((s) => s.name.toLowerCase() === q);
    if (exact) return exact;

    const substring = songs.filter((s) => s.name.toLowerCase().includes(q));
    if (substring.length === 1) return substring[0];
    if (substring.length > 1) return { ambiguous: substring.map((s) => s.name) };
    return null;
}

module.exports = { MYBEST_PATH, parseSongList, findBestMatch };
