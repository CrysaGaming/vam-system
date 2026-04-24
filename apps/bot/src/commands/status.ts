import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { prisma } from '@vam/db';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Zeigt aktuelle Stats der Airline');

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const airline = await prisma.airline.findFirst({
    where: { icao: 'DLH' },
    include: {
      _count: {
        select: {
          users: true,
          pireps: true,
          routes: true,
          aircraft: true,
        },
      },
    },
  });

  if (!airline) {
    await interaction.editReply('Airline nicht gefunden.');
    return;
  }

  const totalHoursAgg = await prisma.user.aggregate({
    where: { airlineId: airline.id },
    _sum: { totalFlightHours: true, totalFlights: true },
  });

  const totalHours = totalHoursAgg._sum.totalFlightHours ?? 0;
  const totalFlights = totalHoursAgg._sum.totalFlights ?? 0;

  const embed = new EmbedBuilder()
    .setColor(0x4f46e5)
    .setTitle(`${airline.name}`)
    .setDescription(`ICAO: ${airline.icao} · Callsign: ${airline.callsign}`)
    .addFields(
      { name: 'Piloten', value: `${airline._count.users}`, inline: true },
      { name: 'Flotte', value: `${airline._count.aircraft}`, inline: true },
      { name: 'Routen', value: `${airline._count.routes}`, inline: true },
      { name: 'PIREPs gesamt', value: `${airline._count.pireps}`, inline: true },
      { name: 'Flüge der Piloten', value: `${totalFlights}`, inline: true },
      { name: 'Flugstunden', value: `${totalHours.toFixed(1)} h`, inline: true },
    )
    .setFooter({ text: 'VAM System · Live Data' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}