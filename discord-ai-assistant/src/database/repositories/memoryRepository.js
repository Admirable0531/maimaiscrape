const { eq, and, like, or } = require('drizzle-orm');
const { getDb } = require('../client');
const { memories } = require('../schema');

const MAX_KEY_LENGTH = 200;
const MAX_VALUE_LENGTH = 2000;

function validate(key, value) {
    if (!key || !key.trim()) return 'Memory key cannot be empty.';
    if (!value || !value.trim()) return 'Memory value cannot be empty.';
    if (key.length > MAX_KEY_LENGTH) return `Memory key is too long (max ${MAX_KEY_LENGTH} characters).`;
    if (value.length > MAX_VALUE_LENGTH) return `Memory value is too long (max ${MAX_VALUE_LENGTH} characters).`;
    return null;
}

/** SQLite's LIKE is case-insensitive for ASCII by default, so a plain (no wildcard) LIKE is an exact case-insensitive key match. */
function findByKey(userId, key) {
    const db = getDb();
    return db
        .select()
        .from(memories)
        .where(and(eq(memories.userId, userId), like(memories.memoryKey, key.trim())))
        .all()[0];
}

/**
 * Upserts by (userId, memoryKey), case-insensitive — matches the spec's
 * "update an existing memory if the same key already exists" rule.
 */
function saveMemory({ userId, guildId, key, value, category }) {
    const error = validate(key, value);
    if (error) return { success: false, error };

    const db = getDb();
    const existing = findByKey(userId, key);

    if (existing) {
        db.update(memories)
            .set({
                memoryValue: value.trim(),
                category: category || existing.category,
                updatedAt: new Date().toISOString(),
            })
            .where(eq(memories.id, existing.id))
            .run();
        return { success: true, updated: true, key: existing.memoryKey };
    }

    db.insert(memories)
        .values({
            userId,
            guildId: guildId || null,
            memoryKey: key.trim(),
            memoryValue: value.trim(),
            category: category || null,
        })
        .run();
    return { success: true, updated: false, key: key.trim() };
}

/** Scoped strictly to userId — never returns another user's memories. */
function searchMemories(userId, query, limit = 5) {
    const db = getDb();
    const trimmedQuery = (query || '').trim();

    const rows = trimmedQuery
        ? db
              .select()
              .from(memories)
              .where(
                  and(
                      eq(memories.userId, userId),
                      or(like(memories.memoryKey, `%${trimmedQuery}%`), like(memories.memoryValue, `%${trimmedQuery}%`))
                  )
              )
              .limit(limit)
              .all()
        : db.select().from(memories).where(eq(memories.userId, userId)).limit(limit).all();

    return rows.map((row) => ({ id: row.id, key: row.memoryKey, value: row.memoryValue, category: row.category }));
}

function listMemories(userId, limit = 25) {
    return searchMemories(userId, null, limit);
}

function forgetMemory(userId, key) {
    const existing = findByKey(userId, key);
    if (!existing) return { success: false, error: `No memory found for "${key}".` };

    const db = getDb();
    db.delete(memories).where(eq(memories.id, existing.id)).run();
    return { success: true, key: existing.memoryKey };
}

module.exports = { saveMemory, searchMemories, listMemories, forgetMemory };
