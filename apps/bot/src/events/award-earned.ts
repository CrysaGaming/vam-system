import { type Client, TextChannel, EmbedBuilder } from 'discord.js';
import { env } from '../env.js';

/**
 * Track 1 #1 (Awards UI, 9.2.3) — Discord-handler bei award-vergabe.
 *
 * Wenn ein admin via /admin/awards einen UserAward neu vergibt (NUR
 * first-time, nicht bei wasAlreadyEarned-skips), feuert die web-app
 * über apps/web/lib/bot-events.ts → /events/award-earned dieses event.
 * Wir posten einen embed im #awards channel mit pilot-mention,
 * award-name, beschreibung und icon.
 *
 * # Embed-design
 *
 *   - Title: "🏆 Neuer Award" (wenn icon-URL da, könnten wir die als
 *     thumbnail einsetzen, dann reicht der text-titel knapp)
 *   - Description: Pilot-mention + "hat den Award **X** erhalten!" +
 *     award-description als sub-text
 *   - Thumbnail: award.iconUrl wenn vorhanden, sonst kein thumbnail
 *     (ein generic-platzhalter-icon wäre nicht besser als nichts)
 *   - Color: amber/gold (0xf59e0b) — passt zur amber-amber-themed
 *     awards-UI in der web-app
 *   - Footer: "VAM Awards"
 *
 * # Failure-handling
 *
 * Wie alle bot-events: web-app fire-and-forget'd den HTTP-call. Wenn
 * der bot down ist oder den embed nicht posten kann, wird im bot
 * geloggt aber der DB-write in der web-app ist eh schon durch. Wir
 * loggen prominently sodass der admin im bot-log sehen kann was
 * passiert ist.
 */

export type AwardEarnedPayload = {
  userId: string;
  pilotName: string;
  pilotDiscordId: string | null;
  awardId: string;
  awardName: string;
  awardDescription: string | null;
  awardIconUrl: string | null;
};

export async function handleAwardEarned(
  client: Client,
  payload: AwardEarnedPayload,
): Promise<void> {
  console.log(
    '[event] award-earned:',
    payload.pilotName,
    '←',
    payload.awardName,
  );

  const mention = payload.pilotDiscordId
    ? `<@${payload.pilotDiscordId}>`
    : `**${payload.pilotName}**`;

  const embed = new EmbedBuilder()
    .setColor(0xf59e0b) // amber-500 — matched die web-UI amber-themed awards
    .setTitle('🏆 Neuer Award')
    .setDescription(
      `${mention} hat den Award **${payload.awardName}** erhalten!${
        payload.awardDescription ? `\n\n${payload.awardDescription}` : ''
      }`,
    )
    .setFooter({ text: 'VAM · Awards' })
    .setTimestamp();

  // Thumbnail nur setzen wenn die URL https:// und discord-akzeptables
  // format ist. Discord rejected manche edge-cases (z.B. data-URLs,
  // file-URLs) — dann lieber kein thumbnail als ein crash. Try/catch
  // unten fängt das eh, aber die URL-validierung gibt früh-feedback.
  if (payload.awardIconUrl && payload.awardIconUrl.startsWith('https://')) {
    try {
      embed.setThumbnail(payload.awardIconUrl);
    } catch (err) {
      console.warn(
        '[event] award-earned: invalid icon-URL, skipping thumbnail:',
        payload.awardIconUrl,
        err,
      );
    }
  }

  try {
    const channel = await client.channels.fetch(env.channels.awards);
    if (!(channel instanceof TextChannel)) {
      console.warn('[event] award-earned: #awards not a text channel');
      return;
    }
    await channel.send({ embeds: [embed] });
    console.log(
      `[event] award-earned: posted in #awards for ${payload.pilotName} (${payload.awardName})`,
    );
  } catch (err) {
    console.error(
      '[event] award-earned: failed to post announcement:',
      err,
    );
  }
}
