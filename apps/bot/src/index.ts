import {
  Client,
  GatewayIntentBits,
  Collection,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  TextChannel,
} from 'discord.js';
import { env } from './env.js';
import * as statusCmd from './commands/status.js';
import * as pilotCmd from './commands/pilot.js';
import * as leaderboardCmd from './commands/leaderboard.js';
import * as fleetCmd from './commands/fleet.js';
import * as routesCmd from './commands/routes.js';
import { startHttpServer } from './http-server.js';
import { startVatsimTracker } from './services/vatsim-tracker.js';
import { startIvaoTracker } from './services/ivao-tracker.js';

type Command = {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

const commands = new Collection<string, Command>();
commands.set(statusCmd.data.name, statusCmd as unknown as Command);
commands.set(pilotCmd.data.name, pilotCmd as unknown as Command);
commands.set(leaderboardCmd.data.name, leaderboardCmd as unknown as Command);
commands.set(fleetCmd.data.name, fleetCmd as unknown as Command);
commands.set(routesCmd.data.name, routesCmd as unknown as Command);

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', async () => {
  console.log(`Bot online as ${client.user?.tag}`);
  console.log(`Serving guild ${env.guildId}`);

  // HTTP-Server für Web→Bot Events starten
  startHttpServer(client);

  // VATSIM Live-Tracking starten (poll interval: 30s)
  startVatsimTracker();

  // IVAO Live-Tracking starten (poll interval: 30s)
  //startIvaoTracker();

  // Post "Bot online" Embed in #bot-logs
  try {
    const channel = await client.channels.fetch(env.channels.botLogs);
    if (channel?.isTextBased() && channel instanceof TextChannel) {
      await channel.send({
        embeds: [
          {
            color: 0x22c55e,
            title: '✅ Bot online',
            description: `Angemeldet als **${client.user?.tag}**`,
            timestamp: new Date().toISOString(),
          },
        ],
      });
    }
  } catch (err) {
    console.error('Failed to post online message:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) {
    console.warn(`Unknown command: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error in /${interaction.commandName}:`, err);
    const reply = { content: 'Fehler beim Ausführen des Commands.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

client.login(env.botToken);