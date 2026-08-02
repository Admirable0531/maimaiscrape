const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { forgetMemory } = require('../../../database/repositories/memoryRepository');
const { isAllowed } = require('../../../permissions/permissionStore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forget')
        .setDescription('Delete a saved memory')
        .addStringOption((opt) => opt.setName('key').setDescription('The memory key to delete').setRequired(true)),

    async execute(interaction) {
        if (!isAllowed(interaction.user.id)) {
            await interaction.reply({ content: "You don't have permission to use this bot.", flags: MessageFlags.Ephemeral });
            return;
        }

        const key = interaction.options.getString('key', true);
        const result = forgetMemory(interaction.user.id, key);

        await interaction.reply({
            content: result.success ? `Forgot "${result.key}".` : result.error,
            flags: MessageFlags.Ephemeral,
        });
    },
};
