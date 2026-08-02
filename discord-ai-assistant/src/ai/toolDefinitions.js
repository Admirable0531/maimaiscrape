const searchMemoryTool = require('../tools/searchMemory');
const saveMemoryTool = require('../tools/saveMemory');
const searchWebTool = require('../tools/searchWeb');
const readWebpageTool = require('../tools/readWebpage');
const readWebpageSectionsTool = require('../tools/readWebpageSections');
const searchMaimaiSongsTool = require('../tools/searchMaimaiSongs');
const getFriendLeaderboardTool = require('../tools/getFriendLeaderboard');
const getCircleRankingsTool = require('../tools/getCircleRankings');
const listMaimaiFandomWikiPagesTool = require('../tools/listMaimaiFandomWikiPages');
const listMaimaiRemywikiPagesTool = require('../tools/listMaimaiRemywikiPages');
const listMaimaiAccountPagesTool = require('../tools/listMaimaiAccountPages');
const getMaimaiSongPlayHistoryTool = require('../tools/getMaimaiSongPlayHistory');
const getMaimaiScoreBreakdownTool = require('../tools/getMaimaiScoreBreakdown');
const getMaimaiSongRatingTool = require('../tools/getMaimaiSongRating');
const getMaimaiSongRankingTool = require('../tools/getMaimaiSongRanking');
const getMaimaiFriendScoresTool = require('../tools/getMaimaiFriendScores');
const { getAllowedScopes } = require('../permissions/permissionStore');

const TOOLS = [
    searchMemoryTool,
    saveMemoryTool,
    searchWebTool,
    readWebpageTool,
    readWebpageSectionsTool,
    searchMaimaiSongsTool,
    getFriendLeaderboardTool,
    getCircleRankingsTool,
    listMaimaiFandomWikiPagesTool,
    listMaimaiRemywikiPagesTool,
    listMaimaiAccountPagesTool,
    getMaimaiSongPlayHistoryTool,
    getMaimaiScoreBreakdownTool,
    getMaimaiSongRatingTool,
    getMaimaiSongRankingTool,
    getMaimaiFriendScoresTool,
];

const GEMINI_TOOLS = [{ functionDeclarations: TOOLS.map((tool) => tool.declaration) }];

/**
 * Which scope (see permissionStore.js's VALID_SCOPES) each tool requires.
 * read_webpage/read_webpage_sections are dynamic — see requiredScope()
 * below — since the SAME tool serves both generic pages (web) and this
 * tracked account's maimaidx-eng.com pages (account), depending on the url
 * argument, not the tool name.
 */
const TOOL_SCOPES = {
    search_web: 'web',
    search_maimai_songs: 'web',
    get_maimai_score_breakdown: 'web',
    get_maimai_song_rating: 'web',
    list_maimai_fandom_wiki_pages: 'web',
    list_maimai_remywiki_pages: 'web',
    list_maimai_account_pages: 'account',
    get_maimai_song_play_history: 'account',
    get_maimai_song_ranking: 'account',
    get_maimai_friend_scores: 'account',
    get_friend_leaderboard: 'leaderboard',
    get_circle_rankings: 'leaderboard',
    search_memory: 'memory',
    save_memory: 'memory',
};

function requiredScope(toolName, args) {
    if (toolName === 'read_webpage' || toolName === 'read_webpage_sections') {
        const url = typeof args?.url === 'string' ? args.url : '';
        try {
            if (new URL(url).hostname.toLowerCase() === 'maimaidx-eng.com') return 'account';
        } catch {
            // not a parseable URL -> falls through to the generic 'web' scope;
            // the tool's own validation will reject it either way
        }
        return 'web';
    }
    return TOOL_SCOPES[toolName] || null;
}

/**
 * Binds every tool's execute() to this request's real Discord context
 * (userId/guildId), gated by that user's granted scopes (permissionStore.js)
 * — resolved once per message, not per call, so a scope change mid-
 * conversation doesn't retroactively affect calls already in flight. That
 * binding, not any argument the model supplies, is also what scopes memory
 * access to the calling user; see searchMemory.js / saveMemory.js.
 */
function createToolExecutors(context) {
    const scopes = getAllowedScopes(context.userId, context.guildId); // 'all' | string[]
    const executors = {};
    for (const tool of TOOLS) {
        const name = tool.declaration.name;
        executors[name] = (args) => {
            const scope = requiredScope(name, args);
            if (scope && scopes !== 'all' && !scopes.includes(scope)) {
                return {
                    success: false,
                    error: `You don't have permission to use this — it requires "${scope}" access. Ask the bot owner to grant it.`,
                };
            }
            return tool.execute(args, context);
        };
    }
    return executors;
}

module.exports = { GEMINI_TOOLS, createToolExecutors };
