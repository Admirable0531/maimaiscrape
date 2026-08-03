const { and, eq, desc, lt, sql } = require('drizzle-orm');
const { getDb } = require('../client');
const { conversations } = require('../schema');

function appendMessage({ userId, guildId, channelId, role, content }) {
    const db = getDb();
    db.insert(conversations)
        .values({ userId, guildId: guildId || null, channelId, role, content })
        .run();
}

/**
 * Last `limit` messages for one user's conversation in a channel, returned
 * oldest-first (chronological order for the model). Scoped by (channelId,
 * userId) together — channelId alone previously mixed every user who'd ever
 * tagged Atri in that channel into one shared history, with no per-speaker
 * attribution, so it would casually bring up one person's earlier
 * conversation to someone else entirely. Memory is already private per
 * user (see memoryRepository.js); conversation history now follows the
 * same rule. assistant-role rows have no real userId (Atri's own replies
 * aren't "said" by anyone) — appendMessage always stores the asking user's
 * id on both their message and Atri's reply to it, so filtering by userId
 * still keeps both sides of that specific conversation together.
 */
function getRecentHistory(channelId, userId, limit = 10) {
    const db = getDb();
    const rows = db
        .select()
        .from(conversations)
        .where(and(eq(conversations.channelId, channelId), eq(conversations.userId, userId)))
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
