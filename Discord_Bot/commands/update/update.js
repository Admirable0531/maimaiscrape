const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update')
        .setDescription('Get scores update'),
    async execute(interaction) {
        const fetch = global.fetch || require('node-fetch');
        const expressUrl = process.env.EXPRESS_URL || 'http://api:3000';
        await interaction.deferReply();
        try {
            const resp = await fetch(`${expressUrl}/run-update-score`, { method: 'POST' });
            const body = await resp.json().catch(() => ({}));
            if (resp.ok && body.success) {
                const messages = body.messages || [];
                for (const msg of messages) {
                    if (msg.embeds) {
                        const embeds = msg.embeds.map((e) => new EmbedBuilder(e));
                        await interaction.channel.send({ embeds });
                    } else if (msg.content) {
                        await interaction.channel.send(msg.content);
                    } else {
                        await interaction.channel.send(JSON.stringify(msg));
                    }
                }
                await interaction.editReply('Update completed.');
            } else {
                await interaction.editReply('Update triggered but returned failure.');
            }
        } catch (err) {
            console.error('Error triggering update:', err);
            await interaction.editReply('Failed to trigger update.');
        }

    }
};
