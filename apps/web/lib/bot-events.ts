import 'server-only';

const BOT_BASE_URL = `http://localhost:${process.env.BOT_HTTP_PORT ?? '3001'}`;
const BOT_SECRET = process.env.BOT_EVENTS_SECRET;

export type PirepSubmittedPayload = {
  pirepId: string;
  userId: string;
  flightNumber: string;
  departureIcao: string;
  arrivalIcao: string;
  flightTimeMin: number;
  aircraftRegistration: string | null;
  remarks: string | null;
};

export type RankUpgradedPayload = {
  userId: string;
  discordId: string | null;
  oldRankName: string;
  newRankName: string;
  totalFlightHours: number;
};

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
};

/**
 * Track 1 #1 (Awards UI, 9.2.3): Payload für /events/award-earned.
 * Triggered wenn admin via /admin/awards einen UserAward neu vergibt
 * (NUR bei first-time grant, nicht bei wasAlreadyEarned-skip — sonst
 * würden duplicate-vergaben zwei discord-posts verursachen).
 *
 * Discord-handler postet einen embed in #awards channel mit pilot-
 * mention, award-name, beschreibung und icon (falls gesetzt).
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

/**
 * Track 1 #7 (Events / Flight-Tours, 9.2.8): Payload für
 * /events/event-published. Triggered wenn admin via /admin/events einen
 * DRAFT-event auf PUBLISHED setzt.
 *
 * Discord-handler postet einen embed in #announcements channel mit
 * event-titel, beschreibung-snippet, datum + bonus, plus pingt die
 * @event-notifications-rolle.
 *
 * Datums-felder als ISO-strings serialisiert weil JSON-transport
 * Date-objects nicht sauber rüberbringt — der bot deserialisiert
 * via new Date(iso).
 */
export type EventPublishedPayload = {
  eventId: string;
  title: string;
  slug: string;
  description: string;
  kind: "TOUR" | "SINGLE_FLIGHT" | "THEMED" | "GROUP_FLIGHT" | "SEASONAL";
  coverImageUrl: string | null;
  bonusReward: number;
  maxParticipants: number | null;
  startsAt: string; // ISO
  endsAt: string | null;
  airlineName: string | null;
  createdByName: string | null;
};

async function post(path: string, body: unknown): Promise<void> {
  if (!BOT_SECRET) {
    console.warn('[bot-events] BOT_EVENTS_SECRET not set, skipping event:', path);
    return;
  }

  try {
    const res = await fetch(`${BOT_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BOT_SECRET}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      // Kurzer Timeout — wenn Bot down ist, nicht ewig warten
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[bot-events] Bot returned ${res.status} for ${path}:`, text);
      return;
    }
  } catch (err) {
    // Bot down? Egal — Web-App soll nicht crashen
    console.warn(`[bot-events] Failed to dispatch ${path}:`, err);
  }
}

export async function emitPirepSubmitted(payload: PirepSubmittedPayload): Promise<void> {
  await post('/events/pirep-submitted', payload);
}

export async function emitRankUpgraded(payload: RankUpgradedPayload): Promise<void> {
  await post('/events/rank-upgraded', payload);
}

export async function emitPirepApproved(payload: PirepApprovedPayload): Promise<void> {
  await post('/events/pirep-approved', payload);
}

export async function emitPirepRejected(payload: PirepRejectedPayload): Promise<void> {
  await post('/events/pirep-rejected', payload);
}

export async function emitAwardEarned(payload: AwardEarnedPayload): Promise<void> {
  await post('/events/award-earned', payload);
}

export async function emitEventPublished(payload: EventPublishedPayload): Promise<void> {
  await post('/events/event-published', payload);
}