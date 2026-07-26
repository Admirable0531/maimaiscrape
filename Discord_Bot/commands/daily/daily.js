const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const dailyPipeline = require('../../scripts/daily_pipeline');

const STEP_CHOICES = [
    { name: 'Everything (scrape + post)', value: 'all' },
    { name: 'Scrape only (no Discord posts)', value: 'scrape' },
    { name: 'Post only (use existing data)', value: 'post' },
];

const STEP_SETS = {
    all: null, // null = every step
    scrape: ['scrape-top-scores', 'scrape-friend-list'],
    post: ['post-score-update', 'post-friend-leaderboard'],
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
        // The scrape can take tens of minutes, far beyond the 15-minute window an
        // interaction token stays valid, so acknowledge and report via the channel.
        await interaction.reply({
            content: 'Starting the daily update. Progress is posted in this channel; details are in the bot logs.',
            flags: MessageFlags.Ephemeral,
        });

        const steps = STEP_SETS[interaction.options.getString('steps') || 'all'];
        const result = await dailyPipeline.run({ channel: interaction.channel, steps });

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
