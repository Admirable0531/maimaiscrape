const { SlashCommandBuilder } = require('discord.js');
const friendsWebhook = require('../../scripts/friends_webhook');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('updatefriendsdata')
        .setDescription('Scrape friend ratings from maimai and save today snapshot to MongoDB')
        .addStringOption((option) =>
            option
                .setName('accounttype')
                .setDescription('Which maimai friend account to scrape (fy/main)')
                .setRequired(true)
                .addChoices(
                    { name: 'FY', value: 'fy' },
                    { name: 'Main', value: 'main' }
                )
        ),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            if (!friendsWebhook || typeof friendsWebhook.run !== 'function') {
                await interaction.editReply('friends_webhook.js is not available or has no run() export.');
                return;
            }

            const accountType = interaction.options.getString('accounttype', true);
            const result = await friendsWebhook.run({ sendWebhook: false, saveToMongo: true, accountType });
            if (result && result.ok) {
                await interaction.editReply(`Scrape+save completed. Friends captured: ${result.friendsCount}`);
            } else {
                await interaction.editReply('Scrape+save failed. Check bot logs for details.');
            }
        } catch (err) {
            console.error('Error running friendsWebhook.run():', err);
            await interaction.editReply('Failed to scrape+save friend ratings. Check bot logs for details.');
        }
    },
};

