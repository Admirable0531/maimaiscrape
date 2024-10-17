const { SlashCommandBuilder } = require('discord.js');
const { MongoClient } = require('mongodb');
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('friendscore')
		.setDescription('Get friend scores on song'),
	async execute(interaction) {
        const channel = interaction.channel;
        channel.messages.fetch({ limit: 1 })
        .then(messages => {
          const lastMessage = messages.first();
  
          if (lastMessage.embeds.length > 0) {
            const embed = lastMessage.embeds[0];
            console.log(embed); // Access embed properties as needed
          } else {
            console.log('No embed found in the last message.');
          }
        })
        .catch(console.error);
    }
}