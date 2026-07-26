const { SlashCommandBuilder } = require('discord.js');
const circleRankingScraper = require('../../scripts/circle_ranking_scraper');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('circle')
        .setDescription('Manually trigger circle ranking scraper')
        .addStringOption(option =>
            option.setName('webhook')
                .setDescription('Webhook behavior: auto (only if changes), force (always send), none (never send)')
                .setRequired(false)
                .addChoices(
                    { name: 'Auto (only if changes)', value: 'auto' },
                    { name: 'Force (always send)', value: 'force' },
                    { name: 'None (never send)', value: 'none' }
                ))
        .addBooleanOption(option =>
            option.setName('save')
                .setDescription('Save to MongoDB (default: true)')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply();

        const webhookOption = interaction.options.getString('webhook') ?? 'none';
        const saveToMongo = interaction.options.getBoolean('save') ?? true;

        let sendWebhook;
        if (webhookOption === 'force') {
            sendWebhook = true;
        } else if (webhookOption === 'auto') {
            sendWebhook = 'auto';
        } else {
            sendWebhook = false;
        }

        try {
            const result = await circleRankingScraper.run({
                sendWebhook,
                saveToMongo
            });

            if (result.maintenance) {
                await interaction.editReply({
                    content: '⚠️ maimai is currently in maintenance (3:00 AM - 6:00 AM MYT). Circle ranking scraper skipped.',
                });
                return;
            }

            if (result.ok) {
                let webhookStatus;
                if (webhookOption === 'none') {
                    webhookStatus = 'Disabled';
                } else if (webhookOption === 'force') {
                    webhookStatus = 'Sent (forced)';
                } else if (webhookOption === 'auto') {
                    webhookStatus = result.sentWebhook ? 'Sent (changes detected)' : 'Skipped (no changes)';
                }

                await interaction.editReply({
                    content: `✅ Circle ranking scraper completed successfully!\n` +
                            `📊 Found ${result.rankingsCount} circle rankings\n` +
                            `🔄 Changes detected: ${result.hasChanges ? 'Yes' : 'No'}\n` +
                            `💾 Saved to MongoDB: ${saveToMongo ? 'Yes' : 'No'}\n` +
                            `📤 Webhook: ${webhookStatus}`,
                });
            } else {
                await interaction.editReply({
                    content: `❌ Circle ranking scraper failed: ${result.error || 'Unknown error'}`,
                });
            }
        } catch (error) {
            console.error('Error executing circle ranking scraper:', error);
            await interaction.editReply({
                content: `❌ Error running circle ranking scraper: ${error.message}`,
            });
        }
    },
};