const { fetchAccountPage } = require('../web/maimaiAccountSession');
const { loadDocument, extractMeta } = require('../web/htmlExtractor');
const { loadSongData } = require('../web/maimaiSongData');
const { findSongInLocalData, findPlayedSongIdx } = require('../web/maimaiSongIndex');

const declaration = {
    name: 'get_maimai_song_play_history',
    description:
        "Look up this tracked account's per-difficulty play count and last-played date for a specific song, by " +
        'name — e.g. "how many times has this account played Titania" or "when did this account last play ' +
        'sølips on 14+". This is real per-song history the account\'s recent-play log and record pages don\'t ' +
        "show directly. It only finds a chart the account has actually played at least once — it won't find one " +
        "it's never touched.",
    parametersJsonSchema: {
        type: 'object',
        properties: {
            song_name: { type: 'string', description: 'The song title to look up (partial match is fine).' },
        },
        required: ['song_name'],
    },
};

async function execute(args) {
    const songName = typeof args?.song_name === 'string' ? args.song_name.trim() : '';
    if (!songName) return { success: false, error: 'song_name is required.' };

    try {
        const songData = await loadSongData();
        const song = findSongInLocalData(songData, songName);
        if (!song) return { success: false, error: `No song matching "${songName}" found.` };
        if (song.ambiguous) {
            return { success: false, error: `Multiple songs match "${songName}" — be more specific.`, matches: song.ambiguous };
        }

        const idx = await findPlayedSongIdx(song);
        if (!idx) {
            return { success: false, error: `"${song.title}" doesn't appear in this account's play history — it hasn't been played (on any difficulty).` };
        }

        const { html: detailHtml, finalUrl } = await fetchAccountPage(
            `/maimai-mobile/record/musicDetail/?idx=${encodeURIComponent(idx)}`
        );
        const { $ } = loadDocument(detailHtml, finalUrl);
        const meta = extractMeta($, finalUrl);

        return {
            success: true,
            song_name: song.title,
            // Per-difficulty breakdown (level, last played date, play count,
            // achievement %) is embedded in this text, not worth a bespoke
            // parser for — it reads fine as-is, same as any other page's text.
            detail_text: meta.text,
            url: finalUrl,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { declaration, execute };
