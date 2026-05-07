import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma, NetworkType, Simulator, Prisma } from '@vam/db';
import { authenticateAcarsRequest } from '@/lib/acars/auth';
import {
  buildHeartbeatPhaseInput,
  buildPreviousPhaseState,
  resolveHeartbeatPhase,
} from '@/lib/acars/heartbeat-phase';

/**
 * POST /api/acars/heartbeat — Welle 9 commit 9C.
 *
 * The primary data-channel from the ACARS desktop-client. Called every
 * 1-2 seconds while the sim is running. Each call:
 *   1. Authenticates the bearer token.
 *   2. Finds (or creates) the active ACARS-session for this user.
 *   3. Updates the session with the latest snapshot of telemetry.
 *   4. Appends a LiveSessionPosition row for the trail.
 *   5. Bumps user.acarsLastSeen so the settings card shows online-state.
 *
 * Concurrency model: app-layer dedup via findFirst on
 * (userId, dataSource=ACARS_CLIENT, isActive=true). The schema doesn't
 * have a unique constraint here because adding one would either need
 * partial-index support (Postgres-only) or change the existing
 * (network, externalId) @@unique. Our pattern is good-enough at the
 * heartbeat-cadence we expect: client emits at 1-2s, the chance of
 * two heartbeats from the same client racing is small, and even if
 * it happens, two parallel sessions would just both get telemetry
 * (both rendered on the live-map, no data corruption).
 *
 * Anti-replay: the request body includes a client-side timestamp.
 * We reject heartbeats whose timestamp is more than 5 minutes in the
 * past (replay-attack window) or more than 1 minute in the future
 * (clock-drift safety net). The client should sync against the server-
 * Time returned by /api/acars/status if it sees these rejections.
 *
 * Idempotency: not strictly idempotent — each call appends a position-
 * row. But the LiveSession upsert is idempotent in shape (same input
 * → same row state), so a retried heartbeat on network failure just
 * adds an extra position-row, which is harmless.
 *
 * Telemetry payload: deliberately tolerant of missing fields. The
 * ACARS-client may not have access to every SimConnect variable on
 * every aircraft (e.g., engineN1 doesn't make sense on a glider).
 * All extended fields are optional; only position+heading+speed are
 * truly required.
 *
 * Position-volume: at 1Hz over a 2hr flight that's 7200 rows per
 * session. Across N pilots, this scales linearly. Cleanup strategy
 * is out-of-scope for 9C — when the table grows, options are:
 *   1. Downsample to 1/min after PIREP-approval (lossy but cheap).
 *   2. Time-bound retention (delete > 30 days unless attached to PIREP).
 *   3. Move to a time-series store (TimescaleDB/Influx) once we have
 *      the load to justify the operational complexity.
 */

// ─────────────────────────────────────────────────────────────────────────
// Validation schema — mirrors HeartbeatSchema in acars-architecture.md
// ─────────────────────────────────────────────────────────────────────────

const PhaseEnum = z.enum([
  'PreFlight',
  'Pushback',
  'Taxi',
  'Takeoff',
  'Climb',
  'Cruise',
  'Descent',
  'Approach',
  'Landing',
  'TaxiIn',
  'BlockOn',
]);

const HeartbeatSchema = z.object({
  // ISO-8601 client-side timestamp. Used for anti-replay window check.
  timestamp: z.string().datetime(),

  // Client identity
  clientVersion: z.string().min(1).max(64),
  simulator: z.nativeEnum(Simulator),

  // Network the user is announcing (may differ per-flight from
  // user.preferredNetwork — client allows override).
  network: z.nativeEnum(NetworkType),

  phase: PhaseEnum.optional(),

  flight: z.object({
    callsign: z.string().min(1).max(32),
    flightNumber: z.string().max(16).optional(),
    departure: z.string().length(4).optional(),
    arrival: z.string().length(4).optional(),
    alternate: z.string().length(4).optional(),
    cruiseAltitude: z.number().int().nonnegative().optional(),
    flightRules: z.enum(['IFR', 'VFR', 'SVFR', 'Y', 'Z']).optional(),
    route: z.string().max(2000).optional(),
    remarks: z.string().max(500).optional(),
  }),

  aircraft: z.object({
    type: z.string().min(1).max(16),
    registration: z.string().min(1).max(16),
    title: z.string().max(120).optional(),
  }),

  position: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    altitudeFt: z.number().int(),
    altitudeAglFt: z.number().int().optional(),
    headingTrue: z.number().min(0).max(360),
    pitch: z.number().optional(),
    bank: z.number().optional(),
  }),

  speed: z.object({
    indicatedKts: z.number().int().nonnegative().optional(),
    trueKts: z.number().int().nonnegative().optional(),
    groundKts: z.number().int().nonnegative(),
    mach: z.number().nonnegative().optional(),
    verticalFpm: z.number().int(),
  }),

  state: z.object({
    onGround: z.boolean(),
    parkingBrake: z.boolean().optional(),
    flapsPercent: z.number().int().min(0).max(100).optional(),
    gearDown: z.boolean().optional(),
    spoilersDeployed: z.boolean().optional(),
    autopilotMaster: z.boolean().optional(),
  }),

  engine: z
    .object({
      n1Avg: z.number().optional(),
      n2Avg: z.number().optional(),
      fuelFlowPph: z.number().int().nonnegative().optional(),
      fuelTotalKg: z.number().int().nonnegative().optional(),
    })
    .optional(),

  environment: z
    .object({
      windSpeedKts: z.number().int().nonnegative().optional(),
      windDirection: z.number().int().min(0).max(360).optional(),
      oatCelsius: z.number().int().optional(),
    })
    .optional(),

  forces: z
    .object({
      gForce: z.number().optional(),
    })
    .optional(),

  // Anti-cheat metrics. simRate=1.0 is real-time. totalPauseSeconds
  // accumulates while the sim is paused; the server uses this in 9F's
  // PIREP-validation to flag suspicious patterns.
  simRate: z.number().positive().optional(),
  totalPauseSeconds: z.number().int().nonnegative().optional(),

  // Transponder squawk — already on LiveSession from earlier waves
  transponder: z.string().max(8).optional(),
});

// ─────────────────────────────────────────────────────────────────────────
// Anti-replay window
// ─────────────────────────────────────────────────────────────────────────

/** 5-minute past tolerance — accommodates retries on flaky networks */
const TIMESTAMP_PAST_WINDOW_MS = 5 * 60 * 1000;
/** 1-minute future tolerance — accommodates client clock-drift */
const TIMESTAMP_FUTURE_WINDOW_MS = 60 * 1000;

function isTimestampWithinWindow(clientTs: string): boolean {
  const ts = Date.parse(clientTs);
  if (Number.isNaN(ts)) return false;
  const now = Date.now();
  return ts >= now - TIMESTAMP_PAST_WINDOW_MS && ts <= now + TIMESTAMP_FUTURE_WINDOW_MS;
}

// ─────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await authenticateAcarsRequest(req);
  if ('response' in auth) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 });
  }

  const parsed = HeartbeatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid-payload', issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const data = parsed.data;

  if (!isTimestampWithinWindow(data.timestamp)) {
    return NextResponse.json(
      { error: 'timestamp-out-of-window' },
      { status: 400 },
    );
  }

  const userId = auth.user.id;
  const now = new Date();

  // Find or create the active ACARS session. We dedup on
  // (userId, ACARS_CLIENT, isActive) — a user can only have one live
  // ACARS-session at a time. Concurrent heartbeats can race here in
  // theory; see the file-level docstring for why that's acceptable.
  const existing = await prisma.liveSession.findFirst({
    where: {
      userId,
      dataSource: 'ACARS_CLIENT',
      isActive: true,
    },
    select: {
      id: true,
      externalId: true,
      currentPhase: true,
      currentPhaseEnteredAt: true,
    },
    orderBy: { lastUpdatedAt: 'desc' },
  });

  // ─── Phase-detection (Welle 9 Phase 5) ───────────────────────────────
  // Server-side state-machine derives phase from telemetry when the
  // client doesn't send `phase`. When client DOES send it, that value
  // wins (the client sees mid-frame transitions the server can't see
  // between heartbeats). On phase-change we emit a PHASE_CHANGE event.
  const previousPhaseState = buildPreviousPhaseState(
    existing?.currentPhase ?? null,
    existing?.currentPhaseEnteredAt ?? null,
    now,
  );
  const phaseInput = buildHeartbeatPhaseInput(data, now);
  const resolved = resolveHeartbeatPhase(data.phase, phaseInput, previousPhaseState, now);

  // Build the field-set used by both create and update so they can't drift.
  const sessionFields = {
    network: data.network,
    callsign: data.flight.callsign,
    flightNumber: data.flight.flightNumber ?? null,
    aircraftType: data.aircraft.type,
    aircraftRegistration: data.aircraft.registration,
    aircraftTitle: data.aircraft.title ?? null,
    acarsClientVersion: data.clientVersion,
    acarsSimulator: data.simulator,
    lastAcarsHeartbeat: now,

    departureIcao: data.flight.departure ?? null,
    arrivalIcao: data.flight.arrival ?? null,
    alternateIcao: data.flight.alternate ?? null,
    cruiseAltitude: data.flight.cruiseAltitude ?? null,
    flightRules: data.flight.flightRules ?? null,
    flightRoute: data.flight.route ?? null,
    flightRemarks: data.flight.remarks ?? null,

    latitude: data.position.latitude,
    longitude: data.position.longitude,
    altitude: data.position.altitudeFt,
    altitudeAglFt: data.position.altitudeAglFt ?? null,
    heading: Math.round(data.position.headingTrue),
    pitch: data.position.pitch ?? null,
    bank: data.position.bank ?? null,

    indicatedAirspeed: data.speed.indicatedKts ?? null,
    trueAirspeed: data.speed.trueKts ?? null,
    groundSpeed: data.speed.groundKts,
    mach: data.speed.mach ?? null,
    verticalSpeedFpm: data.speed.verticalFpm,

    onGround: data.state.onGround,
    parkingBrake: data.state.parkingBrake ?? null,
    flapsPercent: data.state.flapsPercent ?? null,
    gearDown: data.state.gearDown ?? null,
    spoilersDeployed: data.state.spoilersDeployed ?? null,
    autopilotMaster: data.state.autopilotMaster ?? null,

    engineN1Avg: data.engine?.n1Avg ?? null,
    engineN2Avg: data.engine?.n2Avg ?? null,
    fuelFlowPph: data.engine?.fuelFlowPph ?? null,
    fuelTotalKg: data.engine?.fuelTotalKg ?? null,

    windSpeedKts: data.environment?.windSpeedKts ?? null,
    windDirection: data.environment?.windDirection ?? null,
    oatCelsius: data.environment?.oatCelsius ?? null,

    gForce: data.forces?.gForce ?? null,

    currentPhase: resolved.phase,
    currentPhaseEnteredAt: resolved.state.enteredPhaseAt,
    transponder: data.transponder ?? null,

    simRate: data.simRate ?? null,
    totalPauseSeconds: data.totalPauseSeconds ?? 0,

    lastUpdatedAt: now,
    isActive: true,
  };

  // Position-row to append. Same telemetry-subset that LiveSessionPosition
  // can hold — denormalized so we don't have to join LiveSession to
  // visualize a trail.
  const positionFields = {
    latitude: data.position.latitude,
    longitude: data.position.longitude,
    altitude: data.position.altitudeFt,
    groundSpeed: data.speed.groundKts,
    heading: Math.round(data.position.headingTrue),
    onGround: data.state.onGround,
    altitudeAglFt: data.position.altitudeAglFt ?? null,
    indicatedAirspeed: data.speed.indicatedKts ?? null,
    verticalSpeedFpm: data.speed.verticalFpm,
    pitch: data.position.pitch ?? null,
    bank: data.position.bank ?? null,
    flapsPercent: data.state.flapsPercent ?? null,
    gearDown: data.state.gearDown ?? null,
    phase: resolved.phase,
    recordedAt: now,
  };

  let sessionId: string;

  /**
   * Build the payload for the optional PHASE_CHANGE event. The audit-row
   * captures the transition + which source decided it (client knows
   * mid-frame, server reconstructs from telemetry).
   */
  const phaseChangePayload = resolved.changed
    ? {
        from: previousPhaseState.currentPhase,
        to: resolved.phase,
        source: resolved.source,
      }
    : null;

  if (existing) {
    sessionId = existing.id;
    // Single transaction: update session + append position + bump user
    // (+ optional phase-change event). If any step fails, none commit —
    // preserves consistency between session-state and position-trail.
    const operations: Prisma.PrismaPromise<unknown>[] = [
      prisma.liveSession.update({
        where: { id: existing.id },
        data: sessionFields,
      }),
      prisma.liveSessionPosition.create({
        data: { ...positionFields, sessionId: existing.id },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { acarsLastSeen: now },
      }),
    ];
    if (phaseChangePayload) {
      operations.push(
        prisma.acarsEvent.create({
          data: {
            sessionId: existing.id,
            type: 'PHASE_CHANGE',
            timestamp: now,
            payload: phaseChangePayload,
          },
        }),
      );
    }
    await prisma.$transaction(operations);
  } else {
    // Brand new session. Need to allocate an externalId — for ACARS,
    // VATSIM/IVAO don't apply, but the schema requires Int. Use the
    // negative-time-millis as a unique-ish placeholder that won't
    // collide with VATSIM CIDs (always positive 6-7 digit ints).
    const externalIdPlaceholder = -Math.floor(now.getTime() / 1000);

    const created = await prisma.$transaction(async (tx) => {
      const session = await tx.liveSession.create({
        data: {
          userId,
          dataSource: 'ACARS_CLIENT',
          externalId: externalIdPlaceholder,
          connectedAt: now,
          ...sessionFields,
        },
        select: { id: true },
      });
      await tx.liveSessionPosition.create({
        data: { ...positionFields, sessionId: session.id },
      });
      await tx.user.update({
        where: { id: userId },
        data: { acarsLastSeen: now },
      });
      if (phaseChangePayload) {
        await tx.acarsEvent.create({
          data: {
            sessionId: session.id,
            type: 'PHASE_CHANGE',
            timestamp: now,
            payload: phaseChangePayload,
          },
        });
      }
      return session;
    });
    sessionId = created.id;
  }

  // Echo the resolved phase back to the client (Welle 9 / M3.7).
  //
  // The client doesn't run its own phase-detector — we want one source
  // of truth, the server. By echoing `currentPhase` the client can
  // surface it in its UI ("Cruise — 0:42 since Climb"), debug
  // mismatches between client-claimed and server-resolved phases, and
  // later (M3.9+) trigger PIREP-state changes off transitions.
  //
  // Field choices:
  // - currentPhase: the phase the server has now committed to the
  //   LiveSession row. Always present.
  // - currentPhaseEnteredAt: ISO timestamp marking when this phase
  //   began. Lets the client compute time-in-phase without polling.
  //   May be null if the schema's never seen a phase transition for
  //   this session (defensive — should be set in practice).
  // - phaseChanged: true iff *this* heartbeat caused a transition.
  //   Useful for clients that want to log/animate transitions without
  //   tracking the previous value themselves.
  // - phaseSource: which side decided the phase. 'client' means the
  //   client sent `phase` and the server respected it; 'server'
  //   means the server's state-machine determined it from telemetry.
  //   Helps debug "why did the server pick X?".
  return NextResponse.json({
    ok: true,
    sessionId,
    currentPhase: resolved.phase,
    currentPhaseEnteredAt:
      resolved.state.enteredPhaseAt?.toISOString() ?? null,
    phaseChanged: resolved.changed,
    phaseSource: resolved.source,
  });
}
