const { Client, Collection, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const path = require('path');
const fs = require('node:fs');
const cron = require('node-cron');
const config = require('./config');
const dailyPipeline = require('./scripts/daily_pipeline');
const circleRankingScraper = require('./scripts/circle_ranking_scraper');
const dailyPointsTracker = require('./scripts/daily_points_tracker');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('[bot] DISCORD_TOKEN is not set; cannot start. Add it to .env.');
    process.exit(1);
}
config.warnOnMissingSecrets();

// node-cron reads the local zone unless told otherwise. Pinning it here means
// the schedule no longer depends on the container's TZ being set.
const TIMEZONE = process.env.TZ || 'Asia/Kuala_Lumpur';
const DAILY_PIPELINE_ENABLED = process.env.DAILY_PIPELINE_ENABLED !== 'false';
const DAILY_PIPELINE_AT = (process.env.DAILY_PIPELINE_AT || '22:45').trim();
const CIRCLE_RUN_AT = (process.env.CIRCLE_RUN_AT || '06:30').trim();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
for (const folder of fs.readdirSync(foldersPath)) {
    const commandsPath = path.join(foldersPath, folder);
    if (!fs.statSync(commandsPath).isDirectory()) continue;

    for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}
console.log(`[bot] loaded ${client.commands.size} command(s)`);

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(`[bot] command ${interaction.commandName} failed:`, error);
        const payload = {
            content: 'There was an error while executing this command!',
            flags: MessageFlags.Ephemeral,
        };
        try {
            if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
            else await interaction.reply(payload);
        } catch (replyError) {
            console.error('[bot] could not report the command failure:', replyError.message);
        }
    }
});

/** "HH:MM" -> node-cron expression. Falls back to the default on malformed input. */
function toCronExpression(timeOfDay, fallback) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(timeOfDay);
    if (!match) {
        console.warn(`[bot] invalid time "${timeOfDay}"; using ${fallback} instead`);
        return toCronExpression(fallback, fallback);
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) {
        console.warn(`[bot] out-of-range time "${timeOfDay}"; using ${fallback} instead`);
        return toCronExpression(fallback, fallback);
    }
    return `${minute} ${hour} * * *`;
}

/**
 * Wraps a job so a slow run can't overlap the next tick, and so a rejection
 * can't surface as an unhandled promise rejection.
 */
function scheduleJob(name, timeOfDay, fallbackTime, job) {
    const expression = toCronExpression(timeOfDay, fallbackTime);
    let running = false;

    cron.schedule(
        expression,
        async () => {
            if (running) {
                console.warn(`[bot] ${name} is still running from the previous tick; skipping`);
                return;
            }
            running = true;
            console.log(`[bot] ${name} starting (${new Date().toISOString()})`);
            try {
                await job();
            } catch (err) {
                console.error(`[bot] ${name} threw:`, err);
            } finally {
                running = false;
            }
        },
        { timezone: TIMEZONE }
    );

    console.log(`[bot] scheduled ${name} at ${timeOfDay} ${TIMEZONE} (cron: ${expression})`);
}

async function getDailyChannel() {
    const channel = await client.channels.fetch(config.dailyScoreChannelID);
    if (!channel) throw new Error(`channel ${config.dailyScoreChannelID} not found`);
    if (!channel.isTextBased()) throw new Error(`channel ${config.dailyScoreChannelID} is not text based`);
    return channel;
}

/**
 * Schedules are registered on ClientReady, not at module load: the jobs need
 * client.channels, and registering them before login meant a restart near the
 * cron time could fire against an unauthenticated client.
 */
client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);

    if (DAILY_PIPELINE_ENABLED) {
        scheduleJob('daily-pipeline', DAILY_PIPELINE_AT, '22:45', async () => {
            const channel = await getDailyChannel();
            await dailyPipeline.run({ channel });
        });
    } else {
        console.log('[bot] DAILY_PIPELINE_ENABLED=false — daily scrape/post disabled; use /scraper and /update.');
    }

    // Circle rankings run once a day, after maimai's maintenance window ends.
    scheduleJob('circle-rankings', CIRCLE_RUN_AT, '06:30', async () => {
        const result = await circleRankingScraper.run({ sendWebhook: true, saveToMongo: true });
        if (!result.ok) {
            console.error('[bot] circle scrape failed:', result.error);
            return;
        }
        console.log(
            `[bot] circle scrape ok: ${result.rankingsCount} rankings, webhook ${result.sentWebhook ? 'sent' : 'skipped'}`
        );

        // Runs straight after the scrape so the report compares the two newest
        // snapshots. It used to run at 03:10 on its own schedule, which — with a
        // UTC snapshotDate and an MYT cron — reported a day-old comparison.
        const points = await dailyPointsTracker.run({ sendWebhook: true });
        if (points.ok) {
            console.log(`[bot] daily points ok: ${points.teamsAnalyzed} teams for ${points.date}`);
        } else {
            console.log(`[bot] daily points skipped: ${points.error}`);
        }
    });
});

client.login(token);

for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
        console.log(`[bot] ${signal} received, shutting down`);
        client.destroy();
        process.exit(0);
    });
}
