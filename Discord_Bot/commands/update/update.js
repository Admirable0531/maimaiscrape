const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const POST_TIMEOUT_MS = 5 * 60 * 1000;

module.exports = {
    data: new SlashCommandBuilder().setName('update').setDescription('Get scores update'),

    async execute(interaction) {
        // Node 18+ provides a global fetch; the previous node-fetch fallback
        // referenced a package that was never installed.
        const expressUrl = process.env.EXPRESS_URL || 'http://api:3000';
        await interaction.deferReply();

        try {
            const resp = await fetch(`${expressUrl}/run-update-score`, {
                method: 'POST',
                signal: AbortSignal.timeout(POST_TIMEOUT_MS),
            });
            const body = await resp.json().catch(() => ({}));

            if (resp.status === 409) {
                await interaction.editReply('An update is already running — try again once it finishes.');
                return;
            }
            if (!resp.ok || !body.success) {
                await interaction.editReply(
                    `Update triggered but returned failure${body.error ? `: ${body.error}` : '.'}`
                );
                return;
            }

            const messages = body.messages || [];
            for (const message of messages) {
                if (message.embeds?.length) {
                    await interaction.channel.send({ embeds: message.embeds.map((e) => new EmbedBuilder(e)) });
                } else if (message.content) {
                    await interaction.channel.send(message.content);
                }
            }
            await interaction.editReply(`Update completed — posted ${messages.length} message(s).`);
        } catch (err) {
            console.error('Error triggering update:', err);
            const reason = err.name === 'TimeoutError' ? 'it timed out' : 'check the API is running';
            await interaction.editReply(`Failed to trigger update (${reason}).`);
        }
    },
};
