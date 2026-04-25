import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { prisma } from '@vam/db';

type SortBy = 'hours' | 'flights';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Top-Piloten der Airline')
  .addStringOption((option) =>
    option
      .setName('sort')
      .setDescription('Sortierung (Standard: nach Flugstunden)')
      .setRequired(false)
      .addChoices(
        { name: 'Flugstunden', value: 'hours' },
        { name: 'Anzahl Flüge', value: 'flights' }
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const sortBy = (interaction.options.getString('sort') ?? 'hours') as SortBy;

  const airline = await prisma.airline.findFirst({
    where: { icao: 'DLH' },
  });

  if (!airline) {
    await interaction.editReply('❌ Airline nicht gefunden.');
    return;
  }

  // Top 10 Piloten ziehen
  const orderBy =
    sortBy === 'flights'
      ? { totalFlights: 'desc' as const }
      : { totalFlightHours: 'desc' as const };

  const pilots = await prisma.user.findMany({
    where: {
      airlineId: airline.id,
      // Nur User mit mindestens 1 Flug zeigen
      totalFlights: { gt: 0 },
    },
    include: {
      rank: true,
      accounts: {
        where: { provider: 'discord' },
        select: { providerAccountId: true },
      },
    },
    orderBy,
    take: 10,
  });

  if (pilots.length === 0) {
    await interaction.editReply(
      `📊 **${airline.name}** Leaderboard\n\nNoch keine Flüge eingereicht.`
    );
    return;
  }

  // Format jede Zeile mit Rang-Emoji oder Nummer
  const lines = pilots.map((pilot, idx) => {
    const position = idx + 1;
    const medal =
      position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : `**${position}.**`;

    const discordId = pilot.accounts[0]?.providerAccountId;
    const name = discordId ? `<@${discordId}>` : pilot.name ?? 'Unknown';
    const rankBadge = pilot.rank?.name ?? '—';

    const value =
      sortBy === 'flights'
        ? `${pilot.totalFlights} Flüge`
        : `${pilot.totalFlightHours.toFixed(1)} h`;

    return `${medal} ${name} · *${rankBadge}* · **${value}**`;
  });

  const sortLabel = sortBy === 'flights' ? 'Anzahl Flüge' : 'Flugstunden';

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f) // gold
    .setTitle(`🏆 ${airline.name} — Top ${pilots.length}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Sortiert nach: ${sortLabel} · VAM System` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}