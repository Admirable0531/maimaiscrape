const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config');
const updateFriendRatings = require('../../scripts/update_friend_ratings');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('friendsrating')
        .setDescription('Post today friends leaderboard with emojis vs yesterday (webhook)')
        .addStringOption((option) =>
            option
                .setName('accounttype')
                .setDescription('Which maimai friend account to compare (fy/main)')
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

            const result = await updateFriendRatings.execute({ webhookUrl, accountType });
            if (result && result.ok) {
                await interaction.editReply('Friend rating comparison completed and sent to the webhook.');
            } else {
                await interaction.editReply(`Friend rating comparison did not complete.${result && result.reason ? ` (${result.reason})` : ''}`);
            }
        } catch (err) {
            console.error('Error running updateFriendRatings.execute():', err);
            await interaction.editReply('Failed to run friend rating comparison. Check bot logs for details.');
        }
    },
};

