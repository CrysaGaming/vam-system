import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';

const token = process.env.DISCORD_TOKEN;

if (!token) {
    console.warn('DISCORD_TOKEN not set, bot will not start');
    process.exit(0);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on('ready', () => {
    console.log(`Bot online as ${client.user?.tag}`);
});

client.login(token);