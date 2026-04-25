import { REST, Routes } from 'discord.js';
import { env } from './env.js';
import * as status from './commands/status.js';
import * as pilot from './commands/pilot.js';
import * as leaderboard from './commands/leaderboard.js';
import * as fleet from './commands/fleet.js';
import * as routes from './commands/routes.js';

const commands = [
  status.data.toJSON(),
  pilot.data.toJSON(),
  leaderboard.data.toJSON(),
  fleet.data.toJSON(),
  routes.data.toJSON(),
];

const rest = new REST({ version: '10' }).setToken(env.botToken);

async function main() {
  try {
    console.log(`Registering ${commands.length} slash command(s) for guild ${env.guildId}...`);

    const data = (await rest.put(
      Routes.applicationGuildCommands(env.clientId, env.guildId),
      { body: commands }
    )) as { id: string; name: string }[];

    console.log(`Successfully registered ${data.length} command(s):`);
    for (const cmd of data) {
      console.log(`  /${cmd.name}  (id: ${cmd.id})`);
    }
  } catch (error) {
    console.error('Failed to register commands:', error);
    process.exit(1);
  }
}

main();