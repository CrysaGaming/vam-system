import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@vam/db';

/**
 * GET /api/mobile/state — Welle E / E3 phase 1.
 *
 * Returns a compact JSON snapshot of the calling user's currently-active
 * LiveSession, intended for the /m mobile-companion route to poll at
 * 5-second intervals. Output is deliberately small + flat — the client
 * does no joining or post-processing.
 *
 * # Auth
 *
 * Session-cookie based via NextAuth's `auth()`. No token, no header —
 * we deliberately reuse the same auth path as the rest of the web UI
 * so the mobile companion gets logged in for free once the user has
 * signed in to the main app on the same browser (or has the PWA
 * installed pointing at the same cookie-jar).
 *
 * 401 on unauth so the client can show a "bitte anmelden" empty-state
 * with a link to /, rather than a hard redirect (the polling fetch
 * shouldn't navigate the page).
 *
 * # Active session definition
 *
 * Same as the rest of the codebase: LiveSession.isActive=true, ordered
 * by lastUpdatedAt desc. If the user has multiple `isActive=true`
 * sessions (rare — pre-cleanup edge case), we return the most recent.
 *
 * # Response shape
 *
 * Two top-level keys:
 *   - `session`: full snapshot or null
 *   - `serverTime`: server-side ISO timestamp used by the client to
 *     compute "X seconds ago" age locally without a clock-skew issue
 *     against the device's own clock
 *
 * The session object intentionally flattens the ACARS telemetry
 * fields the dashboard would normally render across multiple cards.
 * The mobile companion treats the session as ONE big record because
 * it's rendered as one big card.
 *
 * Nullable telemetry fields are passed through verbatim — the client
 * decides whether to show "—" or hide the row. This keeps the server-
 * side query simple (select all, ship as-is) and gives v2 / future
 * fields a zero-server-change rollout path.
 *
 * # Caching
 *
 * `Cache-Control: no-store` so the mobile client always sees fresh
 * data. The 5s poll already throttles per-user load; CDN caching would
 * actively hurt (stale flight state shown to the pilot).
 *
 * # Bandwidth + cost
 *
 * Response is ~1-2 KB per call. At 5s poll over a 2-hour flight =
 * 1440 requests / ~2 MB. Acceptable for a phone on wifi; for cellular
 * the client could throttle to 10s — but we leave that decision to
 * the client (the endpoint doesn't enforce a poll interval).
 *
 * # Why no booking lookup
 *
 * v1 keeps the surface focused on the *active* session. If the user
 * has a booking but isn't flying yet, the page shows "Keine aktive
 * Sitzung". Showing booked-but-not-flying state is a v2 enhancement
 * — would need a second prisma query (active booking) which doubles
 * the round-trip count on every poll.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: 'unauthorized' },
      {
        status: 401,
        // Even errors get no-store so a 401 reply doesn't get cached
        // and prevent the next call from re-checking auth after sign-in.
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }

  const userId = session.user.id;

  // Single query for the active LiveSession. orderBy lastUpdatedAt desc
  // handles the (rare) case where multiple isActive=true rows exist —
  // we always want the most recent one. The compound index on
  // (userId, isActive) makes this O(1) lookup.
  const live = await prisma.liveSession.findFirst({
    where: { userId, isActive: true },
    orderBy: { lastUpdatedAt: 'desc' },
  });

  return NextResponse.json(
    {
      // Server-side ISO timestamp for client-side "X seconds ago"
      // computation. The client subtracts this from its current Date
      // and shows a relative age — works even if the device clock is
      // slightly off because the *delta* is what matters, not absolute
      // time, and the server timestamp is the same reference point as
      // session.lastUpdatedAt.
      serverTime: new Date().toISOString(),

      // session: null when no active flight, otherwise a flat snapshot.
      // Field selection mirrors what the /m page renders — keep this in
      // sync with the client. Date fields ship as ISO strings (Next.js
      // JSON serializer default for Date).
      session: live
        ? {
            // Identity + connection
            id: live.id,
            callsign: live.callsign,
            network: live.network,
            dataSource: live.dataSource,

            // Flight plan
            flightNumber: live.flightNumber,
            departureIcao: live.departureIcao,
            arrivalIcao: live.arrivalIcao,
            alternateIcao: live.alternateIcao,
            flightRules: live.flightRules,
            cruiseAltitude: live.cruiseAltitude,

            // Aircraft (the resolved ICAO type, not the raw sim title)
            aircraftType: live.aircraftType,
            aircraftRegistration: live.aircraftRegistration,

            // Phase (server-side detected for ACARS sessions, null otherwise)
            currentPhase: live.currentPhase,
            currentPhaseEnteredAt: live.currentPhaseEnteredAt,

            // Position
            latitude: live.latitude,
            longitude: live.longitude,
            altitude: live.altitude,
            altitudeAglFt: live.altitudeAglFt,
            groundSpeed: live.groundSpeed,
            indicatedAirspeed: live.indicatedAirspeed,
            heading: live.heading,
            onGround: live.onGround,

            // Performance
            verticalSpeedFpm: live.verticalSpeedFpm,
            mach: live.mach,

            // Engine + fuel (averages — client just renders)
            engineN1Avg: live.engineN1Avg,
            fuelTotalKg: live.fuelTotalKg,
            fuelFlowPph: live.fuelFlowPph,

            // Surfaces + autopilot
            flapsPercent: live.flapsPercent,
            gearDown: live.gearDown,
            spoilersDeployed: live.spoilersDeployed,
            parkingBrake: live.parkingBrake,
            autopilotMaster: live.autopilotMaster,

            // Environment
            windSpeedKts: live.windSpeedKts,
            windDirection: live.windDirection,
            oatCelsius: live.oatCelsius,

            // Timing
            connectedAt: live.connectedAt,
            lastUpdatedAt: live.lastUpdatedAt,
            lastAcarsHeartbeat: live.lastAcarsHeartbeat,
          }
        : null,
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
