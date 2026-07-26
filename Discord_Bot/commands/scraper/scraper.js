const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('scraper')
        .setDescription('Manually run the user-data scraper (friend list + top scores)'),
    async execute(interaction) {
        // Node 18+ has a global fetch; node-fetch was never an installed
        // dependency, so the old `require('node-fetch')` fallback would have
        // thrown had it ever been reached.
        const expressUrl = process.env.EXPRESS_URL || 'http://api:3000';
        const timeoutMs = parseInt(process.env.SCRAPE_TIMEOUT_MINUTES || '45', 10) * 60 * 1000;

        await interaction.deferReply();
        try {
            const resp = await fetch(`${expressUrl}/run-update-user-data`, {
                method: 'POST',
                signal: AbortSignal.timeout(timeoutMs),
            });
            const body = await resp.json().catch(() => ({}));

            if (resp.status === 409) {
                await interaction.editReply('A scrape is already running — try again once it finishes.');
            } else if (resp.ok && body.success) {
                await interaction.editReply('Scraper run completed successfully.');
            } else {
                await interaction.editReply(
                    `Scraper run failed${body.error ? `: ${body.error}` : ' or returned no success.'}`
                );
            }
        } catch (err) {
            console.error('Error triggering scraper:', err);
            const reason = err.name === 'TimeoutError' ? 'it timed out' : 'check the API is running';
            await interaction.editReply(`Failed to trigger scraper (${reason}).`);
        }
    },
};
