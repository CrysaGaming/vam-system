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
  /**
   * Track 4 #83 (Section P): Per-airline template-overrides für title
   * und description. Wenn web-side gerendert wird (renderForEvent in
   * apps/web/lib/discord-templates.ts) und gesetzt, ersetzt der wert
   * den default-text. Andere embed-properties (color, fields, button)
   * bleiben unverändert.
   */
  titleOverride?: string;
  descriptionOverride?: string;
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

  // Track 4 #83 (Section P): Defaults für title + description. Wenn der
  // airline-admin templates gesetzt hat, kommt der web-rendered text
  // schon im payload als titleOverride/descriptionOverride. Wir nutzen
  // hier `??` damit override-präsenz default ersetzt; bei undefined
  // bleibt der default. Color/Fields/Button werden NICHT überschrieben.
  const title = payload.titleOverride ?? `✅ ${payload.flightNumber} genehmigt`;
  const description =
    payload.descriptionOverride ??
    `${pilotMention}'s Flug wurde von **${approverMention}** genehmigt.`;

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71) // grün
    .setTitle(title)
    .setDescription(description)
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