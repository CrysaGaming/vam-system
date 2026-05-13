/**
 * Welle B — B3. PIREP replay-export endpoint.
 *
 * GET /api/pireps/[id]/replay-export → JSON file (Content-Disposition
 * attachment) with the full set of replay artifacts bundled for offline
 * analysis, sharing, or future visualizer-import.
 *
 * # Format
 *
 * `vam-replay/v1` is a versioned JSON envelope. v1 ships with:
 *   - metadata    : pirep id, flight number, callsign, dep/arr ICAOs,
 *                   aircraft, pilot name, submitted-at, flight-time
 *   - session     : LiveSession info (network, callsign, aircraft,
 *                   connectedAt, lastUpdatedAt) + environment snapshot
 *                   (wind/OAT/QNH from B1) + radio snapshot (COM1/NAV1
 *                   from B2). Reflects the LAST-known state of the
 *                   session at flight-end.
 *   - positions[] : LiveSessionPosition trail, asc by recordedAt
 *   - events[]    : AcarsEvent rows (PHASE_CHANGE, BLOCK_OFF/ON,
 *                   TOUCHDOWN, INCIDENT, CONNECTION_LOST), asc by ts
 *   - atcSessions : AtcSession rows from B2 (ATC matcher output)
 *
 * The version-prefix lets future readers handle older exports without
 * format-sniffing — `format === "vam-replay/v1"` is the contract.
 *
 * # Filename
 *
 * `${flightNumber || "PIREP"}-${YYYY-MM-DD}.vam-replay` — date is the
 * submittedAt date in UTC. Custom extension makes the file recognizable
 * to a future visualizer; the actual content is JSON, so any text
 * editor opens it for inspection.
 *
 * # Why not MessagePack
 *
 * The roadmap mentions MessagePack as an option. For v1 we go JSON
 * because (a) it's human-readable for debugging, (b) it has zero
 * extra dependencies on the export-side, (c) a 1-hour ACARS flight
 * with ~3600 positions encodes to ~1.5MB JSON — already small enough
 * that a binary format isn't required. MessagePack can ship as
 * `vam-replay/v2` if size becomes the bottleneck.
 *
 * # Auth + visibility
 *
 * Same pattern as the existing /replay route: member-only, eigene
 * PIREPs always visible, fremde nur für admin/instructor der gleichen
 * airline.
 *
 * # Cache policy
 *
 * `no-store` — the export reflects the current state of the PIREP, so
 * if anything is edited (rare, but possible for the legacy migration
 * pipeline) the next download gets fresh data.
 */

import { auth } from "@/auth";
import { findReplayDataForPirep, prisma } from "@vam/db";
import { isApproverRole } from "@/lib/roles";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: pirepId } = await params;

  // Ownership/visibility check — same shape as /replay route.
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, airlineId: true, role: { select: { name: true } } },
  });
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Pull PIREP metadata for the export envelope + auth check. include
  // is richer than the /replay route's because we need the actual data
  // for the file, not just the ownership fields.
  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    include: {
      departure: { select: { icao: true, name: true } },
      arrival: { select: { icao: true, name: true } },
      aircraft: {
        select: { type: true, registration: true },
      },
      route: { select: { flightNumber: true } },
      user: { select: { id: true, name: true } },
    },
  });
  if (!pirep) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwn = pirep.userId === currentUser.id;
  const isApprover = isApproverRole(currentUser.role?.name);
  const sameAirline = pirep.airlineId === currentUser.airlineId;
  if (!isOwn && !(isApprover && sameAirline)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Reuse the existing replay-data helper for positions + session-info
  // discovery (ACARS-trigger + heuristic-match fallback). It returns
  // an "available: false" shape for manual PIREPs or sessions with no
  // positions — we still produce an export envelope but with empty
  // positions/events/atcSessions arrays so the consumer can detect
  // "metadata-only" exports cleanly.
  const replay = await findReplayDataForPirep(pirepId);

  // Parallel supplemental fetches when we actually have a session.
  // For "no session" cases (manual PIREP) all three resolve to empty
  // arrays / null — keeps the envelope shape stable so consumers don't
  // need to special-case absent fields.
  const [events, atcSessions, sessionExtras] = replay.available
    ? await Promise.all([
        prisma.acarsEvent.findMany({
          where: { sessionId: replay.sessionId },
          select: {
            id: true,
            type: true,
            timestamp: true,
            payload: true,
          },
          orderBy: { timestamp: "asc" },
        }),
        prisma.atcSession.findMany({
          where: { sessionId: replay.sessionId },
          select: {
            id: true,
            stationCallsign: true,
            facilityType: true,
            frequencyMhz: true,
            controllerCid: true,
            controllerName: true,
            startedAt: true,
            endedAt: true,
          },
          orderBy: { startedAt: "asc" },
        }),
        // Environment + radio snapshot from LiveSession. These aren't
        // in ReplayData.sessionInfo (it predates B1/B2) so we pull
        // them directly. Nullable across the board — pre-B1/B2
        // sessions just produce nulls.
        prisma.liveSession.findUnique({
          where: { id: replay.sessionId },
          select: {
            windSpeedKts: true,
            windDirection: true,
            oatCelsius: true,
            ambientPressureMb: true,
            com1ActiveMhz: true,
            com1StandbyMhz: true,
            nav1ActiveMhz: true,
          },
        }),
      ])
    : ([[], [], null] as const);

  // Build the envelope. Field-naming uses the existing camelCase style
  // throughout — we deliberately avoid a "snake_case for cross-tool
  // compatibility" reformat because there's no consumer yet to justify
  // the divergence. If a future visualizer in another language wants
  // snake_case, it can transform on import.
  const envelope = {
    format: "vam-replay/v1",
    generatedAt: new Date().toISOString(),
    pirep: {
      id: pirep.id,
      flightNumber: pirep.route?.flightNumber ?? null,
      departureIcao: pirep.departure.icao,
      departureName: pirep.departure.name,
      arrivalIcao: pirep.arrival.icao,
      arrivalName: pirep.arrival.name,
      aircraftType: pirep.aircraft?.type ?? null,
      aircraftRegistration: pirep.aircraft?.registration ?? null,
      pilotName: pirep.user.name,
      submittedAt: pirep.submittedAt.toISOString(),
      flightTimeMin: pirep.flightTimeMin,
      status: pirep.status,
    },
    session: replay.available
      ? {
          matchType: replay.matchType,
          sessionId: replay.sessionId,
          network: replay.sessionInfo.network,
          callsign: replay.sessionInfo.callsign,
          aircraftType: replay.sessionInfo.aircraftType,
          aircraftRegistration: replay.sessionInfo.aircraftRegistration,
          connectedAt: replay.sessionInfo.connectedAt.toISOString(),
          lastUpdatedAt: replay.sessionInfo.lastUpdatedAt.toISOString(),
          // B1 environment snapshot at flight-end.
          windSpeedKts: sessionExtras?.windSpeedKts ?? null,
          windDirection: sessionExtras?.windDirection ?? null,
          oatCelsius: sessionExtras?.oatCelsius ?? null,
          ambientPressureMb: sessionExtras?.ambientPressureMb ?? null,
          // B2 radio snapshot at flight-end.
          com1ActiveMhz: sessionExtras?.com1ActiveMhz ?? null,
          com1StandbyMhz: sessionExtras?.com1StandbyMhz ?? null,
          nav1ActiveMhz: sessionExtras?.nav1ActiveMhz ?? null,
        }
      : { available: false as const, reason: replay.reason },
    positions: replay.available ? replay.positions : [],
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      timestamp: e.timestamp.toISOString(),
      payload: e.payload,
    })),
    atcSessions: atcSessions.map((a) => ({
      id: a.id,
      stationCallsign: a.stationCallsign,
      facilityType: a.facilityType,
      frequencyMhz: a.frequencyMhz,
      controllerCid: a.controllerCid,
      controllerName: a.controllerName,
      startedAt: a.startedAt.toISOString(),
      endedAt: a.endedAt?.toISOString() ?? null,
    })),
  };

  // Filename: flightNumber-YYYY-MM-DD.vam-replay. Falls back to "PIREP"
  // when the PIREP has no route-flight-number (manual/standalone), and
  // strips characters that some filesystems don't like (slashes, colons,
  // quotes) defensively. UTC date used for cross-timezone consistency.
  const safeFlightNum = (pirep.route?.flightNumber ?? "PIREP").replace(
    /[\\/:*?"<>|]/g,
    "_",
  );
  const dateStr = pirep.submittedAt.toISOString().slice(0, 10); // YYYY-MM-DD
  const filename = `${safeFlightNum}-${dateStr}.vam-replay`;

  return new NextResponse(JSON.stringify(envelope, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
