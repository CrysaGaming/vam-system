import { type Client, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, } from 'discord.js';
import { env } from '../env.js';
import { prisma } from '@vam/db';

export type PirepSubmittedPayload = {
  pirepId: string;
  userId: string;
  flightNumber: string;
  departureIcao: string;
  arrivalIcao: string;
  flightTimeMin: number;
  aircraftRegistration: string | null;
  remarks: string | null;
};

export async function handlePirepSubmitted(
  client: Client,
  payload: PirepSubmittedPayload
) {
  console.log(
    '[event] pirep-submitted:',
    payload.flightNumber,
    payload.departureIcao,
    '→',
    payload.arrivalIcao
  );

  // User mit Discord-Account laden (für Avatar und Mention)
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: {
      accounts: {
        where: { provider: 'discord' },
        select: { providerAccountId: true },
      },
      rank: true,
    },
  });

  if (!user) {
    console.warn('[event] pirep-submitted: user not found', payload.userId);
    return;
  }

  const discordId = user.accounts[0]?.providerAccountId;
  const pilotMention = discordId ? `<@${discordId}>` : user.name ?? 'Unbekannter Pilot';

  // Flugzeit formatieren: 75 → "1h 15min"
  const hours = Math.floor(payload.flightTimeMin / 60);
  const mins = payload.flightTimeMin % 60;
  const flightTime = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`✈️ ${payload.flightNumber}`)
    .setDescription(`${pilotMention} hat einen Flug eingereicht`)
    .addFields(
      {
        name: 'Route',
        value: `\`${payload.departureIcao}\` → \`${payload.arrivalIcao}\``,
        inline: true,
      },
      {
        name: 'Flugzeit',
        value: flightTime,
        inline: true,
      },
      {
        name: 'Flugzeug',
        value: payload.aircraftRegistration ?? '—',
        inline: true,
      }
    );

  if (payload.remarks) {
    embed.addFields({
      name: 'Bemerkungen',
      value: payload.remarks.slice(0, 500),
      inline: false,
    });
  }

  if (user.rank) {
    embed.setFooter({ text: `${user.rank.name} · VAM System` });
  } else {
    embed.setFooter({ text: 'VAM System' });
  }

  embed.setTimestamp();

  try {
    const channel = await client.channels.fetch(env.channels.pireps);
    if (!(channel instanceof TextChannel)) {
      console.warn('[event] pirep-submitted: #pireps channel not a text channel');
      return;
    }

    const webButton = new ButtonBuilder()
      .setLabel('Im Web ansehen')
      .setStyle(ButtonStyle.Link)
      .setURL(`${env.web.baseUrl}/pireps/${payload.pirepId}`)
      .setEmoji('🔗');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(webButton);

    const message = await channel.send({ embeds: [embed], components: [row] });
    // Nette Reaktion für Community-Interaktion
    await message.react('👏').catch(() => {
      // Falls Emoji nicht geht — nicht kritisch
    });
  } catch (err) {
    console.error('[event] pirep-submitted: failed to post embed:', err);
  }
}