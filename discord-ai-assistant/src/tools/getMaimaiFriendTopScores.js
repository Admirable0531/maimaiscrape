// Talks to the existing Express API (server/express_server.js) — same /users
// and /users/:id/top-score endpoints server/update_user_data.js's daily
// scrape writes (via the mai-tools bookmarklet's "Analyze Rating" click-
// through on SEGA's own site, see that file's getTopScore()). No live
// browser session needed here, just reading what that pipeline already saved.
const { normalizeName } = require('../web/maimaiFriendLookup');

const API_URL = process.env.MAIMAI_API_URL || 'http://localhost:3000';
const TIMEOUT_MS = 15000;

const declaration = {
    name: 'get_maimai_friend_top_scores',
    description:
        "Get one of this tracked account's friends' REAL best-scoring charts and total rating, straight off " +
        'SEGA\'s own rating-breakdown page for that friend (the same page the maimai bookmarklet\'s "Analyze ' +
        'Rating" opens) — not a guess assembled from sampling a few charts. Returns two lists (new_version_top_plays ' +
        "and old_version_top_plays, matching the game's own rating-split categories, each entry with Song/Chart/" +
        "Level/Achv/Rank/Rating) plus snapshot_rating, their total rating AT THE TIME OF THAT SNAPSHOT. IMPORTANT: " +
        "this snapshot comes from a daily scraper that does not run reliably for every friend — snapshot_age_days " +
        "can be months or even years for some friends even though the friend list itself (get_friend_leaderboard) " +
        "updates daily. ALWAYS compare snapshot_rating against current_rating (this friend's live rating, included " +
        "in the same result): if they differ, or snapshot_age_days is large, tell the user plainly that this is an " +
        "old snapshot and their actual top plays may have changed since — never present it as current data without " +
        "that caveat. Use this for \"what's Y's highest rated play / best scores\" — get_maimai_friend_scores " +
        "answers a narrower but always-fresh question (one difficulty constant at a time), and get_maimai_song_" +
        "ranking answers a different direction entirely (who's best on one song, not one friend's best charts).",
    parametersJsonSchema: {
        type: 'object',
        properties: {
            friend_name: { type: 'string', description: "The friend's name (partial match is fine, full-width or plain ASCII both work)." },
        },
        required: ['friend_name'],
    },
};

/** Handles both Date formats seen in stored snapshots: "DD/MM/YYYY HH:mm:ss" and "M/D/YYYY, h:mm:ss AM/PM". */
function parseSnapshotDate(dateStr) {
    if (!dateStr) return null;
    const direct = new Date(dateStr);
    if (!Number.isNaN(direct.getTime())) return direct;
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2}):(\d{2})$/.exec(dateStr.trim());
    if (!m) return null;
    const [, d, mo, y, h, mi, s] = m;
    const dt = new Date(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:${s}`);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

async function findFriend(friendName) {
    const response = await fetch(`${API_URL}/users`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status} from /users`);
    const users = await response.json();

    const target = normalizeName(friendName);
    const friends = users.filter((u) => u.user !== 'ryan' && u.name);
    const exact = friends.find((u) => normalizeName(u.name) === target);
    if (exact) return exact;
    const substring = friends.filter((u) => normalizeName(u.name).includes(target));
    if (substring.length === 1) return substring[0];
    if (substring.length > 1) return { ambiguous: substring.map((u) => u.name) };
    return null;
}

async function execute(args) {
    const friendName = typeof args?.friend_name === 'string' ? args.friend_name.trim() : '';
    if (!friendName) return { success: false, error: 'friend_name is required.' };

    try {
        const friend = await findFriend(friendName);
        if (!friend) {
            return { success: false, error: `No friend matching "${friendName}" found on this account's friend list.` };
        }
        if (friend.ambiguous) {
            return { success: false, error: `Multiple friends match "${friendName}" — be more specific.`, matches: friend.ambiguous };
        }

        const response = await fetch(`${API_URL}/users/${friend.user}/top-score`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.status === 404) {
            return { success: false, error: `No top-score snapshot has ever been recorded for ${friend.name}.` };
        }
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { success: false, error: body.error || `HTTP ${response.status}` };
        }

        const snapshotDate = parseSnapshotDate(body.Date);
        const snapshotAgeDays = snapshotDate ? Math.floor((Date.now() - snapshotDate.getTime()) / 86400000) : null;

        return {
            success: true,
            friend_name: friend.name,
            current_rating: Number(friend.rating) || friend.rating || null,
            snapshot_date: body.Date || null,
            snapshot_age_days: snapshotAgeDays,
            snapshot_rating: body.rating ?? null,
            new_version_top_plays: body.new || [],
            old_version_top_plays: body.old || [],
        };
    } catch (err) {
        return { success: false, error: `Could not reach the maimai stats API: ${err.message}` };
    }
}

module.exports = { declaration, execute };
