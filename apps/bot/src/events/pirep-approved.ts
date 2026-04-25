import { type Client, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, } from 'discord.js';
import { env } from '../env.js';

export type PirepApprovedPayload = {
  pirepId: string;
  flightNumber: string;
  pilotDiscordId: string | null;
  pilotName: string;
  approverName: string;
  approverDiscordId: string | null;
  departureIcao: string;
  arrivalIcao: string;
};

export async function handlePirepApproved(
  client: Client,
  payload: PirepApprovedPayload
) {
  console.log(
    '[event] pirep-approved:',
    payload.flightNumber,
    'by',
    payload.approverName
  );

  const pilotMention = payload.pilotDiscordId
    ? `<@${payload.pilotDiscordId}>`
    : payload.pilotName;

  const approverMention = payload.approverDiscordId
    ? `<@${payload.approverDiscordId}>`
    : payload.approverName;

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71) // grün
    .setTitle(`✅ ${payload.flightNumber} genehmigt`)
    .setDescription(
      `${pilotMention}'s Flug wurde von **${approverMention}** genehmigt.`
    )
    .addFields({
      name: 'Route',
      value: `\`${payload.departureIcao}\` → \`${payload.arrivalIcao}\``,
      inline: true,
    })
    .setFooter({ text: 'VAM System' })
    .setTimestamp();

  try {
    const channel = await client.channels.fetch(env.channels.pireps);
    if (!(channel instanceof TextChannel)) {
      console.warn(
        '[event] pirep-approved: #pireps channel not a text channel'
      );
      return;
    }
    const webButton = new ButtonBuilder()
      .setLabel('Im Web ansehen')
      .setStyle(ButtonStyle.Link)
      .setURL(`${env.web.baseUrl}/pireps/${payload.pirepId}`)
      .setEmoji('🔗');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(webButton);

    const message = await channel.send({ embeds: [embed], components: [row] });
    await message.react('🎉').catch(() => {});
  } catch (err) {
    console.error('[event] pirep-approved: failed to post embed:', err);
  }
}