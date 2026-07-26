const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config');
const { executeLatest } = require('../../scripts/update_latest_friend_leaderboard');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('latestfriendsleaderboard')
        .setDescription('Post the latest friend rating leaderboard (no arrows/comparison)')
        .addStringOption((option) =>
            option
                .setName('accounttype')
                .setDescription('Which maimai friend account snapshot to use (fy/main)')
                .setRequired(true)
                .addChoices(
                    { name: 'FY', value: 'fy' },
                    { name: 'Main', value: 'main' }
                )
        )
        .addStringOption((option) =>
            option
                .setName('webhookmode')
                .setDescription('Which Discord webhook to send to (fy/test)')
                .setRequired(true)
                .addChoices(
                    { name: 'FY webhook', value: 'fy' },
                    { name: 'TEST webhook', value: 'test' }
                )
        ),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const accountType = interaction.options.getString('accounttype', true);
            const webhookMode = interaction.options.getString('webhookmode', true);

            const webhookUrl =
                webhookMode === 'test' ? config.FRIEND_WEBHOOK_URL_TEST : config.FRIEND_WEBHOOK_URL_FY;

            const result = await executeLatest({ webhookUrl, accountType });
            if (result && result.ok) {
                await interaction.editReply(`Latest friend leaderboard posted. Friends: ${result.friendsCount}`);
            } else {
                await interaction.editReply(
                    `Latest friend leaderboard did not complete.${result && result.reason ? ` (${result.reason})` : ''}`
                );
            }
        } catch (err) {
            console.error('Error running executeLatest():', err);
            await interaction.editReply('Failed to post latest friend leaderboard. Check bot logs.');
        }
    },
};

