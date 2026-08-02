// Talks to the existing Express API (server/express_server.js) in the
// maimaiscrape repo, not a database this bot owns — that server already
// knows the MongoDB schema and does the same read the /latestfriendsleaderboard
// slash command in Discord_Bot uses, just as JSON.
const API_URL = process.env.MAIMAI_API_URL || 'http://localhost:3000';
const TIMEOUT_MS = 10000;

const declaration = {
    name: 'get_friend_leaderboard',
    description:
        'Get the current maimai DX rating leaderboard for one tracked account\'s in-game friend list — each ' +
        "friend's name, rating, and rank. There are TWO separate real accounts tracked, \"fy\" and \"main\", each " +
        "with their own distinct ~40-friend list — a friend on one is very often NOT on the other. account_type " +
        'defaults to "fy" if omitted, so never assume that\'s the right pool: if the user says "main account" ' +
        'call with account_type: "main"; if you\'re searching for one specific friend by name and don\'t know ' +
        'which account tracks them, call this tool twice (once per account_type) before concluding they\'re not ' +
        'found — do not report "not found" after checking only one. Names on this leaderboard are often written ' +
        'in full-width Unicode characters (e.g. "Ｍｉｎｊｉｎ") — treat those as the same name as their plain-ASCII ' +
        'equivalent ("minjin") when matching, don\'t treat the different character width as a non-match. Use this ' +
        'for questions like "what is X\'s rating", "who has the highest rating", "is X a friend", or "top N ' +
        'friends". This is live tracked data, not something to guess or look up on the web. If the asker is ' +
        "themselves one of the tracked friends, check search_memory first in case they've told you their in-game name before.",
    parametersJsonSchema: {
        type: 'object',
        properties: {
            account_type: {
                type: 'string',
                enum: ['fy', 'main'],
                description: 'Which tracked account\'s friend list to read — "fy" or "main" (default "fy" if omitted; these are two different friend lists, see the tool description).',
            },
        },
    },
};

async function execute(args) {
    const accountType = args?.account_type === 'main' ? 'main' : 'fy';
    try {
        const response = await fetch(`${API_URL}/api/friends-leaderboard?accountType=${accountType}`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.success) {
            return { success: false, error: body.error || `HTTP ${response.status}` };
        }
        return { success: true, accountType: body.accountType, snapshotDate: body.snapshotDate, friends: body.friends };
    } catch (err) {
        return { success: false, error: `Could not reach the maimai stats API: ${err.message}` };
    }
}

module.exports = { declaration, execute };
