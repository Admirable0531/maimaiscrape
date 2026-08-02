const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

// Without these the REST call fails with an opaque 401/404, so check up front.
const missing = Object.entries({ DISCORD_TOKEN: token, CLIENT_ID: clientId })
    .filter(([, value]) => !value)
    .map(([name]) => name);

if (missing.length > 0) {
    console.error(`Cannot deploy commands: missing ${missing.join(', ')} in .env`);
    process.exit(1);
}

const commands = [];
const commandsRoot = path.join(__dirname, 'src', 'discord', 'commands');

for (const folder of fs.readdirSync(commandsRoot)) {
    const commandsPath = path.join(commandsRoot, folder);
    if (!fs.statSync(commandsPath).isDirectory()) continue;

    for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

(async () => {
    const rest = new REST().setToken(token);
    try {
        // Global (not per-guild) so Atri's commands work in every server it's
        // invited to without redeploying per server — this PUT atomically
        // replaces the ENTIRE global command set, which is also how this
        // cleared out 45 unrelated stale commands from a prior bot identity
        // on this same application. Takes up to ~1hr to propagate to Discord
        // clients after each change (guild-scoped commands update instantly,
        // global ones don't — expected latency, not a bug if a new command
        // doesn't show up immediately).
        console.log(`Started refreshing ${commands.length} global application (/) command(s).`);
        const data = await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log(`Successfully reloaded ${data.length} global application (/) command(s).`);
        for (const command of data) {
            console.log(`  /${command.name}`);
        }
    } catch (error) {
        console.error('Failed to deploy commands:', error);
        process.exit(1);
    }
})();
