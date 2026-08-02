const { Client, GatewayIntentBits, Partials } = require('discord.js');

/**
 * MessageContent is a privileged intent — it must also be turned on for this
 * bot application in the Discord Developer Portal (Bot -> Privileged Gateway
 * Intents), or every message.content the bot receives will be empty.
 */
function createDiscordClient() {
    return new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel],
    });
}

module.exports = { createDiscordClient };
