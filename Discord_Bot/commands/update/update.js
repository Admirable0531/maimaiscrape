const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update')
        .setDescription('Get scores update'),
    async execute(interaction) {
        const updateScore = require('../../scripts/update_score.js');
        await updateScore.execute(interaction.channel);

    }
};
