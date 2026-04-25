import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { prisma } from '@vam/db';
import { env } from '../env.js';

export const data = new SlashCommandBuilder()
  .setName('pilot')
  .setDescription('Zeigt das Piloten-Profil eines Users')
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('Welcher Pilot? (leer = du selbst)')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('user') ?? interaction.user;
  const discordId = targetUser.id;

  // Finde User via Account.providerAccountId (NextAuth speichert Discord-ID dort)
  const account = await prisma.account.findFirst({
    where: {
      provider: 'discord',
      providerAccountId: discordId,
    },
    include: {
      user: {
        include: {
          airline: true,
          rank: true,
          role: true,
        },
      },
    },
  });

  if (!account || !account.user) {
    await interaction.editReply(
      `❌ ${targetUser.username} hat sich noch nicht im VAM-System registriert.`
    );
    return;
  }

  const user = account.user;

  // Nächsten Rang finden
  const nextRank = user.airlineId
    ? await prisma.rank.findFirst({
        where: {
          airlineId: user.airlineId,
          minFlightHours: { gt: user.totalFlightHours },
        },
        orderBy: { order: 'asc' },
      })
    : null;

  // Letzte 3 PIREPs
  const recentPireps = await prisma.pirep.findMany({
    where: { userId: user.id },
    include: {
      route: true,
      departure: true,
      arrival: true,
    },
    orderBy: { submittedAt: 'desc' },
    take: 3,
  });

  const rangColor = user.rank?.name === 'Captain'
    ? 0xf1c40f  // gold
    : user.rank?.name === 'First Officer'
    ? 0x3498db  // blau
    : 0x2ecc71; // grün (trainee)

  const embed = new EmbedBuilder()
    .setColor(rangColor)
    .setAuthor({
      name: user.name ?? targetUser.username,
      iconURL: targetUser.displayAvatarURL({ size: 256 }),
    })
    .setTitle(`${user.rank?.name ?? 'Kein Rang'} bei ${user.airline?.name ?? 'keiner Airline'}`)
    .addFields(
      {
        name: 'Rolle',
        value: user.role?.name ?? 'Keine',
        inline: true,
      },
      {
        name: 'Flugstunden',
        value: `${user.totalFlightHours.toFixed(1)} h`,
        inline: true,
      },
      {
        name: 'Flüge',
        value: `${user.totalFlights}`,
        inline: true,
      }
    );

  // Nächster Rang
  if (nextRank) {
    const hoursNeeded = nextRank.minFlightHours - user.totalFlightHours;
    embed.addFields({
      name: 'Nächster Rang',
      value: `**${nextRank.name}** — noch ${hoursNeeded.toFixed(1)} h`,
      inline: false,
    });
  } else if (user.rank) {
    embed.addFields({
      name: 'Status',
      value: '🏆 Höchster Rang erreicht',
      inline: false,
    });
  }

  // Letzte PIREPs
  if (recentPireps.length > 0) {
    const pirepList = recentPireps
      .map((p) => {
        const flightNo = p.route?.flightNumber ?? '—';
        const route = `${p.departure.icao}→${p.arrival.icao}`;
        const hours = Math.floor((p.flightTimeMin ?? 0) / 60);
        const mins = (p.flightTimeMin ?? 0) % 60;
        const time = `${hours}h ${mins}min`;
        return `\`${flightNo}\` ${route} · ${time}`;
      })
      .join('\n');

    embed.addFields({
      name: `Letzte ${recentPireps.length} Flüge`,
      value: pirepList,
      inline: false,
    });
  }

  embed
    .setFooter({ text: 'VAM System · Piloten-Profil' })
    .setTimestamp();

  const webButton = new ButtonBuilder()
    .setLabel('Profil im Web')
    .setStyle(ButtonStyle.Link)
    .setURL(`${env.web.baseUrl}/pilots/${user.id}`)
    .setEmoji('🔗');

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(webButton);

  await interaction.editReply({ embeds: [embed], components: [row] });
}