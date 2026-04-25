import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { prisma } from '@vam/db';

export const data = new SlashCommandBuilder()
  .setName('fleet')
  .setDescription('Zeigt die Flotte der Airline')
  .addStringOption((option) =>
    option
      .setName('type')
      .setDescription('Filter nach Aircraft-Type (z. B. A320)')
      .setRequired(false)
  )
  .addBooleanOption((option) =>
    option
      .setName('inactive')
      .setDescription('Auch inaktive Aircraft anzeigen')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const typeFilter = interaction.options.getString('type');
  const showInactive = interaction.options.getBoolean('inactive') ?? false;

  const airline = await prisma.airline.findFirst({
    where: { icao: 'DLH' },
  });

  if (!airline) {
    await interaction.editReply('❌ Airline nicht gefunden.');
    return;
  }

  // Aircraft laden
  const aircraft = await prisma.aircraft.findMany({
    where: {
      airlineId: airline.id,
      ...(showInactive ? {} : { active: true }),
      ...(typeFilter
        ? { type: { contains: typeFilter, mode: 'insensitive' } }
        : {}),
    },
    orderBy: [{ type: 'asc' }, { registration: 'asc' }],
  });

  if (aircraft.length === 0) {
    const filterDesc = typeFilter
      ? ` (Filter: type=${typeFilter})`
      : '';
    await interaction.editReply(
      `🛩️ **${airline.name}**\n\nKeine ${
        showInactive ? '' : 'aktiven '
      }Flugzeuge gefunden${filterDesc}.`
    );
    return;
  }

  // Nach Type gruppieren
  const byType = new Map<string, typeof aircraft>();
  for (const ac of aircraft) {
    const list = byType.get(ac.type) ?? [];
    list.push(ac);
    byType.set(ac.type, list);
  }

  // Embed-Description bauen
  const sections: string[] = [];
  for (const [type, list] of byType) {
    const lines = list.map((ac) => {
      const homeBase = ac.homeIcao ? `\`${ac.homeIcao}\`` : '—';
      const inactiveTag = ac.active ? '' : ' *(inaktiv)*';
      return `\`${ac.registration}\` · ${homeBase}${inactiveTag}`;
    });
    sections.push(`**${type}**\n${lines.join('\n')}`);
  }

  const activeCount = aircraft.filter((a) => a.active).length;
  const totalCount = aircraft.length;
  const countDesc = showInactive
    ? `${totalCount} insgesamt (${activeCount} aktiv)`
    : `${activeCount} aktiv`;

  const titleSuffix = typeFilter ? ` — ${typeFilter}` : '';

  const embed = new EmbedBuilder()
    .setColor(0x3498db) // blau, wie pirep-submitted
    .setTitle(`✈️ ${airline.name} — Flotte${titleSuffix}`)
    .setDescription(sections.join('\n\n'))
    .setFooter({ text: `${countDesc} · VAM System` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}