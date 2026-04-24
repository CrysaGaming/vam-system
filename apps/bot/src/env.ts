import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export const env = {
  botToken: required('DISCORD_BOT_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: required('DISCORD_GUILD_ID'),

  channels: {
    botLogs: required('DISCORD_CHANNEL_BOT_LOGS'),
    pireps: required('DISCORD_CHANNEL_PIREPS'),
    rankPromotions: required('DISCORD_CHANNEL_RANK_PROMOTIONS'),
    awards: required('DISCORD_CHANNEL_AWARDS'),
    announcements: required('DISCORD_CHANNEL_ANNOUNCEMENTS'),
    livestreams: required('DISCORD_CHANNEL_LIVESTREAMS'),
    welcome: required('DISCORD_CHANNEL_WELCOME'),
  },

  roles: {
    admin: required('DISCORD_ROLE_ADMIN'),
    headPilot: required('DISCORD_ROLE_HEAD_PILOT'),
    instructor: required('DISCORD_ROLE_INSTRUCTOR'),
    developer: required('DISCORD_ROLE_DEVELOPER'),
    grafiker: required('DISCORD_ROLE_GRAFIKER'),
    streamer: required('DISCORD_ROLE_STREAMER'),
    captain: required('DISCORD_ROLE_CAPTAIN'),
    firstOfficer: required('DISCORD_ROLE_FIRST_OFFICER'),
    trainee: required('DISCORD_ROLE_TRAINEE'),
    eventNotifications: required('DISCORD_ROLE_EVENT_NOTIFICATIONS'),
    announcements: required('DISCORD_ROLE_ANNOUNCEMENTS'),
  },
};