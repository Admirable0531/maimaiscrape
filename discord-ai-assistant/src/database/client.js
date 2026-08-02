const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const logger = require('../utils/logger');

const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'bot.db');

/**
 * Bootstrapped directly with CREATE TABLE IF NOT EXISTS rather than
 * drizzle-kit migrations — there are only two tables and no schema history
 * to manage yet. If the schema in schema.js changes later, update this SQL
 * to match (and write a manual ALTER for existing databases).
 */
const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    guild_id TEXT,
    memory_key TEXT NOT NULL,
    memory_value TEXT NOT NULL,
    category TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_memories_user_key ON memories(user_id, memory_key);

CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    guild_id TEXT,
    channel_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel_id, id);
`;

let db = null;

function getDb() {
    if (db) return db;

    fs.mkdirSync(DATA_DIR, { recursive: true });
    const sqlite = new Database(DB_PATH);
    sqlite.pragma('journal_mode = WAL');
    sqlite.exec(CREATE_TABLES_SQL);

    db = drizzle(sqlite);
    logger.info('database', `SQLite ready at ${DB_PATH}`);
    return db;
}

module.exports = { getDb };
