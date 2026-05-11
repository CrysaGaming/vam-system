import { type Client, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, } from 'discord.js';
import { env } from '../env.js';

export type PirepRejectedPayload = {
  pirepId: string;
  flightNumber: string;
  pilotDiscordId: string | null;
  pilotName: string;
  approverName: string;
  approverDiscordId: string | null;
  departureIcao: string;
  arrivalIcao: string;
  reason: string;
  /**
   * Track 4 #83 (Section P): Per-airline template-overrides für title
   * und description (siehe pirep-approved.ts für details).
   */
  titleOverride?: string;
  descriptionOverride?: string;
};

export async function handlePirepRejected(
  client: Client,
  payload: PirepRejectedPayload
) {
  console.log(
    '[event] pirep-rejected:',
    payload.flightNumber,
    'by',
    payload.approverName,
    '— reason:',
    payload.reason.slice(0, 80)
  );

  const pilotMention = payload.pilotDiscordId
    ? `<@${payload.pilotDiscordId}>`
    : payload.pilotName;

  const approverMention = payload.approverDiscordId
    ? `<@${payload.approverDiscordId}>`
    : payload.approverName;

  // Track 4 #83 (Section P): Defaults mit override-präzedenz. Begründung-
  // Field bleibt SEPARAT (auch bei custom-template) damit der pilot die
  // reason garantiert sieht — der admin kann sie zwar in die description
  // einbauen via `{reason}` placeholder, aber das field-rendering ist
  // hier nicht negotiable.
  const title = payload.titleOverride ?? `❌ ${payload.flightNumber} abgelehnt`;
  const description =
    payload.descriptionOverride ??
    `${pilotMention}'s Flug wurde von **${approverMention}** abgelehnt.`;

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c) // rot
    .setTitle(title)
    .setDescription(description)
    .addFields(
      {
        name: 'Route',
        value: `\`${payload.departureIcao}\` → \`${payload.arrivalIcao}\``,
        inline: true,
      },
      {
        name: 'Begründung',
        value: payload.reason.slice(0, 500),
        inline: false,
      }
    )
    .setFooter({ text: 'VAM System' })
    .setTimestamp();

  try {
    const channel = await client.channels.fetch(env.channels.pireps);
    if (!(channel instanceof TextChannel)) {
      console.warn(
        '[event] pirep-rejected: #pireps channel not a text channel'
      );
      return;
    }
    const webButton = new ButtonBuilder()
      .setLabel('Im Web ansehen')
      .setStyle(ButtonStyle.Link)
      .setURL(`${env.web.baseUrl}/pireps/${payload.pirepId}`)
      .setEmoji('🔗');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(webButton);

    await channel.send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error('[event] pirep-rejected: failed to post embed:', err);
  }
}