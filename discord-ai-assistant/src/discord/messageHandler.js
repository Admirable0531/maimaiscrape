const logger = require('../utils/logger');
const { getHistory, appendMessage } = require('../conversation/historyStore');
const { generateReply } = require('../ai/agent');
const { isOwner } = require('../permissions/permissionStore');
const { tryHandleAdminCommand } = require('./adminCommands');

const DISCORD_MESSAGE_LIMIT = 2000;
const REPLY_CONTEXT_MAX_LENGTH = 800;

/** userId -> last reply timestamp (ms). Simple in-memory cooldown, not persisted. */
const lastReplyAtByUser = new Map();

/**
 * Trigger: @-mentioned in a guild channel, or a DM from the owner. DMs from
 * anyone else are ignored — the bot doesn't respond to being messaged
 * directly except for the owner's own admin/chat access.
 */
function shouldRespond(message, clientUserId) {
    if (message.author.bot) return false;
    if (!message.guild) return isOwner(message.author.id);
    return message.mentions.has(clientUserId);
}

function isOnCooldown(userId, cooldownMs) {
    const last = lastReplyAtByUser.get(userId);
    if (last === undefined) return false;
    return Date.now() - last < cooldownMs;
}

/** Strips a leading bot mention so it doesn't pollute the prompt sent to Gemini. */
function stripMention(content, clientUserId) {
    return content.replace(new RegExp(`^<@!?${clientUserId}>\\s*`), '').trim();
}

function truncateForDiscord(text) {
    if (text.length <= DISCORD_MESSAGE_LIMIT) return text;
    return `${text.slice(0, DISCORD_MESSAGE_LIMIT - 20)}\n\n...(truncated)`;
}

/**
 * If this message is a Discord reply, fetches the message it replied to and
 * returns {author, content} for quoting into the prompt — null if it isn't
 * a reply, or if the referenced message couldn't be fetched (deleted,
 * permissions, etc.), in which case the caller just proceeds without it
 * rather than failing the whole response.
 */
async function buildReplyContext(message) {
    if (!message.reference?.messageId) return null;
    try {
        const referenced = await message.fetchReference();
        const author =
            referenced.author?.id === message.client.user.id ? 'Atri (you)' : referenced.author?.tag || 'someone';

        let content = referenced.content?.trim() || '';
        if (!content && referenced.attachments.size > 0) content = '[attachment, no text]';
        else if (!content && referenced.embeds.length > 0) content = '[embed, no text]';
        else if (!content) content = '[no text content]';
        if (content.length > REPLY_CONTEXT_MAX_LENGTH) {
            content = `${content.slice(0, REPLY_CONTEXT_MAX_LENGTH)}...(truncated)`;
        }

        return { author, content };
    } catch (err) {
        logger.warn('discord', 'Could not fetch replied-to message', err);
        return null;
    }
}

function registerMessageHandler(client, config) {
    client.on('messageCreate', async (message) => {
        if (!shouldRespond(message, client.user.id)) return;

        const userId = message.author.id;
        const guildId = message.guild?.id || null;

        const userText = stripMention(message.content, client.user.id);
        if (!userText) return;

        const replyContext = await buildReplyContext(message);
        const promptText = replyContext
            ? `[Replying to a message from ${replyContext.author}: "${replyContext.content}"]\n${userText}`
            : userText;

        if (isOwner(userId)) {
            const adminReply = tryHandleAdminCommand(userText, guildId);
            if (adminReply !== null) {
                await message
                    .reply({ content: adminReply, allowedMentions: { parse: [] } })
                    .catch((err) => logger.error('discord', 'Could not send admin command reply', err));
                return;
            }
        }

        if (isOnCooldown(userId, config.replyCooldownMs)) {
            logger.info('discord', `Ignoring message from ${message.author.tag} (cooldown)`);
            return;
        }
        lastReplyAtByUser.set(userId, Date.now());

        const channelId = message.channel.id;
        const history = getHistory(channelId);

        try {
            await message.channel.sendTyping().catch(() => {});
            const reply = await generateReply(history, promptText, { userId, guildId });

            appendMessage({ userId, guildId, channelId, role: 'user', content: promptText });
            appendMessage({ userId, guildId, channelId, role: 'assistant', content: reply });

            await message.reply({
                content: truncateForDiscord(reply),
                allowedMentions: { repliedUser: false },
            });
        } catch (err) {
            logger.error('discord', `Failed to answer ${message.author.tag}`, err);
            await message
                .reply('Sorry, something went wrong answering that. Please try again in a moment.')
                .catch((replyErr) => logger.error('discord', 'Could not send error reply', replyErr));
        }
    });
}

module.exports = { registerMessageHandler };
