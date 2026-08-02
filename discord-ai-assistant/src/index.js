const fs = require('node:fs');
const path = require('node:path');
const { Collection, MessageFlags } = require('discord.js');
const logger = require('./utils/logger');
const { loadEnv } = require('./config/env');
const { createDiscordClient } = require('./discord/client');
const { registerMessageHandler } = require('./discord/messageHandler');
const { closeBrowser } = require('./web/playwrightFetcher');
const { pruneOlderThan } = require('./database/repositories/conversationRepository');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const config = loadEnv();
const client = createDiscordClient();

/**
 * Keeps the conversations table (chat context only, never memories) from
 * growing forever — matters more here than on typical server hardware,
 * since a Pi's storage is often a small SD card. Once at startup (covers
 * gaps from downtime) and once a day thereafter; unref'd so it never blocks
 * process exit on its own.
 */
function runRetentionSweep() {
    try {
        const deleted = pruneOlderThan(config.conversationRetentionDays);
        if (deleted > 0) {
            logger.info('bot', `Pruned ${deleted} conversation row(s) older than ${config.conversationRetentionDays} days`);
        }
    } catch (err) {
        logger.error('bot', 'Conversation retention sweep failed', err);
    }
}
runRetentionSweep();
setInterval(runRetentionSweep, ONE_DAY_MS).unref();

client.commands = new Collection();
const commandsRoot = path.join(__dirname, 'discord', 'commands');
for (const folder of fs.readdirSync(commandsRoot)) {
    const commandsPath = path.join(commandsRoot, folder);
    if (!fs.statSync(commandsPath).isDirectory()) continue;

    for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
        const command = require(path.join(commandsPath, file));
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            logger.warn('bot', `Command at ${file} is missing "data" or "execute"`);
        }
    }
}
logger.info('bot', `Loaded ${client.commands.size} slash command(s)`);

registerMessageHandler(client, config);

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
        logger.error('bot', `No command matching ${interaction.commandName} was found`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (err) {
        logger.error('bot', `Command ${interaction.commandName} failed`, err);
        const payload = { content: 'There was an error running that command.', flags: MessageFlags.Ephemeral };
        try {
            if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
            else await interaction.reply(payload);
        } catch (replyErr) {
            logger.error('bot', 'Could not report command failure', replyErr);
        }
    }
});

client.once('ready', (readyClient) => {
    logger.info('bot', `Logged in as ${readyClient.user.tag}`);
});

client.login(config.discordToken).catch((err) => {
    logger.error('bot', 'Failed to log in to Discord', err);
    // Setting exitCode and letting Node drain the event loop — rather than
    // calling process.exit() immediately — avoids a native assertion crash
    // on Windows when discord.js still has an in-flight connection handle
    // (e.g. an invalid-token failure caught mid-handshake).
    client.destroy();
    process.exitCode = 1;
});

for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
        logger.info('bot', `${signal} received, shutting down`);
        client.destroy();
        // No-op if the Playwright fallback was never triggered (no browser
        // was ever launched) — avoids leaving an orphaned Chromium process.
        await closeBrowser().catch((err) => logger.error('bot', 'Error closing Playwright browser', err));
        process.exitCode = 0;
    });
}
