import 'server-only';
import { prisma, type Prisma } from '@vam/db';

/**
 * Auto-PIREP generator (Welle 9 commit 9F).
 *
 * Called from POST /api/acars/event when the ACARS-client emits a
 * BLOCK_ON event — that's the canonical "flight is finished" signal
 * (parking-brake set + engines spooling down at the destination).
 *
 * The strategy is "best-effort, side-effect-on-success":
 *   - We need departure + arrival airports to exist in our catalog. If
 *     the ICAOs from the LiveSession don't resolve, the PIREP can't be
 *     filed (Pirep.{departureId,arrivalId} are required FKs).
 *   - Route + Aircraft are optional. We try to match by flightNumber
 *     within the user's airline (Route) and by registration within the
 *     fleet (Aircraft). Misses just leave those fields null — the PIREP
 *     still files cleanly.
 *   - Booking-matching mirrors the manual flow in /pireps/new: if the
 *     pilot had an active Created/SimBriefDispatched booking on the
 *     same route, we close it out and transfer the flight-plan cache.
 *     This makes the auto-PIREP feel like a "completion" of the
 *     pre-flight planning, same UX as a manual file.
 *   - We mark the LiveSession isActive=false in the same transaction.
 *     Otherwise the next heartbeat would re-open it (well: it would
 *     update the row but isActive=true, then any subsequent BLOCK_ON
 *     would try to file again — idempotency-trap).
 *
 * Anti-cheat is OUT-OF-SCOPE for this helper. We faithfully record
 * whatever the client sends. simRate and totalPauseSeconds from the
 * LiveSession are surfaced in the remarks so admin-review can spot
 * sus values, but no auto-rejection. Future: a dedicated review-flag
 * column on Pirep + admin-queue.
 *
 * Why no "Draft" status: PirepStatus enum is Submitted/Approved/
 * Rejected today (no Draft). Adding one would cascade through the
 * approval-UI and dashboard counts. Pragmatic choice for now: file
 * as Submitted and rely on admin-approval as the review step. If
 * we later want a true draft-state (pilot reviews before submit),
 * that's an additive migration + a /pireps/[id]/edit flow. Both
 * deferred.
 */

export type GeneratePirepResult =
  | {
      ok: true;
      pirepId: string;
      flightTimeMin: number;
      flightNumber: string;
      departureIcao: string;
      arrivalIcao: string;
      aircraftRegistration: string | null;
      remarks: string | null;
      userDiscordId: string | null;

      // ─── Discord embed enrichment fields (option #17) ──────────────
      // The Discord-bot service running on localhost:3001 renders the
      // PIREP embed; we ship it the data it needs to make the embed
      // rich. These fields are populated from the same session/PIREP
      // data we already have in scope — no extra queries beyond the
      // INCIDENT lookup needed for hard-landing flagging.
      pilotName: string | null;
      aircraftType: string | null;
      aircraftTitle: string | null;
      landingRateFpm: number | null;
      fuelUsedKg: number | null;
      network: string | null;
      hasHardLanding: boolean;
      incidentSeverity: 'hard' | 'severe' | null;
    }
  | {
      ok: false;
      reason:
        | 'session-not-found'
        | 'session-not-owned-by-user'
        | 'no-airline'
        | 'missing-departure-icao'
        | 'missing-arrival-icao'
        | 'departure-airport-unknown'
        | 'arrival-airport-unknown'
        | 'session-already-closed';
      detail?: string;
    };

/**
 * BLOCK_ON-event payload shape (matches schema-comment in
 * AcarsEvent docstring). All numbers come from the ACARS-client and
 * are trusted at the recording layer — validation/anti-cheat happens
 * separately during admin-review.
 */
export type BlockOnPayload = {
  totalFlightTimeMin?: number;
  totalFuelUsedKg?: number;
  blockTimeMin?: number;
};

/**
 * Generate a PIREP for the given session if all required data is
 * present. Idempotency: if the session is already inactive (already
 * filed), returns 'session-already-closed' rather than creating a
 * duplicate. The caller (event-route) still records the AcarsEvent —
 * we just don't file twice.
 */
export async function generatePirepFromSession(
  sessionId: string,
  authenticatedUserId: string,
  payload: BlockOnPayload | null,
): Promise<GeneratePirepResult> {
  const session = await prisma.liveSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      isActive: true,
      network: true,
      callsign: true,
      flightNumber: true,
      aircraftType: true,
      aircraftRegistration: true,
      aircraftTitle: true,
      departureIcao: true,
      arrivalIcao: true,
      connectedAt: true,
      lastUpdatedAt: true,
      simRate: true,
      totalPauseSeconds: true,
      fuelTotalKg: true,
      user: {
        select: {
          id: true,
          name: true,
          discordId: true,
          airlineId: true,
        },
      },
    },
  });

  if (!session) return { ok: false, reason: 'session-not-found' };
  if (session.userId !== authenticatedUserId) {
    // Session belongs to a different user. The auth-token check upstream
    // already verified the requesting user; this guards against a client
    // sending an event for a session it doesn't own (e.g., spoofed sessionId).
    return { ok: false, reason: 'session-not-owned-by-user' };
  }
  if (!session.isActive) return { ok: false, reason: 'session-already-closed' };
  if (!session.user.airlineId) return { ok: false, reason: 'no-airline' };
  if (!session.departureIcao) return { ok: false, reason: 'missing-departure-icao' };
  if (!session.arrivalIcao) return { ok: false, reason: 'missing-arrival-icao' };

  const airlineId = session.user.airlineId;
  const userId = session.user.id;

  // Resolve airports by ICAO. The Airport catalog is system-wide, so
  // any airline's pilots can fly to any airport. If the client reported
  // an unknown ICAO, the PIREP can't be filed cleanly — return early
  // so the caller can record the event as failed-to-trigger and the
  // pilot files manually.
  const [departure, arrival] = await Promise.all([
    prisma.airport.findUnique({
      where: { icao: session.departureIcao },
      select: { id: true, icao: true },
    }),
    prisma.airport.findUnique({
      where: { icao: session.arrivalIcao },
      select: { id: true, icao: true },
    }),
  ]);

  if (!departure) {
    return {
      ok: false,
      reason: 'departure-airport-unknown',
      detail: session.departureIcao,
    };
  }
  if (!arrival) {
    return {
      ok: false,
      reason: 'arrival-airport-unknown',
      detail: session.arrivalIcao,
    };
  }

  // Optional: try to match a Route within the user's airline. We use
  // flightNumber as the match-key — it's the primary identifier and
  // lines up with how Booking/ScheduledFlight reference routes. Tie-
  // breaker: if multiple routes share the same flightNumber (rare, but
  // possible if airline-admin defined dupes), prefer one whose dep/arr
  // matches the actual flight. If still ambiguous, take the first.
  let routeId: string | null = null;
  if (session.flightNumber) {
    const matchingRoutes = await prisma.route.findMany({
      where: { airlineId, flightNumber: session.flightNumber },
      select: { id: true, departureId: true, arrivalId: true },
      take: 5,
    });
    const exactMatch = matchingRoutes.find(
      (r) => r.departureId === departure.id && r.arrivalId === arrival.id,
    );
    routeId = exactMatch?.id ?? matchingRoutes[0]?.id ?? null;
  }

  // Optional: try to match an Aircraft within the airline by registration.
  // Aircraft.registration is unique within an airline but the schema
  // doesn't enforce it (composite-unique would have been overkill at
  // welle-5 time), so findFirst with the airline-filter is correct.
  let aircraftId: string | null = null;
  if (session.aircraftRegistration) {
    const aircraft = await prisma.aircraft.findFirst({
      where: { airlineId, registration: session.aircraftRegistration },
      select: { id: true },
    });
    aircraftId = aircraft?.id ?? null;
  }

  // Find latest TOUCHDOWN event in this session for landingRateFpm.
  // We emit TOUCHDOWN as a separate event (the ACARS-client tracks
  // gear-touching-runway transitions); the BLOCK_ON event carries
  // totals but not the touchdown-specific number. Soft-fail to null
  // if not found (e.g., touch-and-go where the client never recorded
  // a TOUCHDOWN before BLOCK_ON, or first iteration of the client
  // before TOUCHDOWN was wired up).
  const touchdown = await prisma.acarsEvent.findFirst({
    where: { sessionId, type: 'TOUCHDOWN' },
    orderBy: { timestamp: 'desc' },
    select: { payload: true },
  });
  const landingRateFpm =
    touchdown && touchdown.payload && typeof touchdown.payload === 'object'
      ? extractIntegerField(touchdown.payload as Prisma.JsonObject, 'verticalSpeedFpm')
      : null;

  // Block-to-block flight time (M7 refinement). Look up the earliest
  // BLOCK_OFF and the latest BLOCK_ON for this session. The delta is
  // the canonical "block-time" (chocks-off → chocks-on) which is what
  // commercial PIREPs actually report — what every airline operations
  // department tracks.
  //
  // Why this is more accurate than wall-clock: (lastUpdatedAt -
  // connectedAt) includes pre-flight time (cockpit setup, ATC clearance
  // wait, before the engines start) and any post-BLOCK_ON tail (sitting
  // at the gate after parking-brake before disconnecting). Block-to-
  // block strips both ends and matches what the FAA / ICAO call
  // "block time" in flight logs.
  //
  // Why findFirst with asc/desc rather than findMany: at most we'd
  // expect one BLOCK_OFF (start of flight) and one BLOCK_ON (end). In
  // practice push-then-stop-then-push-again could emit multiple
  // BLOCK_OFFs (M3.9's detector fires on every PreFlight → {Pushback,
  // Taxi, Takeoff} transition). Picking the earliest BLOCK_OFF
  // captures the first commitment-to-flight; picking the latest
  // BLOCK_ON captures the final stop-at-gate. Together they bound
  // the longest plausible block period, which is what we want.
  //
  // Why NOT use this as the primary source: the client may eventually
  // post BLOCK_ON events to /api/acars/event with a richer payload
  // including a totalFlightTimeMin field that's been computed against
  // the client's own simulator-clock (which honours pause + sim-rate
  // correctly). When that happens we trust it. Server-derived block-
  // to-block is the next-best — better than wall-clock but still
  // server-side, so simRate>1.0 cheats are baked in. The remarks
  // anti-cheat prefix flags those at admin-review time.
  const blockOffEvent = await prisma.acarsEvent.findFirst({
    where: { sessionId, type: 'BLOCK_OFF' },
    orderBy: { timestamp: 'asc' },
    select: { timestamp: true },
  });
  const blockOnEvent = await prisma.acarsEvent.findFirst({
    where: { sessionId, type: 'BLOCK_ON' },
    orderBy: { timestamp: 'desc' },
    select: { timestamp: true },
  });
  const blockToBlockMin =
    blockOffEvent && blockOnEvent
      ? Math.max(
          1,
          Math.round(
            (blockOnEvent.timestamp.getTime() - blockOffEvent.timestamp.getTime()) / 60000,
          ),
        )
      : null;

  // Flight time: three-tier fallback chain.
  //   1. Client-reported totalFlightTimeMin (most accurate — honours
  //      sim-internal clock + pause-detection on the client side)
  //   2. Server-derived block-to-block delta (M7) — strips pre-flight
  //      + post-BLOCK_ON tail. Wall-clock-based, so simRate-affected.
  //   3. (lastUpdatedAt - connectedAt) — last resort, includes
  //      everything from cockpit-setup to disconnect.
  // Each tier is "better than nothing"; the chain ensures we always
  // file *some* flight time rather than null, even on degraded
  // sessions (no BLOCK events at all = first-iteration client).
  const flightTimeMin =
    payload?.totalFlightTimeMin ??
    blockToBlockMin ??
    Math.max(
      1,
      Math.round(
        (session.lastUpdatedAt.getTime() - session.connectedAt.getTime()) / 60000,
      ),
    );

  // Fuel: prefer payload, fall back to last-known fuelTotalKg snapshot
  // on the session. Without a "fuel-at-departure" baseline we can't
  // compute deltas server-side (the client computes it). null is
  // acceptable — the manual-flow allows it.
  const fuelUsedKg = payload?.totalFuelUsedKg ?? null;

  // Anti-cheat surface: if simRate>1.0 or significant pause-time was
  // observed, prefix the remarks. Admins reviewing the PIREP-queue
  // see this immediately. The pilot can edit remarks later (or admin
  // can reject for re-file). We deliberately keep it terse — if we
  // ever build a structured anti-cheat field, this becomes obsolete.
  const flagParts: string[] = [];
  if (session.simRate && session.simRate > 1.01) {
    flagParts.push(`sim-rate ${session.simRate.toFixed(1)}x`);
  }
  if (session.totalPauseSeconds && session.totalPauseSeconds > 60) {
    flagParts.push(`paused ${Math.round(session.totalPauseSeconds / 60)}min`);
  }
  const flagPrefix =
    flagParts.length > 0 ? `[ACARS-flag: ${flagParts.join(', ')}] ` : '';
  const remarks =
    `${flagPrefix}Auto-filed by ACARS-client at block-on (callsign ${session.callsign}).`;

  // Transactional commit: PIREP-create + booking-completion + cache-
  // transfer + LiveSession-close + user-totals-bump + AcarsEvent for
  // BLOCK_ON. Mirrors the manual flow but adds the LiveSession-close
  // and the AcarsEvent-with-triggeredPirepId backlink.
  const result = await prisma.$transaction(async (tx) => {
    // Race-safe re-check of isActive inside the transaction. If two
    // BLOCK_ON events arrive concurrently (client-retry on flaky net),
    // the first wins, the second sees isActive=false and aborts.
    const stillActive = await tx.liveSession.findUnique({
      where: { id: sessionId },
      select: { isActive: true },
    });
    if (!stillActive || !stillActive.isActive) {
      return { closed: true as const };
    }

    const matchingBooking = routeId
      ? await tx.booking.findFirst({
          where: {
            userId,
            airlineId,
            routeId,
            state: { in: ['Created', 'SimBriefDispatched'] },
          },
          select: {
            id: true,
            flightType: true,
            flightPlanCache: { select: { id: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
      : null;

    const pirep = await tx.pirep.create({
      data: {
        airlineId,
        userId,
        routeId,
        aircraftId,
        departureId: departure.id,
        arrivalId: arrival.id,
        state: 'Landed',
        // Use the Network the user announced for this session (may be
        // VATSIM/IVAO/Offline). Source-of-truth lives on LiveSession;
        // for the PIREP we snapshot it.
        network: session.network,
        status: 'Submitted',
        // FlightType: prefer the booking's flight-type if matched.
        // Otherwise default SCHEDULED (matches schema default; this is
        // the "I flew a route from the catalog" assumption). FREE-flight
        // pilots either don't have a booking or had a FREE booking,
        // both handled by this fallback.
        flightType: matchingBooking?.flightType ?? 'SCHEDULED',
        flightTimeMin,
        fuelUsedKg,
        landingRateFpm,
        remarks,
        bookingId: matchingBooking?.id ?? null,
      },
      select: {
        id: true,
        flightTimeMin: true,
      },
    });

    if (matchingBooking) {
      // Mirror the cache-transfer + booking-complete from the manual flow.
      if (matchingBooking.flightPlanCache) {
        await tx.flightPlanCache.update({
          where: { id: matchingBooking.flightPlanCache.id },
          data: {
            bookingId: null,
            pirepId: pirep.id,
          },
        });
      }
      await tx.booking.update({
        where: { id: matchingBooking.id },
        data: { state: 'Completed' },
      });
    }

    // Bump user totals. Same +flightTimeMin/60 + 1 increment as manual.
    // The auto-PIREP shouldn't be different in stats — a hour flown is
    // a hour flown regardless of how the form was filled.
    const flightHoursToAdd = (pirep.flightTimeMin ?? flightTimeMin) / 60;
    await tx.user.update({
      where: { id: userId },
      data: {
        totalFlightHours: { increment: flightHoursToAdd },
        totalFlights: { increment: 1 },
      },
    });

    // Close the LiveSession. From here it's read-only — no future
    // heartbeat re-opens it (the heartbeat-route's findFirst on
    // isActive=true won't match, so a new session would be created).
    // That's the right behavior: a fresh start = a fresh session.
    await tx.liveSession.update({
      where: { id: sessionId },
      data: { isActive: false, lastUpdatedAt: new Date() },
    });

    // Record the BLOCK_ON event with the back-link to the PIREP it
    // produced. Audit-trail is "this PIREP was created by this event".
    await tx.acarsEvent.create({
      data: {
        sessionId,
        type: 'BLOCK_ON',
        payload: payload as Prisma.InputJsonValue,
        triggeredPirepId: pirep.id,
      },
    });

    return {
      closed: false as const,
      pirepId: pirep.id,
      flightTimeMin: pirep.flightTimeMin ?? flightTimeMin,
    };
  });

  if (result.closed) {
    return { ok: false, reason: 'session-already-closed' };
  }

  // ─── Discord embed enrichment lookups (option #17) ─────────────────
  // Run after the PIREP is committed so we can include the freshly-
  // emitted INCIDENT row (option #7's hard-landing flag) in the
  // payload sent to the Discord-bot. Single query: bot wants only
  // a yes/no + severity, not the full event row.
  //
  // Why after the tx rather than inside: the INCIDENT event was
  // written from the heartbeat-route (M3.9), not from this helper.
  // Reading it back is a separate query against committed data —
  // clean separation, and avoids holding the tx open for the lookup.
  const incidentEvent = await prisma.acarsEvent.findFirst({
    where: { sessionId, type: 'INCIDENT' },
    orderBy: { timestamp: 'desc' },
    select: { payload: true },
  });
  let hasHardLanding = false;
  let incidentSeverity: 'hard' | 'severe' | null = null;
  if (incidentEvent?.payload && typeof incidentEvent.payload === 'object') {
    const p = incidentEvent.payload as Prisma.JsonObject;
    if (p.kind === 'HARD_LANDING') {
      hasHardLanding = true;
      // Defensive parse: severity is documented as 'hard'|'severe'|'crash'
      // but JSON columns are unstructured. Anything we don't recognise
      // falls through to null — bot can render the boolean alone.
      const sev = p.severity;
      if (sev === 'hard' || sev === 'severe') {
        incidentSeverity = sev;
      }
    }
  }

  return {
    ok: true,
    pirepId: result.pirepId,
    flightTimeMin: result.flightTimeMin,
    flightNumber:
      session.flightNumber ?? session.callsign,
    departureIcao: departure.icao,
    arrivalIcao: arrival.icao,
    aircraftRegistration: session.aircraftRegistration,
    remarks,
    userDiscordId: session.user.discordId,

    // Discord embed enrichment (option #17). All optional from the
    // bot's perspective — it can render a minimal embed if any of
    // these are null. We populate everything we have available.
    pilotName: session.user.name,
    aircraftType: session.aircraftType,
    aircraftTitle: session.aircraftTitle,
    landingRateFpm,
    fuelUsedKg,
    network: session.network,
    hasHardLanding,
    incidentSeverity,
  };
}

/**
 * Helper: pull an integer-shaped field out of a Prisma.JsonObject.
 * The TOUCHDOWN-payload's verticalSpeedFpm is documented as a number
 * in the schema-comment but Json columns are unstructured at the DB-
 * level, so we tolerate (number | string-of-number | missing).
 */
function extractIntegerField(
  obj: Prisma.JsonObject,
  field: string,
): number | null {
  const v = obj[field];
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}
