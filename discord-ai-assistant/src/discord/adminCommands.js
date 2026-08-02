const { allowUser, revokeUser, listAllowedUsers, getOwnerId } = require('../permissions/permissionStore');

/** Matches either a Discord mention (`<@id>` / `<@!id>`) or a bare 15-20 digit snowflake. */
const MENTION_OR_ID = /^(?:<@!?(\d+)>|(\d{15,20}))$/;

function extractUserId(token) {
    const match = MENTION_OR_ID.exec(token.trim());
    if (!match) return null;
    return match[1] || match[2];
}

/**
 * Owner-only text commands for managing who the bot will talk to. Only
 * called for messages from the owner (see messageHandler) — a non-owner
 * typing "allow @x" just gets treated as a normal chat message to Gemini.
 *
 *   allow <@user or id>
 *   revoke <@user or id>
 *   allowed
 *
 * Returns a reply string if `text` matched a command, or null if it didn't
 * — the caller should fall through to the normal AI reply on null.
 */
function tryHandleAdminCommand(text) {
    const trimmed = text.trim();

    const allowMatch = /^allow\s+(\S+)$/i.exec(trimmed);
    if (allowMatch) {
        const userId = extractUserId(allowMatch[1]);
        if (!userId) return `I couldn't read a user from "${allowMatch[1]}" — mention them or give their user ID.`;
        const added = allowUser(userId);
        return added ? `Granted <@${userId}> permission to use this bot.` : `<@${userId}> already has permission.`;
    }

    const revokeMatch = /^revoke\s+(\S+)$/i.exec(trimmed);
    if (revokeMatch) {
        const userId = extractUserId(revokeMatch[1]);
        if (!userId) return `I couldn't read a user from "${revokeMatch[1]}" — mention them or give their user ID.`;
        if (userId === getOwnerId()) return "I can't revoke the owner's permission.";
        const removed = revokeUser(userId);
        return removed ? `Revoked <@${userId}>'s permission.` : `<@${userId}> didn't have permission to begin with.`;
    }

    if (/^(allowed|permissions)$/i.test(trimmed)) {
        const ids = listAllowedUsers();
        return `Users with permission: ${ids.map((id) => `<@${id}>`).join(', ')}`;
    }

    return null;
}

module.exports = { tryHandleAdminCommand };
