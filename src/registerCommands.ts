import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commandDefinitions } from './discord/commands.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in environment.');
  process.exit(1);
}

const rest = new REST().setToken(token);
const body = commandDefinitions.map((c) => c.toJSON());

await rest.put(Routes.applicationCommands(clientId), { body });
console.log(`Registered ${body.length} global commands for all servers.`);

if (guildId) {
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
    console.log(`Cleared old guild-only commands on ${guildId} to prevent duplicates.`);
  } catch {
    // Ignore if the bot is no longer in that guild.
  }
}
