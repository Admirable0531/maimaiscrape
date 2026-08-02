const { fetchAccountPage } = require('../web/maimaiAccountSession');
const { MYBEST_PATH, parseSongList, findBestMatch } = require('../web/songDetailLookup');
const { parseRankingFormTokens, parseRankingEntries, parseYourScore } = require('../web/maimaiRankingLookup');
const { maimaiAccountCache } = require('../web/cache');

const LIST_CACHE_KEY = 'maimai-mybest-list';

const declaration = {
    name: 'get_maimai_song_ranking',
    description:
        "Get the achievement-%% ranking for a specific song/difficulty — either this tracked account's friend " +
        'list (scope: "friend") or the global top scores (scope: "global"), each entry with a player name and ' +
        'their achievement %%. Use this for "how many of my friends AP+\'d this song", "who has the highest ' +
        'score on X", or similar per-song leaderboard questions — this is the actual data source for those, not ' +
        'get_friend_leaderboard (which is DX Rating only, not per-song). Any achievement in [100.5000%, ' +
        '101.0000%] on a chart with break notes is guaranteed to be an AP (All Perfect); exactly 101.0000%% means ' +
        'AP+ (every break hit Critical Perfect) — count/filter entries against those thresholds yourself from the ' +
        'returned list rather than assuming a fixed cutoff. Only works for songs this tracked account has played ' +
        'at least once (same limitation as get_maimai_song_play_history) — it won\'t find a song it\'s never touched.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            song_name: { type: 'string', description: 'The song title to look up (partial match is fine).' },
            difficulty: {
                type: 'string',
                enum: ['basic', 'advanced', 'expert', 'master', 'remaster'],
                description: 'Chart difficulty.',
            },
            scope: {
                type: 'string',
                enum: ['friend', 'global'],
                description: 'Whose ranking to fetch — this account\'s friends, or the global top scores. Defaults to "friend".',
            },
            min_achievement_percent: {
                type: 'number',
                description: 'Optional: only return entries at or above this achievement %% (e.g. 100.5 to only see APs). Global rankings can be long, so filtering is recommended when you only care about high scores.',
            },
        },
        required: ['song_name', 'difficulty'],
    },
};

async function execute(args) {
    const songName = typeof args?.song_name === 'string' ? args.song_name.trim() : '';
    const difficulty = typeof args?.difficulty === 'string' ? args.difficulty.toLowerCase() : '';
    const scope = args?.scope === 'global' ? 'global' : 'friend';
    const minAchv = typeof args?.min_achievement_percent === 'number' ? args.min_achievement_percent : null;

    if (!songName) return { success: false, error: 'song_name is required.' };
    if (!difficulty) return { success: false, error: 'difficulty is required.' };

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
            return { success: false, error: `Multiple songs match "${songName}" — be more specific.`, matches: match.ambiguous };
        }

        const { html: detailHtml } = await fetchAccountPage(`/maimai-mobile/record/musicDetail/?idx=${encodeURIComponent(match.idx)}`);
        const tokensByDifficulty = parseRankingFormTokens(detailHtml);
        const rankingIdx = tokensByDifficulty[difficulty];
        if (!rankingIdx) {
            return {
                success: false,
                error: `"${match.name}" has no ${difficulty} chart (or this account has never opened it).`,
                available_difficulties: Object.keys(tokensByDifficulty),
            };
        }

        const diffNum = { basic: 0, advanced: 1, expert: 2, master: 3, remaster: 4 }[difficulty];
        const rankingType = scope === 'global' ? 99 : 3;
        const { html: rankingHtml, finalUrl } = await fetchAccountPage(
            `/maimai-mobile/ranking/musicRankingDetail/?diff=${diffNum}&idx=${encodeURIComponent(rankingIdx)}&rankingType=${rankingType}&scoreType=2`
        );

        let entries = parseRankingEntries(rankingHtml);
        const totalEntries = entries.length;
        if (minAchv !== null) entries = entries.filter((e) => e.achievement >= minAchv);

        return {
            success: true,
            song_name: match.name,
            difficulty,
            scope,
            your_score: parseYourScore(rankingHtml),
            entries,
            total_entries_on_page: totalEntries,
            returned_entries: entries.length,
            url: finalUrl,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { declaration, execute };
