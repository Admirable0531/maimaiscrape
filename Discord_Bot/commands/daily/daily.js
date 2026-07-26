const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../../config');
const dailyPipeline = require('../../scripts/daily_pipeline');

const STEP_CHOICES = [
    { name: 'Everything (scrape + post)', value: 'all' },
    { name: 'Scrape only (no Discord posts)', value: 'scrape' },
    { name: 'Post only (use existing data)', value: 'post' },
];

const STEP_SETS = {
    all: null, // null = every step
    scrape: ['scrape-top-scores', 'scrape-friend-list-fy', 'scrape-friend-list-main'],
    post: ['post-score-update', 'post-fy-leaderboard', 'post-main-leaderboard'],
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Run the daily update now (same steps as the scheduled run)')
        .addStringOption((option) =>
            option
                .setName('steps')
                .setDescription('Which part of the pipeline to run (default: everything)')
                .setRequired(false)
                .addChoices(...STEP_CHOICES)
        ),

    async execute(interaction) {
        // Mirrors the scheduled run: each report posts to its real destination
        // (score channel, FY webhook, main leaderboard channel), not wherever
        // this command was typed — so a manual /daily and the 22:45 cron are
        // never inconsistent about where things end up.
        await interaction.reply({
            content: 'Starting the daily update — results post to their usual channels. Summary follows here.',
            flags: MessageFlags.Ephemeral,
        });

        const scoreChannel = await interaction.client.channels.fetch(config.dailyScoreChannelID);
        const mainLeaderboardChannel = config.mainLeaderboardChannelID
            ? await interaction.client.channels.fetch(config.mainLeaderboardChannelID).catch(() => null)
            : null;

        const steps = STEP_SETS[interaction.options.getString('steps') || 'all'];
        const result = await dailyPipeline.run({ scoreChannel, mainLeaderboardChannel, steps });

        const summary = result.results
            .map((r) => `${r.ok ? '✅' : '❌'} \`${r.name}\` — ${r.detail} (${r.seconds}s)`)
            .join('\n');

        await interaction
            .followUp({
                content: `Daily update finished in ${result.totalSeconds}s.\n${summary}`,
                flags: MessageFlags.Ephemeral,
            })
            .catch((err) => console.error('[daily] could not send the summary follow-up:', err.message));
    },
};
