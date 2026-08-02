const { allowUser, revokeUser, listAllowedUsers, getOwnerId, VALID_SCOPES } = require('../permissions/permissionStore');

/** Matches either a Discord mention (`<@id>` / `<@!id>`) or a bare 15-20 digit snowflake. */
const MENTION_OR_ID = /^(?:<@!?(\d+)>|(\d{15,20}))$/;

function extractUserId(token) {
    const match = MENTION_OR_ID.exec(token.trim());
    if (!match) return null;
    return match[1] || match[2];
}

const SCOPE_DESCRIPTIONS = {
    web: 'wiki/search/song-data tools (search_web, read_webpage, list_maimai_*_pages, search_maimai_songs)',
    account: "this tracked account's own live maimai data (list_maimai_account_pages, and read_webpage for maimaidx-eng.com specifically)",
    leaderboard: "this group's tracked friend ratings and circle rankings",
    memory: 'remembering/recalling things about the asking user',
};

/**
 * Owner-only text commands for managing who the bot will talk to and what
 * they can use. Only called for messages from the owner (see
 * messageHandler) — a non-owner typing "allow @x" just gets treated as a
 * normal chat message to Gemini.
 *
 *   allow <@user or id>                    -> full access (every tool)
 *   allow <@user or id> <scope> [scope...] -> access limited to those scopes
 *   revoke <@user or id>
 *   allowed
 *   scopes
 *
 * Returns a reply string if `text` matched a command, or null if it didn't
 * — the caller should fall through to the normal AI reply on null.
 */
function tryHandleAdminCommand(text) {
    const trimmed = text.trim();

    const allowMatch = /^allow\s+(\S+)(?:\s+(.+))?$/i.exec(trimmed);
    if (allowMatch) {
        const userId = extractUserId(allowMatch[1]);
        if (!userId) return `I couldn't read a user from "${allowMatch[1]}" — mention them or give their user ID.`;

        const scopeTokens = allowMatch[2] ? allowMatch[2].trim().split(/\s+/) : [];
        if (scopeTokens.length === 0) {
            const added = allowUser(userId);
            return added ? `Granted <@${userId}> full permission to use this bot.` : `<@${userId}> already has full permission.`;
        }

        const normalized = [...new Set(scopeTokens.map((s) => s.toLowerCase()))];
        const invalid = normalized.filter((s) => !VALID_SCOPES.includes(s));
        if (invalid.length > 0) {
            return `Unknown scope(s): ${invalid.join(', ')}. Valid scopes: ${VALID_SCOPES.join(', ')} (see "scopes" for what each covers).`;
        }

        const added = allowUser(userId, normalized);
        return added
            ? `Granted <@${userId}> access to: ${normalized.join(', ')}.`
            : `Updated <@${userId}>'s access to: ${normalized.join(', ')}.`;
    }

    const revokeMatch = /^revoke\s+(\S+)$/i.exec(trimmed);
    if (revokeMatch) {
        const userId = extractUserId(revokeMatch[1]);
        if (!userId) return `I couldn't read a user from "${revokeMatch[1]}" — mention them or give their user ID.`;
        if (userId === getOwnerId()) return "I can't revoke the owner's permission.";
        const removed = revokeUser(userId);
        return removed ? `Revoked <@${userId}>'s permission.` : `<@${userId}> didn't have permission to begin with.`;
    }

    if (/^scopes$/i.test(trimmed)) {
        return VALID_SCOPES.map((s) => `**${s}**: ${SCOPE_DESCRIPTIONS[s]}`).join('\n');
    }

    if (/^(allowed|permissions)$/i.test(trimmed)) {
        const { full, scoped } = listAllowedUsers();
        const lines = [`Full access: ${full.map((id) => `<@${id}>`).join(', ')}`];
        for (const s of scoped) {
            lines.push(`<@${s.id}>: ${s.scopes.join(', ')}`);
        }
        return lines.join('\n');
    }

    return null;
}

module.exports = { tryHandleAdminCommand };
