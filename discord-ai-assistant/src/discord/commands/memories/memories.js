const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { listMemories } = require('../../../database/repositories/memoryRepository');
const { isAllowed } = require('../../../permissions/permissionStore');

module.exports = {
    data: new SlashCommandBuilder().setName('memories').setDescription('List everything I remember about you'),

    async execute(interaction) {
        if (!isAllowed(interaction.user.id)) {
            await interaction.reply({ content: "You don't have permission to use this bot.", flags: MessageFlags.Ephemeral });
            return;
        }

        const memories = listMemories(interaction.user.id, 25);
        if (memories.length === 0) {
            await interaction.reply({
                content: "I don't have any memories saved for you yet.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const lines = memories.map((m) => `• **${m.key}** — ${m.value}${m.category ? ` _(${m.category})_` : ''}`);
        await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
    },
};
