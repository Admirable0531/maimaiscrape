const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { saveMemory } = require('../../../database/repositories/memoryRepository');
const { isAllowed } = require('../../../permissions/permissionStore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remember')
        .setDescription('Save something for me to remember about you')
        .addStringOption((opt) => opt.setName('key').setDescription('Short label, e.g. a nickname').setRequired(true))
        .addStringOption((opt) =>
            opt.setName('value').setDescription('What it means / the fact to remember').setRequired(true)
        )
        .addStringOption((opt) => opt.setName('category').setDescription('Optional category label').setRequired(false)),

    // Direct backend logic — no Gemini call, per the spec's rule that
    // explicit commands shouldn't need an AI round trip.
    async execute(interaction) {
        if (!isAllowed(interaction.user.id)) {
            await interaction.reply({ content: "You don't have permission to use this bot.", flags: MessageFlags.Ephemeral });
            return;
        }

        const key = interaction.options.getString('key', true);
        const value = interaction.options.getString('value', true);
        const category = interaction.options.getString('category') || null;

        const result = saveMemory({ userId: interaction.user.id, guildId: interaction.guildId, key, value, category });

        if (!result.success) {
            await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
            return;
        }

        const verb = result.updated ? 'Updated' : 'Saved';
        await interaction.reply({
            content: `${verb}. I'll remember that "${result.key}" refers to: ${value}`,
            flags: MessageFlags.Ephemeral,
        });
    },
};
