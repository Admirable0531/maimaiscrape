const conversationRepository = require('../database/repositories/conversationRepository');

const DEFAULT_LIMIT = Number(process.env.MAX_HISTORY_MESSAGES) || 10;

/**
 * Phase 2: backed by SQLite (via conversationRepository) so history survives
 * restarts, replacing Phase 1's in-memory Map. Same two-function surface, so
 * callers didn't need to change.
 */
function getHistory(channelId, limit = DEFAULT_LIMIT) {
    return conversationRepository.getRecentHistory(channelId, limit);
}

function appendMessage({ userId, guildId, channelId, role, content }) {
    conversationRepository.appendMessage({ userId, guildId, channelId, role, content });
}

module.exports = { getHistory, appendMessage };
