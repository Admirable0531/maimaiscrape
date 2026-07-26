const { SlashCommandBuilder } = require('discord.js');
const dailyPointsTracker = require('../../scripts/daily_points_tracker');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dailypoints')
        .setDescription('Generate daily points gain report for circle rankings')
        .addStringOption(option =>
            option.setName('date')
                .setDescription('Date to analyze (YYYY-MM-DD format, defaults to yesterday)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('webhook')
                .setDescription('Send results to webhook (default: false for manual runs)')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply();

        const dateInput = interaction.options.getString('date');
        const sendWebhook = interaction.options.getBoolean('webhook') ?? false;

        // Validate date format if provided
        let targetDate = null;
        if (dateInput) {
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(dateInput)) {
                await interaction.editReply({
                    content: '❌ Invalid date format. Please use YYYY-MM-DD format (e.g., 2026-04-01).',
                });
                return;
            }
            targetDate = dateInput;
        }

        try {
            const result = await dailyPointsTracker.run({
                sendWebhook,
                targetDate
            });

            if (result.ok) {
                const dateUsed = result.date || 'yesterday';
                await interaction.editReply({
                    content: `✅ Daily points report completed successfully!\n` +
                            `📅 Date analyzed: ${dateUsed}\n` +
                            `👥 Teams analyzed: ${result.teamsAnalyzed}\n` +
                            `📊 Snapshots used: ${result.totalSnapshots}\n` +
                            `📤 Sent to webhook: ${sendWebhook ? 'Yes' : 'No'}`,
                });
            } else {
                let errorMsg = '❌ Daily points report failed';
                if (result.error === 'insufficient data') {
                    errorMsg += ': Not enough data available. Need at least 2 snapshots for the day.';
                } else {
                    errorMsg += `: ${result.error}`;
                }
                
                await interaction.editReply({
                    content: errorMsg,
                });
            }
        } catch (error) {
            console.error('Error executing daily points tracker:', error);
            await interaction.editReply({
                content: `❌ Error running daily points tracker: ${error.message}`,
            });
        }
    },
};