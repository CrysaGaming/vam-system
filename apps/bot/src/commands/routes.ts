import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { prisma } from '@vam/db';

export const data = new SlashCommandBuilder()
  .setName('routes')
  .setDescription('Zeigt die Routen der Airline')
  .addStringOption((option) =>
    option
      .setName('from')
      .setDescription('Filter nach Departure-ICAO (z. B. EDDF)')
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName('to')
      .setDescription('Filter nach Arrival-ICAO (z. B. LEMD)')
      .setRequired(false)
  )
  .addBooleanOption((option) =>
    option
      .setName('inactive')
      .setDescription('Auch inaktive Routen anzeigen')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const fromIcao = interaction.options.getString('from')?.toUpperCase();
  const toIcao = interaction.options.getString('to')?.toUpperCase();
  const showInactive = interaction.options.getBoolean('inactive') ?? false;

  const airline = await prisma.airline.findFirst({
    where: { icao: 'DLH' },
  });

  if (!airline) {
    await interaction.editReply('❌ Airline nicht gefunden.');
    return;
  }

  // Routen laden
  const routes = await prisma.route.findMany({
    where: {
      airlineId: airline.id,
      ...(showInactive ? {} : { active: true }),
      ...(fromIcao ? { departure: { icao: fromIcao } } : {}),
      ...(toIcao ? { arrival: { icao: toIcao } } : {}),
    },
    include: {
      departure: true,
      arrival: true,
      aircraft: true,
    },
    orderBy: [{ departure: { icao: 'asc' } }, { flightNumber: 'asc' }],
    take: 25, // Discord-Embed-Limit beachten
  });

  if (routes.length === 0) {
    const filters: string[] = [];
    if (fromIcao) filters.push(`from=${fromIcao}`);
    if (toIcao) filters.push(`to=${toIcao}`);
    const filterDesc = filters.length > 0 ? ` (Filter: ${filters.join(', ')})` : '';
    await interaction.editReply(
      `🛫 **${airline.name}**\n\nKeine ${
        showInactive ? '' : 'aktiven '
      }Routen gefunden${filterDesc}.`
    );
    return;
  }

  // Nach Departure gruppieren
  const byDeparture = new Map<string, typeof routes>();
  for (const route of routes) {
    const key = route.departure.icao;
    const list = byDeparture.get(key) ?? [];
    list.push(route);
    byDeparture.set(key, list);
  }

  // Sections bauen
  const sections: string[] = [];
  for (const [departureIcao, list] of byDeparture) {
    const lines = list.map((r) => {
      const aircraftTag = r.aircraft ? ` · \`${r.aircraft.type}\`` : '';
      const inactiveTag = r.active ? '' : ' *(inaktiv)*';
      const distanceTag = r.distanceNm ? ` · ${r.distanceNm}nm` : '';
      return `\`${r.flightNumber}\` → \`${r.arrival.icao}\`${distanceTag}${aircraftTag}${inactiveTag}`;
    });
    sections.push(`**${departureIcao}**\n${lines.join('\n')}`);
  }

  const activeCount = routes.filter((r) => r.active).length;
  const totalCount = routes.length;
  const countDesc = showInactive
    ? `${totalCount} insgesamt (${activeCount} aktiv)`
    : `${activeCount} aktiv`;

  // Title-Suffix mit Filtern
  const titleFilters: string[] = [];
  if (fromIcao) titleFilters.push(`ab ${fromIcao}`);
  if (toIcao) titleFilters.push(`nach ${toIcao}`);
  const titleSuffix = titleFilters.length > 0 ? ` — ${titleFilters.join(' ')}` : '';

  // Hinweis falls limitiert
  const limitNote = totalCount === 25 ? '\n\n*Anzeige auf 25 Routen begrenzt.*' : '';

  const embed = new EmbedBuilder()
    .setColor(0x3498db) // blau
    .setTitle(`🛫 ${airline.name} — Routen${titleSuffix}`)
    .setDescription(sections.join('\n\n') + limitNote)
    .setFooter({ text: `${countDesc} · VAM System` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}