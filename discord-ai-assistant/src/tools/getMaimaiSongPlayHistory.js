const { fetchAccountPage } = require('../web/maimaiAccountSession');
const { loadDocument, extractMeta } = require('../web/htmlExtractor');
const { MYBEST_PATH, parseSongList, findBestMatch } = require('../web/songDetailLookup');
const { maimaiAccountCache } = require('../web/cache');

const LIST_CACHE_KEY = 'maimai-mybest-list';

const declaration = {
    name: 'get_maimai_song_play_history',
    description:
        "Look up this tracked account's play count and per-difficulty last-played date for a specific song, by " +
        'name — e.g. "how many times has this account played Titania" or "when did this account last play ' +
        'sølips on 14+". This is real per-song history the account\'s recent-play log and record pages don\'t ' +
        "show directly. Matches by (case-insensitive, partial) song name against this account's My Best list, so " +
        "it only finds songs the account has played at least once — it won't find a song it's never touched.",
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
        let songs = maimaiAccountCache.get(LIST_CACHE_KEY);
        if (!songs) {
            const { html } = await fetchAccountPage(MYBEST_PATH);
            songs = parseSongList(html);
            maimaiAccountCache.set(LIST_CACHE_KEY, songs);
        }

        const match = findBestMatch(songs, songName);
        if (!match) {
            return { success: false, error: `No song matching "${songName}" found in this account's play history.` };
        }
        if (match.ambiguous) {
            return {
                success: false,
                error: `Multiple songs match "${songName}" — be more specific.`,
                matches: match.ambiguous,
            };
        }

        const { html: detailHtml, finalUrl } = await fetchAccountPage(
            `/maimai-mobile/record/musicDetail/?idx=${encodeURIComponent(match.idx)}`
        );
        const { $ } = loadDocument(detailHtml, finalUrl);
        const meta = extractMeta($, finalUrl);

        return {
            success: true,
            song_name: match.name,
            total_play_count: match.playCount,
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
