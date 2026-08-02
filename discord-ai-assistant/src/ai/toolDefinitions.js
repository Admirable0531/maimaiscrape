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
];

const GEMINI_TOOLS = [{ functionDeclarations: TOOLS.map((tool) => tool.declaration) }];

/**
 * Binds every tool's execute() to this request's real Discord context
 * (userId/guildId). That binding — not any argument the model supplies — is
 * what scopes memory access to the calling user; see searchMemory.js /
 * saveMemory.js for where it's actually used.
 */
function createToolExecutors(context) {
    const executors = {};
    for (const tool of TOOLS) {
        executors[tool.declaration.name] = (args) => tool.execute(args, context);
    }
    return executors;
}

module.exports = { GEMINI_TOOLS, createToolExecutors };
