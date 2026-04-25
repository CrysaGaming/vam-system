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