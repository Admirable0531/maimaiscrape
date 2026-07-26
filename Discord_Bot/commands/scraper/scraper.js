const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('scraper')
        .setDescription('Manually run the user-data scraper (friend list + top scores)'),
    async execute(interaction) {
        const fetch = global.fetch || require('node-fetch');
        const expressUrl = process.env.EXPRESS_URL || 'http://api:3000';
        await interaction.deferReply();
        try {
            const resp = await fetch(`${expressUrl}/run-update-user-data`, { method: 'POST' });
            const body = await resp.json().catch(() => ({}));
            if (resp.ok && body.success) {
                await interaction.editReply('Scraper run completed successfully.');
            } else {
                await interaction.editReply('Scraper run failed or returned no success.');
            }
        } catch (err) {
            console.error('Error triggering scraper:', err);
            await interaction.editReply('Failed to trigger scraper (check API is running).');
        }
    },
};
