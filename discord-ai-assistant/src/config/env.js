const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Without these, nothing in the bot can function, so we fail fast at startup
 * with a clear message instead of surfacing a confusing error later (e.g.
 * Discord login failing, or every message handler throw silently).
 * OWNER_USER_ID is required too — without an owner, nobody could ever grant
 * anyone else permission and the bot would respond to no one, ever.
 */
const REQUIRED = ['DISCORD_TOKEN', 'GEMINI_API_KEY', 'OWNER_USER_ID'];

function loadEnv() {
    const missing = REQUIRED.filter((name) => !process.env[name]);
    if (missing.length > 0) {
        console.error(
            `[config] Missing required environment variables: ${missing.join(', ')}.\n` +
                `[config] Add them to discord-ai-assistant/.env (see .env.example).`
        );
        process.exit(1);
    }

    return {
        discordToken: process.env.DISCORD_TOKEN,
        geminiApiKey: process.env.GEMINI_API_KEY,
        ownerUserId: process.env.OWNER_USER_ID,
        geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
        maxHistoryMessages: Number(process.env.MAX_HISTORY_MESSAGES) || 3,
        replyCooldownMs: Number(process.env.REPLY_COOLDOWN_MS) || 3000,
        conversationRetentionDays: Number(process.env.CONVERSATION_RETENTION_DAYS) || 30,
    };
}

module.exports = { loadEnv };
