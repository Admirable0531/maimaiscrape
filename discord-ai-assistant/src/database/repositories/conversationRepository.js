const { eq, desc, lt, sql } = require('drizzle-orm');
const { getDb } = require('../client');
const { conversations } = require('../schema');

function appendMessage({ userId, guildId, channelId, role, content }) {
    const db = getDb();
    db.insert(conversations)
        .values({ userId, guildId: guildId || null, channelId, role, content })
        .run();
}

/** Last `limit` messages for a channel, returned oldest-first (chronological order for the model). */
function getRecentHistory(channelId, limit = 10) {
    const db = getDb();
    const rows = db
        .select()
        .from(conversations)
        .where(eq(conversations.channelId, channelId))
        .orderBy(desc(conversations.id))
        .limit(limit)
        .all();
    return rows.reverse().map((row) => ({ role: row.role, content: row.content }));
}

/**
 * Deletes conversation rows older than `retentionDays` — only the ephemeral
 * chat-context table, never memories (those are meant to persist). Uses
 * SQLite's own datetime('now', ...) rather than a JS-computed ISO string so
 * the cutoff is in the exact same "YYYY-MM-DD HH:MM:SS" format the
 * CURRENT_TIMESTAMP default actually stores — a JS ISO string's "T"/"Z"
 * would still mostly sort correctly against it, but not reliably so, since
 * TEXT columns compare lexicographically.
 */
function pruneOlderThan(retentionDays) {
    const db = getDb();
    const result = db
        .delete(conversations)
        .where(lt(conversations.createdAt, sql`datetime('now', ${'-' + retentionDays + ' days'})`))
        .run();
    return result.changes;
}

module.exports = { appendMessage, getRecentHistory, pruneOlderThan };
