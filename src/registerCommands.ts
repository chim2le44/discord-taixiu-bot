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

if (guildId) {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  console.log(`Registered ${body.length} guild commands to ${guildId}.`);
} else {
  await rest.put(Routes.applicationCommands(clientId), { body });
  console.log(`Registered ${body.length} global commands.`);
}
