const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update')
        .setDescription('Get scores update'),
    async execute(interaction) {
        async function test() {
            const anotherFile = require('./scripts/update_score.js');
            const channel = await client.channels.fetch("1233678655717118022");
            

            await anotherFile.execute(channel);
        }

        test();
    }
}