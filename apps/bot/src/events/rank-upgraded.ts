import { type Client, TextChannel, EmbedBuilder } from 'discord.js';
import { env } from '../env.js';

export type RankUpgradedPayload = {
  userId: string;
  discordId: string | null;
  oldRankName: string;
  newRankName: string;
  totalFlightHours: number;
};

// Mapping von Rank-Namen zu Discord-Rollen-IDs
function getRoleIdForRank(rankName: string): string | null {
  switch (rankName.toLowerCase()) {
    case 'trainee':
      return env.roles.trainee;
    case 'first officer':
      return env.roles.firstOfficer;
    case 'captain':
      return env.roles.captain;
    default:
      return null;
  }
}

export async function handleRankUpgraded(
  client: Client,
  payload: RankUpgradedPayload
) {
  console.log(
    '[event] rank-upgraded:',
    payload.oldRankName,
    '→',
    payload.newRankName,
    `(${payload.totalFlightHours.toFixed(1)}h)`
  );

  // 1. Discord-Rolle aktualisieren (wenn Discord-ID bekannt)
  if (payload.discordId) {
    try {
      const guild = await client.guilds.fetch(env.guildId);
      const member = await guild.members.fetch(payload.discordId);

      const oldRoleId = getRoleIdForRank(payload.oldRankName);
      const newRoleId = getRoleIdForRank(payload.newRankName);

      if (oldRoleId && member.roles.cache.has(oldRoleId)) {
        await member.roles.remove(
          oldRoleId,
          `Rank upgrade: ${payload.oldRankName} → ${payload.newRankName}`
        );
        console.log(`[event] rank-upgraded: removed role ${payload.oldRankName}`);
      }

      if (newRoleId) {
        await member.roles.add(
          newRoleId,
          `Rank upgrade: ${payload.oldRankName} → ${payload.newRankName}`
        );
        console.log(`[event] rank-upgraded: added role ${payload.newRankName}`);
      } else {
        console.warn(
          `[event] rank-upgraded: no Discord role mapped for rank "${payload.newRankName}"`
        );
      }
    } catch (err) {
      console.error('[event] rank-upgraded: failed to update Discord roles:', err);
    }
  }

  // 2. Announcement im #rank-promotions posten
  const mention = payload.discordId ? `<@${payload.discordId}>` : 'Ein Pilot';
  const rankEmoji =
    payload.newRankName.toLowerCase() === 'captain'
      ? '🏆'
      : payload.newRankName.toLowerCase() === 'first officer'
        ? '🎖️'
        : '🎉';

  const rankColor =
    payload.newRankName.toLowerCase() === 'captain'
      ? 0xf1c40f // gold
      : payload.newRankName.toLowerCase() === 'first officer'
        ? 0x3498db // blau
        : 0x2ecc71; // grün

  const embed = new EmbedBuilder()
    .setColor(rankColor)
    .setTitle(`${rankEmoji} Beförderung`)
    .setDescription(
      `${mention} wurde von **${payload.oldRankName}** zu **${payload.newRankName}** befördert!`
    )
    .addFields({
      name: 'Flugstunden',
      value: `${payload.totalFlightHours.toFixed(1)} h`,
      inline: true,
    })
    .setFooter({ text: 'VAM System · Rang-Upgrade' })
    .setTimestamp();

  try {
    const channel = await client.channels.fetch(env.channels.rankPromotions);
    if (!(channel instanceof TextChannel)) {
      console.warn('[event] rank-upgraded: #rank-promotions not a text channel');
      return;
    }
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('[event] rank-upgraded: failed to post announcement:', err);
  }
}