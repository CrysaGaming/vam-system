'use server';

import { auth } from '@/auth';
import { prisma, NetworkType } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  generateReadableCode,
  PAIRING_CODE_TTL_MS,
} from '@/lib/acars/pairing';

/**
 * ACARS settings server-actions (Welle 9 commit 9B).
 *
 * Three operations from the Web side:
 *   1. requestPairingCode — generate a fresh 15-min code; force-expire
 *      any prior unconsumed code so only one is valid at a time per user.
 *   2. disconnectAcars — clear the token + pairing-state. Existing
 *      heartbeats from the old token will start failing on next request.
 *   3. setPreferredNetwork — VATSIM/IVAO/Offline picker. The ACARS-client
 *      reads this on connect to decide what `network` to announce.
 *
 * Plus a read-only `getAcarsStatus` used by the settings server-component
 * to render the current pairing/online state.
 *
 * Auth: standard NextAuth session — these are user-level operations,
 * not airline-admin operations.
 */

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error('unauthorized');
  return session.user.id;
}

// ─────────────────────────────────────────────────────────────────────────
// Read: Status for the settings page
// ─────────────────────────────────────────────────────────────────────────

export type AcarsStatus = {
  paired: boolean;
  pairedAt: Date | null;
  lastSeenAt: Date | null;
  isOnline: boolean; // lastSeenAt within ONLINE_THRESHOLD_MS
  preferredNetwork: NetworkType;
  // Active session info if currently flying (last known)
  activeSession: {
    callsign: string | null;
    aircraftType: string | null;
    aircraftRegistration: string | null;
    departureIcao: string | null;
    arrivalIcao: string | null;
    currentPhase: string | null;
    acarsClientVersion: string | null;
    acarsSimulator: string | null;
  } | null;
};

/**
 * "Online" for the badge means we've heard from the client recently —
 * 30s matches the heartbeat-cadence (1-2s nominal, but tolerant of brief
 * network hiccups). Above 30s without a heartbeat we treat as "paired
 * but offline". The ACARS-client itself sends a /api/acars/disconnect
 * on graceful shutdown, which sets lastSeen + marks the session inactive.
 */
const ONLINE_THRESHOLD_MS = 30 * 1000;

export async function getAcarsStatus(): Promise<AcarsStatus> {
  const userId = await requireUser();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      acarsToken: true,
      acarsPairedAt: true,
      acarsLastSeen: true,
      preferredNetwork: true,
    },
  });
  if (!user) throw new Error('user-not-found');

  // Most recent active ACARS session — used to surface "currently flying"
  // info on the settings card. Limited to ACARS_CLIENT dataSource so
  // VATSIM/IVAO-tracker sessions don't leak through.
  const activeSession = user.acarsToken
    ? await prisma.liveSession.findFirst({
        where: {
          userId,
          dataSource: 'ACARS_CLIENT',
          isActive: true,
        },
        select: {
          callsign: true,
          aircraftType: true,
          aircraftRegistration: true,
          departureIcao: true,
          arrivalIcao: true,
          currentPhase: true,
          acarsClientVersion: true,
          acarsSimulator: true,
        },
        orderBy: { lastUpdatedAt: 'desc' },
      })
    : null;

  const paired = !!user.acarsToken;
  const isOnline =
    !!user.acarsLastSeen &&
    Date.now() - user.acarsLastSeen.getTime() < ONLINE_THRESHOLD_MS;

  return {
    paired,
    pairedAt: user.acarsPairedAt,
    lastSeenAt: user.acarsLastSeen,
    isOnline,
    preferredNetwork: user.preferredNetwork,
    activeSession: activeSession
      ? {
          callsign: activeSession.callsign,
          aircraftType: activeSession.aircraftType,
          aircraftRegistration: activeSession.aircraftRegistration,
          departureIcao: activeSession.departureIcao,
          arrivalIcao: activeSession.arrivalIcao,
          currentPhase: activeSession.currentPhase,
          acarsClientVersion: activeSession.acarsClientVersion,
          acarsSimulator: activeSession.acarsSimulator,
        }
      : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Write: Request a fresh pairing code
// ─────────────────────────────────────────────────────────────────────────

export type PairingCodeResult = {
  code: string;
  expiresAt: Date;
};

/**
 * Generate a pairing code. Strategy: only ONE valid code at a time per
 * user — if there's already an unconsumed, unexpired code we force-
 * expire it (set expiresAt = now) before creating the new one. This
 * keeps the UI simple ("here's your code, last one is dead") and
 * means there's never ambiguity about which code is valid.
 *
 * Uniqueness collision: code is @unique. In the (negligibly rare) event
 * of a 32^9-space collision, we throw and the user retries. Could loop-
 * with-retry but YAGNI — even at 1M users with 1 code/day each, expected
 * collisions per year are microscopic.
 */
export async function requestPairingCode(): Promise<PairingCodeResult> {
  const userId = await requireUser();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);

  // Force-expire any prior unconsumed codes so only the new one is valid.
  await prisma.acarsPairingCode.updateMany({
    where: { userId, consumedAt: null, expiresAt: { gt: now } },
    data: { expiresAt: now },
  });

  const code = generateReadableCode();

  await prisma.acarsPairingCode.create({
    data: { userId, code, expiresAt },
  });

  revalidatePath('/settings');

  return { code, expiresAt };
}

// ─────────────────────────────────────────────────────────────────────────
// Write: Disconnect (rotate token to null)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Disconnect = invalidate the ACARS token. The next heartbeat from the
 * client will get 401 and the client should prompt the user to re-pair.
 * We also clear acarsLastSeen so the settings card shows "not paired"
 * cleanly — leaving the timestamp would render a stale "last seen 2
 * hours ago" message that's confusing now that the token is dead.
 *
 * Active sessions are NOT touched — they keep their telemetry rows for
 * audit/PIREP purposes. They just won't get new heartbeats. The
 * isActive=false transition happens organically when the heartbeat-
 * timeout cleanup runs (or via explicit /api/acars/disconnect from the
 * client during graceful shutdown).
 */
export async function disconnectAcars(): Promise<{ ok: true }> {
  const userId = await requireUser();

  await prisma.user.update({
    where: { id: userId },
    data: {
      acarsToken: null,
      acarsPairedAt: null,
      acarsLastSeen: null,
    },
  });

  revalidatePath('/settings');

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Write: Preferred network for ACARS announcements
// ─────────────────────────────────────────────────────────────────────────

const SetPreferredNetworkSchema = z.object({
  network: z.nativeEnum(NetworkType),
});

/**
 * Update the default network the ACARS-client should announce. Validation:
 *   - VATSIM requires user.vatsimCid (else "Offline" makes more sense)
 *   - IVAO requires user.ivaoVid
 *   - Offline always allowed
 *
 * We enforce these in the action so the UI doesn't have to guard — UI
 * just shows the picker, and a wrong pick comes back with a helpful
 * error rather than silently breaking the next ACARS connect.
 */
export async function setPreferredNetwork(
  input: z.input<typeof SetPreferredNetworkSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requireUser();

  const parsed = SetPreferredNetworkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Ungültiger network-typ' };
  }

  if (parsed.data.network !== 'Offline') {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { vatsimCid: true, ivaoVid: true },
    });
    if (parsed.data.network === 'VATSIM' && !user?.vatsimCid) {
      return {
        ok: false,
        error:
          'VATSIM-account muss zuerst verknüpft werden (siehe Verbindungen).',
      };
    }
    if (parsed.data.network === 'IVAO' && !user?.ivaoVid) {
      return {
        ok: false,
        error: 'IVAO-account muss zuerst verknüpft werden (siehe Verbindungen).',
      };
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { preferredNetwork: parsed.data.network },
  });

  revalidatePath('/settings');

  return { ok: true };
}
