// Talks to the existing Express API (server/express_server.js) in the
// maimaiscrape repo, not a database this bot owns — that server already
// knows the MongoDB schema and does the same read the /latestfriendsleaderboard
// slash command in Discord_Bot uses, just as JSON.
const API_URL = process.env.MAIMAI_API_URL || 'http://localhost:3000';
const TIMEOUT_MS = 10000;

const declaration = {
    name: 'get_friend_leaderboard',
    description:
        "Get the current maimai DX rating leaderboard for this group's tracked friend accounts — each " +
        "friend's name, rating, and rank. Use this for questions like \"what is X's rating\", \"who has the " +
        'highest rating", or "top N friends". This is live tracked data, not something to guess or look up on the web. ' +
        "If the asker is themselves one of the tracked friends, check search_memory first in case they've told you their in-game name before.",
    parametersJsonSchema: {
        type: 'object',
        properties: {
            account_type: {
                type: 'string',
                enum: ['fy', 'main'],
                description: 'Which tracked account\'s friend list to read (default "fy" if omitted).',
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
