import { type Client, TextChannel, EmbedBuilder } from 'discord.js';
import { env } from '../env.js';

/**
 * Track 1 #7 (Events / Flight-Tours, 9.2.8) — Discord-handler bei
 * event-publication.
 *
 * Wenn ein admin via /admin/events einen DRAFT-event auf PUBLISHED
 * setzt, feuert die web-app über apps/web/lib/bot-events.ts →
 * /events/event-published dieses event. Wir posten einen embed im
 * #announcements channel mit event-titel, beschreibung-snippet,
 * datum/zeit, kind-badge, optional event-link.
 *
 * # Channel-wahl
 *
 * Event-publish ist semantisch ein "announcement" — daher #announcements
 * statt eigenem #events channel. Vermeidet einen neuen env-required-
 * variable für admins die das setup neu aufsetzen.
 *
 * Die @event-notifications-rolle wird im content-prefix gementioned
 * sodass interessierte mitglieder gepingt werden (nur die mit dem
 * role haben opt-ed-in für event-notifications).
 *
 * # Embed-design
 *
 *   - Title: "🎉 Neues Event: {title}" (icon je nach kind könnte v2 sein)
 *   - URL: /events/{slug} damit der titel klickbar ist (öffnet detail-page)
 *   - Description: event-description (truncated bei >300 chars für embed-übersicht)
 *   - Field "Beginn": startsAt formatiert (de-DE locale)
 *   - Field "Ende": endsAt formatiert oder "open-ended"
 *   - Field "Art": kind als deutsches label (TOUR=Tour, etc.)
 *   - Field "Bonus": bonusReward in VAM$ wenn > 0
 *   - Field "Plätze": maxParticipants oder "unlimited"
 *   - Thumbnail: coverImageUrl wenn https
 *   - Color: indigo/blue (0x6366f1) — passt zur events-themed UI
 *   - Footer: "VAM · Events"
 *
 * # Failure-handling
 *
 * Wie alle bot-events: web-app fire-and-forget'd den HTTP-call. Wenn
 * der bot down ist oder den embed nicht posten kann, wird im bot
 * geloggt aber der DB-publish-write in der web-app ist eh schon durch.
 */

export type EventPublishedPayload = {
  eventId: string;
  title: string;
  slug: string;
  description: string;
  kind: 'TOUR' | 'SINGLE_FLIGHT' | 'THEMED' | 'GROUP_FLIGHT' | 'SEASONAL';
  coverImageUrl: string | null;
  bonusReward: number;
  maxParticipants: number | null;
  startsAt: string; // ISO-string (von web-app serialisiert)
  endsAt: string | null;
  airlineName: string | null;
  createdByName: string | null;
};

const KIND_LABELS: Record<EventPublishedPayload['kind'], string> = {
  TOUR: 'Tour',
  SINGLE_FLIGHT: 'Single-Flight',
  THEMED: 'Themen-Event',
  GROUP_FLIGHT: 'Group-Flight',
  SEASONAL: 'Saison-Event',
};

function formatDateTimeDE(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
  });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

export async function handleEventPublished(
  client: Client,
  payload: EventPublishedPayload,
): Promise<void> {
  console.log(
    '[event] event-published:',
    payload.title,
    '(',
    payload.kind,
    ', slug=',
    payload.slug,
    ')',
  );

  // Build URL falls baseUrl konfiguriert
  const eventUrl = `${env.web.baseUrl}/events/${payload.slug}`;

  const embed = new EmbedBuilder()
    .setColor(0x6366f1) // indigo-500 — passt zu events-themed UI
    .setTitle(`🎉 Neues Event: ${payload.title}`)
    .setURL(eventUrl)
    .setDescription(truncate(payload.description, 300))
    .addFields(
      {
        name: 'Beginn',
        value: formatDateTimeDE(payload.startsAt),
        inline: true,
      },
      {
        name: 'Ende',
        value: payload.endsAt ? formatDateTimeDE(payload.endsAt) : 'offen',
        inline: true,
      },
      {
        name: 'Art',
        value: KIND_LABELS[payload.kind] ?? payload.kind,
        inline: true,
      },
    )
    .setFooter({
      text: payload.airlineName
        ? `${payload.airlineName} · Events`
        : 'VAM · Events',
    })
    .setTimestamp();

  if (payload.bonusReward > 0) {
    embed.addFields({
      name: 'Completion-Bonus',
      value: `${payload.bonusReward} VAM$`,
      inline: true,
    });
  }
  if (payload.maxParticipants !== null) {
    embed.addFields({
      name: 'Plätze',
      value: `max. ${payload.maxParticipants}`,
      inline: true,
    });
  }

  // Cover als thumbnail wenn https und sinnvoll
  if (
    payload.coverImageUrl &&
    payload.coverImageUrl.startsWith('https://')
  ) {
    try {
      embed.setThumbnail(payload.coverImageUrl);
    } catch (err) {
      console.warn(
        '[event] event-published: invalid cover-URL, skipping thumbnail:',
        payload.coverImageUrl,
        err,
      );
    }
  }

  try {
    const channel = await client.channels.fetch(env.channels.announcements);
    if (!(channel instanceof TextChannel)) {
      console.warn(
        '[event] event-published: #announcements not a text channel',
      );
      return;
    }

    // @event-notifications-rolle pingen damit interessierte mitglieder
    // benachrichtigt werden. Discord rendert role-mentions wenn die rolle
    // mentionable ist + der bot allowedMentions parsen darf.
    const content = `<@&${env.roles.eventNotifications}>`;

    await channel.send({
      content,
      embeds: [embed],
      // Erlaube role-mention explizit (default ist sonst restrictive)
      allowedMentions: { roles: [env.roles.eventNotifications] },
    });
    console.log(
      `[event] event-published: posted in #announcements for "${payload.title}"`,
    );
  } catch (err) {
    console.error(
      '[event] event-published: failed to post announcement:',
      err,
    );
  }
}
