const { Client, Collection, Events, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const fs = require('node:fs');
const cron = require('node-cron');
const config = require('./config');
const updateFriendRatings = require('./scripts/update_friend_ratings');
const circleRankingScraper = require('./scripts/circle_ranking_scraper');
const dailyPointsTracker = require('./scripts/daily_points_tracker');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const token = process.env.DISCORD_TOKEN;
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(
                `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
            );
        }
    }
}

client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
                content: 'There was an error while executing this command!',
                ephemeral: true,
            });
        } else {
            await interaction.reply({
                content: 'There was an error while executing this command!',
                ephemeral: true,
            });
        }
    }
});

client.login(token);

cron.schedule('0 23 * * *', async () => {
    const expressUrl = process.env.EXPRESS_URL || 'http://api:3000';
    const channel = await client.channels.fetch(config.dailyScoreChannelID);
    try {
        const resp = await fetch(`${expressUrl}/run-update-score`, { method: 'POST' });
        const body = await resp.json().catch(() => ({}));
        if (resp.ok && body.success) {
            const messages = body.messages || [];
            for (const msg of messages) {
                if (msg.embeds) {
                    const embeds = msg.embeds.map((e) => new EmbedBuilder(e));
                    await channel.send({ embeds });
                } else if (msg.content) {
                    await channel.send(msg.content);
                }
            }
        } else {
            await channel.send('Daily update triggered but returned failure.');
        }
    } catch (err) {
        console.error('Error triggering daily update:', err);
        await channel.send('Failed to trigger daily update.');
    }

    try {
        // Daily compare posts to the configured Discord channel (not webhook).
        await updateFriendRatings.execute({ channel, webhookUrl: '' });
    } catch (err) {
        console.error('Error running friend rating update:', err);
    }
});

// Circle ranking – once daily at 6:30 AM (TZ from env, e.g. Asia/Kuala_Lumpur in Docker) — after typical maimai maintenance
cron.schedule('30 6 * * *', async () => {
    console.log(`[circle] running daily circle ranking scrape at ${new Date().toISOString()}`);
    try {
        const result = await circleRankingScraper.run({
            sendWebhook: true,
            saveToMongo: true
        });

        if (result.ok) {
            if (result.sentWebhook) {
                console.log(`[circle] daily scrape completed: ${result.rankingsCount} rankings, webhook sent`);
            } else {
                console.log(
                    `[circle] daily scrape completed: ${result.rankingsCount} rankings, no webhook (${result.rankingsCount === 0 ? 'empty scrape' : 'unexpected skip'})`
                );
            }
        } else {
            console.log(`[circle] daily scrape failed:`, result);
        }
    } catch (err) {
        console.error('Error running circle ranking scraper:', err);
    }
});

// Daily points gain report - runs at 3:10 AM MYT (after maintenance and final scrape)
cron.schedule('10 3 * * *', async () => {
    const now = new Date();
    const mytHour = (now.getUTCHours() + 8) % 24;
    
    console.log(`[daily-points] running daily points gain report at ${now.toISOString()} (MYT: ${mytHour}:10)`);
    
    try {
        // Analyze the previous day's data (since we're running at 3:10 AM)
        const result = await dailyPointsTracker.run({
            sendWebhook: true,
            targetDate: null // Will automatically use previous day
        });
        
        if (result.ok) {
            console.log(`[daily-points] report completed: ${result.teamsAnalyzed} teams analyzed for ${result.date}, ${result.totalSnapshots} snapshots used`);
        } else {
            console.log(`[daily-points] report failed:`, result);
        }
    } catch (err) {
        console.error('Error running daily points tracker:', err);
    }
});
