// Require the necessary discord.js classes
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const path = require('path');
const fs = require('node:fs');
const cron = require('node-cron');

// Import the dotenv library
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Access the token from the environment variable
const token = process.env.DISCORD_TOKEN;
// Create a new client instance
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		// Set a new item in the Collection with the key as the command name and the value as the exported module
		if ('data' in command && 'execute' in command) {
			client.commands.set(command.data.name, command);
		} else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

client.once(Events.ClientReady, readyClient => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;

	const command = interaction.client.commands.get(interaction.commandName);

	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}

	try {
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
		} else {
			await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
		}
	}
});

// Log in to Discord with your client's token
client.login(token);

async function test() {
	const anotherFile = require('./scripts/update_score.js');
	const channel = await client.channels.fetch("1233678655717118022");
	

// Now you can call functions or access variables from anotherFile.js
	await anotherFile.execute(channel);
}
setTimeout(() => {
    // Code to execute after the delay
    console.log("Delay complete. This code runs after 5 seconds.");
	test()
}, 3000);

cron.schedule('0 23 * * *', async () => {
    // Call your function here
	const anotherFile = require('./scripts/update_score.js');
	const channel = await client.channels.fetch("1233678655717118022");
	

// Now you can call functions or access variables from anotherFile.js
	await anotherFile.execute(channel);
});
