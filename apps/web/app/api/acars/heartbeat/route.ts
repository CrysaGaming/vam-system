import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma, NetworkType, Simulator, Prisma } from '@vam/db';
import { authenticateAcarsRequest } from '@/lib/acars/auth';
import {
  acarsRateLimitHeaders,
  checkAcarsRateLimit,
} from '@/lib/acars/rate-limit';
import {
  buildHeartbeatPhaseInput,
  buildPreviousPhaseState,
  resolveHeartbeatPhase,
} from '@/lib/acars/heartbeat-phase';
import { resolveAircraftType } from '@/lib/acars/aircraft-resolution';
import {
  detectBlockEvents,
  buildBlockEventPayload,
  isSessionStale,
  buildConnectionLostPayload,
  type BlockEventInputs,
} from '@/lib/acars/block-events';
import { triggerAutoPirep } from '@/lib/acars/auto-pirep';
import { matchAndPersistAtcSession } from '@/lib/acars/atc-matcher';
import { notifyFollowersOfLiveStart } from '@/lib/notifications/follower-fanout';

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
      // Welle B — B1 phase 2. Sea-level QNH in millibars. Float (not int)
      // because the sim's BAROMETER PRESSURE simvar provides ~0.1 mb
      // resolution that matches METAR Q-group precision (1013.2). Rounding
      // to int would round-trip 1013.6/1014.4 to 1014/1014 and erase the
      // meaningful sub-mb deltas that make the PIREP weather-comparison
      // useful. Range gate: typical sea-level QNH is 870-1085 mb (lowest
      // ever recorded 870, highest 1085); the schema lets ±200 of that
      // window through to allow for sim weather edge-cases without
      // policing too strictly here — display layer can call out outliers.
      ambientPressureMb: z.number().min(800).max(1100).optional(),
    })
    .optional(),

  // Welle B — B2 phase 2A. COM1 + NAV1 frequency snapshot in MHz from
  // the client's radio-stack. The downstream ATC-session-tracker
  // (phase 2B) matches these against the VATSIM ATC datafeed; for
  // phase 2A we just persist them on LiveSession so the data is there
  // when 2B's matcher comes online.
  //
  // Validation rules per band (ICAO/FAA allocations):
  //   - COM (VHF voice):    118.000 - 137.000 MHz (civilian aviation)
  //   - NAV (VOR/ILS LOC):  108.000 - 118.000 MHz (NAV freq, NOT COM)
  //
  // The com1Standby field intentionally shares COM's range — pilots
  // sometimes "park" NAV frequencies on COM standby for memo purposes
  // but the actual radio-stack standby slot is always in the COM band.
  //
  // Range gates: we accept the FULL combined civil aviation band
  // (108-137) for all three fields rather than splitting strictly,
  // because (a) some military / non-standard equipment uses 117.x for
  // COM, (b) some pilots tune marker beacons or other off-band signals,
  // (c) being permissive at the wire-edge avoids cryptic 400-rejects
  // for edge cases — the matcher in phase 2B can apply the strict-band
  // logic for actual ATC-attribution.
  //
  // All fields optional + nullable. Older clients (pre-B2 phase 1) send
  // no `radios` block; zod's .optional() accepts that as "absent".
  radios: z
    .object({
      com1ActiveMhz: z.number().min(108).max(137).nullable().optional(),
      com1StandbyMhz: z.number().min(108).max(137).nullable().optional(),
      nav1ActiveMhz: z.number().min(108).max(137).nullable().optional(),
    })
    .optional(),

  // Welle B — B4 phase 1. Aircraft-substitution disposition from the
  // pre-flight checklist. Sent ONCE at session-start by the ACARS
  // client (typically on the first heartbeat after the user confirmed
  // the dialog) and persisted on LiveSession.aircraftSubstitution.
  //
  // intent semantics:
  //   - "intentional"  : pilot deliberately flying a different aircraft
  //                      than booked (livery issue, mood, training).
  //                      Optional `reason` lets them explain in free
  //                      text — UI shows the reason on the PIREP for
  //                      admin context without escalation.
  //   - "wrongBooking" : pilot believes the booking aircraft is wrong
  //                      and wants admin to reconcile. UI raises an
  //                      admin-flag on the PIREP. No reason field
  //                      because the disposition itself is the signal.
  //
  // The "wrongLoaded — sim schließen" path doesn't reach the server:
  // the client aborts the connect-flow before any heartbeat is sent.
  // We don't need a third value here.
  //
  // bookedAircraftType / flownAircraftType: captured client-side at
  // dialog-confirm-time. We persist the snapshot so admin review later
  // sees exactly what the pilot was looking at when they made the
  // choice. The server could re-derive these from booking + telemetry
  // but a snapshot is more honest about "this is what the pilot saw".
  //
  // ICAO designator length: ICAO aircraft type codes are 2-4 chars
  // (A20N, B738, C172, DC10, P28A, etc.). Wider window (1-8) to tolerate
  // edge cases like manufacturer-specific variants without rejecting
  // the payload — the field is documentary, not used for matching.
  //
  // Reason length: 200 chars — same range used elsewhere in this file
  // for short user-supplied free text (cf. flightRemarks).
  //
  // Optional at the block level: most heartbeats don't carry this
  // (only the first one of a session, and only when the dialog was
  // shown). Subsequent heartbeats with this block absent leave the
  // existing LiveSession.aircraftSubstitution row unchanged.
  aircraftSubstitution: z
    .object({
      intent: z.enum(['intentional', 'wrongBooking']),
      bookedAircraftType: z.string().min(1).max(8),
      flownAircraftType: z.string().min(1).max(8),
      reason: z.string().max(200).nullable().optional(),
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

  // ─── Welle C / C6 — per-user rate limit ─────────────────────────────
  //
  // Tight gate immediately after auth, before any body parsing or DB
  // work. A throttled client should be cheap to reject — we don't want
  // a pathological-cadence sender to do real work (zod parse, prisma
  // calls, M3.9 phase resolution) just to have the result thrown away.
  //
  // The check is keyed on userId (auth always succeeded by this point,
  // so the id is always defined). See lib/acars/rate-limit.ts for the
  // threshold/window choice and threat-model rationale.
  //
  // Headers attach to BOTH the 429-reject AND the eventual 200-success
  // response, so well-behaved clients can read X-RateLimit-Remaining
  // and back off preemptively. The 429 additionally sets Retry-After
  // (RFC 9110 §10.2.3) with the seconds-until-window-reset value —
  // matches what the C6 client-side handler reads.
  const rl = checkAcarsRateLimit(`user:${auth.user.id}`);
  const rlHeaders = acarsRateLimitHeaders(rl);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: 'rate-limited',
        retryAfterSec: rl.retryAfterSec,
        message: `Heartbeat rate limit exceeded (${rl.limit}/min per user). Retry in ${rl.retryAfterSec}s.`,
      },
      {
        status: 429,
        headers: { ...rlHeaders, 'Retry-After': String(rl.retryAfterSec) },
      },
    );
  }

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

  // ─── simRate enforcement (option #19) ──────────────────────────────
  // If the pilot's airline opts into simRate-enforcement and the client
  // reports simRate > 1.01 (sim-time-acceleration), reject the heartbeat
  // with 422 so the client can surface the rejection to the user.
  //
  // Default behaviour (Airline.enforceSimRate=false): no rejection — the
  // existing remarks-prefix flag in generate-pirep.ts continues to surface
  // the violation at PIREP-approval time. Strict-realism airlines opt in
  // explicitly per row in Airline.enforceSimRate.
  //
  // Why 1.01 not 1.0: SimConnect occasionally reports 1.0001/0.9999 for
  // legitimate real-time flight due to floating-point/clock-jitter. 1%
  // headroom avoids false-positives without giving meaningful cheat room.
  //
  // One DB query per offending heartbeat — the vast majority of heartbeats
  // have simRate=1.0 (or omit the field entirely) and skip the lookup.
  // Acceptable cost given the airline-id is already known from auth.
  if (data.simRate && data.simRate > 1.01 && auth.user.airlineId) {
    const airline = await prisma.airline.findUnique({
      where: { id: auth.user.airlineId },
      select: { enforceSimRate: true, callsign: true, name: true },
    });
    if (airline?.enforceSimRate) {
      return NextResponse.json(
        {
          error: 'sim-rate-rejected',
          airline: airline.callsign ?? airline.name,
          simRate: data.simRate,
          message: `${airline.name} does not allow sim-rate acceleration (you reported ${data.simRate}x). Pause time-acceleration to continue.`,
        },
        { status: 422 },
      );
    }
  }

  const userId = auth.user.id;
  const now = new Date();

  // Find or create the active ACARS session. We dedup on
  // (userId, ACARS_CLIENT, isActive) — a user can only have one live
  // ACARS-session at a time. Concurrent heartbeats can race here in
  // theory; see the file-level docstring for why that's acceptable.
  //
  // We additionally select `lastAcarsHeartbeat` and `connectedAt`:
  // the former drives the M3.9 stale-session-cleanup below, the
  // latter feeds the BLOCK_ON event's flightDurationMinutes payload.
  const existingRaw = await prisma.liveSession.findFirst({
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
      lastAcarsHeartbeat: true,
      connectedAt: true,
      // Welle C / C1 — read the running time-acceleration counters
      // so the per-heartbeat update can extend them. See sessionFields
      // build below for the increment/reset rules.
      simRateMax: true,
      timeAccelConsecutive: true,
      timeAccelMaxRun: true,
    },
    orderBy: { lastUpdatedAt: 'desc' },
  });

  // ─── Stale-session cleanup (Welle 9 / M3.9) ──────────────────────────
  // If the last heartbeat is older than STALE_SESSION_THRESHOLD_MS
  // (10 minutes), the previous session is dead — the user closed the
  // sim, hit a long Wi-Fi outage, took a phone call, etc. We close
  // it now (isActive=false) and emit a CONNECTION_LOST event timed
  // to the actual last heartbeat (NOT to now), so future analytics
  // see realistic session boundaries instead of multi-hour ghosts.
  //
  // After cleanup, we treat `existing` as null so the rest of the
  // handler creates a brand-new session for this heartbeat. The
  // close runs in its own transaction — it doesn't need to be
  // atomic with the new-session create, and keeping them separate
  // avoids forcing the heartbeat to wait on a needlessly-large tx.
  let existing = existingRaw;
  if (existingRaw && isSessionStale(existingRaw.lastAcarsHeartbeat, now)) {
    // Non-null assertion is safe: isSessionStale returns false when
    // lastAcarsHeartbeat is null, so we only get here when it's set.
    const lastHb = existingRaw.lastAcarsHeartbeat!;
    await prisma.$transaction([
      prisma.liveSession.update({
        where: { id: existingRaw.id },
        data: { isActive: false },
      }),
      prisma.acarsEvent.create({
        data: {
          sessionId: existingRaw.id,
          type: 'CONNECTION_LOST',
          // Timestamp = when the connection actually died, not when
          // we noticed. Critical for M6 to compute realistic flight
          // durations from this audit trail.
          timestamp: lastHb,
          payload: buildConnectionLostPayload(
            lastHb,
            existingRaw.currentPhase,
            now,
          ) as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);
    existing = null;
  }

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

  // ─── Aircraft-type resolution (Welle 9 / M3.8) ───────────────────────
  // SimConnect's ATC MODEL simvar is unreliable — many MSFS aircraft
  // expose a localization token like "ATCCOM.AC_MODEL" instead of a
  // useful ICAO designator. The resolver tries (1) a fleet-registration
  // lookup against our Aircraft catalog, then (2) regex pattern matching
  // against title and type, then (3) falls back to the raw value or
  // "UNKN" if it looks like a token leak. Result is what we'll persist
  // in LiveSession.aircraftType — never the raw garbage.
  const resolvedAircraft = await resolveAircraftType({
    type: data.aircraft.type,
    registration: data.aircraft.registration,
    title: data.aircraft.title ?? null,
  });

  // ─── Welle C / C1 — time-acceleration tracking ───────────────────────
  //
  // The roadmap rule is "3 aufeinanderfolgende heartbeats mit simRate
  // > 1.0 → flag". We maintain three counters on LiveSession that
  // together implement this without per-position storage:
  //
  //   timeAccelConsecutive: current run-length of consecutive
  //     heartbeats with simRate > 1.0. Reset to 0 on any heartbeat
  //     with simRate <= 1.0 (or simRate omitted, which we treat as
  //     1.0 — a client that doesn't report simRate isn't accelerating
  //     by definition for our purposes).
  //   timeAccelMaxRun: max run-length ever observed in this session.
  //     This is what buildPirepFlags checks against the >=3 threshold.
  //   simRateMax: max simRate value ever observed. Surfaced in the
  //     flag payload so admin review sees the actual peak (4.0x, 8.0x)
  //     rather than just "at least one run of 3+ frames".
  //
  // existing may be null (brand-new session OR stale-cleanup branch
  // above set it to null). In that case both counters start at 0
  // and simRateMax tracks just this heartbeat's value.
  //
  // We deliberately don't compare against the Airline.enforceSimRate
  // 1.01 threshold here — that's the real-time hard-reject threshold.
  // The flag-detection threshold is 1.0 (any non-real-time rate),
  // because the flag is post-hoc surveillance, not real-time
  // enforcement. A pilot doing 1.05x for 3+ frames still gets flagged
  // for admin review even if the airline doesn't hard-reject.
  const isAccelerated = (data.simRate ?? 1.0) > 1.0;
  const nextTimeAccelConsecutive = isAccelerated
    ? (existing?.timeAccelConsecutive ?? 0) + 1
    : 0;
  const nextTimeAccelMaxRun = Math.max(
    existing?.timeAccelMaxRun ?? 0,
    nextTimeAccelConsecutive,
  );
  // simRateMax: only consider client-reported values. If the client
  // doesn't send simRate at all, we leave the existing max unchanged
  // (no information one way or the other).
  const reportedSimRate = data.simRate ?? null;
  const previousSimRateMax = existing?.simRateMax ?? null;
  const nextSimRateMax =
    reportedSimRate !== null
      ? previousSimRateMax === null
        ? reportedSimRate
        : Math.max(previousSimRateMax, reportedSimRate)
      : previousSimRateMax;

  // Build the field-set used by both create and update so they can't drift.
  const sessionFields = {
    network: data.network,
    callsign: data.flight.callsign,
    flightNumber: data.flight.flightNumber ?? null,
    // Resolved ICAO designator (M3.8) — see resolveAircraftType for source-
    // hierarchy. The raw value from data.aircraft.type may be a localization
    // token; never persist it directly here.
    aircraftType: resolvedAircraft.icaoType,
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
    // Welle B — B1 phase 2. Sea-level QNH in mb from the sim. Persisted
    // alongside the other environment fields so the PIREP weather-
    // comparison UI can pull all four sim-side data points from a single
    // LiveSession row read instead of joining out to LiveSessionPosition
    // or recomputing from heartbeat-history.
    ambientPressureMb: data.environment?.ambientPressureMb ?? null,

    // Welle B — B2 phase 2A. COM1/NAV1 freq snapshot from heartbeat
    // radios-block. Persisted on LiveSession so phase 2B's matcher
    // (which runs against the VATSIM ATC datafeed, polled separately
    // by the bot) has the latest radio state available when it comes
    // online. Frontend UI (phase 3) doesn't read these directly —
    // they feed the AtcSession table via the matcher, and the UI
    // reads AtcSession. Nullable cascades: missing radios block
    // (pre-B2 client) → undefined → ?? null → DB NULL.
    com1ActiveMhz: data.radios?.com1ActiveMhz ?? null,
    com1StandbyMhz: data.radios?.com1StandbyMhz ?? null,
    nav1ActiveMhz: data.radios?.nav1ActiveMhz ?? null,

    gForce: data.forces?.gForce ?? null,

    currentPhase: resolved.phase,
    currentPhaseEnteredAt: resolved.state.enteredPhaseAt,
    transponder: data.transponder ?? null,

    simRate: data.simRate ?? null,
    totalPauseSeconds: data.totalPauseSeconds ?? 0,

    // Welle C / C1 — running anti-cheat counters. Computed above; see
    // the "time-acceleration tracking" comment-block for the increment
    // rules. Always written so the row state is internally consistent
    // (max ≥ current, current ≥ 0).
    simRateMax: nextSimRateMax,
    timeAccelConsecutive: nextTimeAccelConsecutive,
    timeAccelMaxRun: nextTimeAccelMaxRun,

    lastUpdatedAt: now,
    isActive: true,
  };

  // Welle B — B4 phase 1. Aircraft-substitution disposition is one-shot
  // (sent on the heartbeat right after the pre-flight dialog confirms)
  // and MUST NOT be overwritten on subsequent heartbeats that don't
  // include the block. We can't just stick `aircraftSubstitution: null`
  // into sessionFields above — that would clobber the row's existing
  // value on every heartbeat after the dialog. Solution: build a
  // separate optional field object that we only populate when the
  // client actually sent the block, then spread it conditionally into
  // the create/update payloads below. When the block is absent the
  // spread is a no-op and Prisma leaves the existing column value
  // untouched.
  //
  // Json cast: Prisma's typed field for Json columns is
  // `Prisma.InputJsonValue`. The zod-validated `data.aircraftSubstitution`
  // is a structurally-compatible object, but TS doesn't know that
  // without the cast. `as unknown as Prisma.InputJsonValue` is the
  // canonical pattern across this codebase for narrow JSON inserts
  // (see the buildBlockEventPayload spreads further down).
  const extraSessionFields: {
    aircraftSubstitution?: Prisma.InputJsonValue;
  } = {};
  if (data.aircraftSubstitution) {
    extraSessionFields.aircraftSubstitution =
      data.aircraftSubstitution as unknown as Prisma.InputJsonValue;
  }

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

  // ─── Block-event detection (Welle 9 / M3.9) ──────────────────────────
  // Translate the phase transition into BLOCK_OFF / TOUCHDOWN / BLOCK_ON
  // events where applicable. Most heartbeats produce zero events;
  // genuine transitions produce exactly one. We pre-build the inputs
  // once so both transaction branches (existing/new session) can iterate
  // over the same data.
  const blockEventTypes = resolved.changed
    ? detectBlockEvents(previousPhaseState.currentPhase, resolved.phase)
    : [];
  const blockEventInputs: BlockEventInputs = {
    resolvedAircraftType: resolvedAircraft.icaoType,
    aircraftRegistration: data.aircraft.registration,
    aircraftTitle: data.aircraft.title ?? null,
    departureIcao: data.flight.departure ?? null,
    arrivalIcao: data.flight.arrival ?? null,
    latitude: data.position.latitude,
    longitude: data.position.longitude,
    altitudeFt: data.position.altitudeFt,
    altitudeAglFt: data.position.altitudeAglFt ?? null,
    groundSpeedKts: data.speed.groundKts,
    verticalFpm: data.speed.verticalFpm,
    onGround: data.state.onGround,
    parkingBrake: data.state.parkingBrake ?? null,
    fuelTotalKg: data.engine?.fuelTotalKg ?? null,
    // For existing sessions, use the original connectedAt to compute
    // realistic flight durations on BLOCK_ON. For new sessions (rare:
    // would require a heartbeat that *opens* the session at exactly
    // a block-event-producing transition), we fall back to now —
    // duration becomes ~0min, which is correct because no flight
    // time has accumulated yet.
    sessionConnectedAt: existing?.connectedAt ?? now,
    now,
  };

  // ─── Hard-landing INCIDENT detection (option #7) ─────────────────────
  //
  // When TOUCHDOWN fires, look at the verticalFpm in the inputs. Negative
  // values (descending into the runway) below the threshold trigger an
  // additional INCIDENT AcarsEvent that admins can surface during PIREP-
  // review. This catches accidental hard landings so they're flagged in
  // the queue rather than disappearing into the average.
  //
  // Severity bands match common industry guidance:
  //   - "firm"   :    -200 to -400 fpm — hard but normal in turbulence
  //   - "hard"   :    -400 to -600 fpm — reportable in real-world ops
  //   - "severe" :    -600 to -1000 fpm — gear inspection territory
  //   - "crash"  :    < -1000 fpm — write-off
  // We emit INCIDENT only at "hard" or worse (≤ -600 fpm). Firm landings
  // are common in MSFS without a real flare and don't need flagging.
  //
  // Why a separate event rather than augmenting the TOUCHDOWN payload:
  // INCIDENT is a discrete kind in the AcarsEventType enum with its own
  // schema-comment-documented payload shape ({ kind, severity, value }).
  // Keeping the two events separate lets future incident-types (STALL,
  // OVERSPEED, OVERBANK) plug into the same INCIDENT event flow without
  // needing TOUCHDOWN-specific payload growth. It also lets the admin
  // queue filter on type=INCIDENT to find ALL incidents regardless of
  // kind, which is the normal review-flow.
  const HARD_LANDING_THRESHOLD_FPM = -600;
  const SEVERE_LANDING_THRESHOLD_FPM = -1000;
  const incidentPayload: Prisma.InputJsonValue | null =
    blockEventTypes.includes('TOUCHDOWN') &&
    data.speed.verticalFpm <= HARD_LANDING_THRESHOLD_FPM
      ? {
          kind: 'HARD_LANDING',
          // Severity is computed at flag-time so the queue UI can display
          // it directly without re-deriving from value. "crash" reserved
          // for future use; we don't want to crash-flag an MSFS bounced
          // landing on first iteration without seeing real-world examples.
          severity:
            data.speed.verticalFpm <= SEVERE_LANDING_THRESHOLD_FPM
              ? 'severe'
              : 'hard',
          value: data.speed.verticalFpm,
          // Co-located ICAO + aircraft type so admin-review doesn't have
          // to join back to LiveSession just to know what plane / where.
          // Mirrors the convenience fields in the TOUCHDOWN payload.
          aircraftType: resolvedAircraft.icaoType,
          arrivalIcao: data.flight.arrival ?? null,
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
        data: { ...sessionFields, ...extraSessionFields },
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
    // M3.9 block events ride on the same transaction so a phase
    // transition + its derived event(s) commit atomically. Empty
    // array (most heartbeats) → no operations added.
    for (const eventType of blockEventTypes) {
      operations.push(
        prisma.acarsEvent.create({
          data: {
            sessionId: existing.id,
            type: eventType,
            timestamp: now,
            payload: buildBlockEventPayload(
              eventType,
              blockEventInputs,
            ) as unknown as Prisma.InputJsonValue,
          },
        }),
      );
    }
    // Hard-landing INCIDENT (option #7) rides on the same tx — atomic
    // with the TOUCHDOWN that triggered it. Same timestamp; admins
    // viewing the audit-trail see them paired without an ordering race.
    if (incidentPayload) {
      operations.push(
        prisma.acarsEvent.create({
          data: {
            sessionId: existing.id,
            type: 'INCIDENT',
            timestamp: now,
            payload: incidentPayload,
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
          ...extraSessionFields,
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
      // M3.9 block events — same atomicity rationale as in the
      // existing-session branch above. In practice we'd rarely
      // emit a block event on session creation (the phase-detector
      // needs a previous phase to compute a transition, which is
      // null here), but if it ever does happen we want it captured.
      for (const eventType of blockEventTypes) {
        await tx.acarsEvent.create({
          data: {
            sessionId: session.id,
            type: eventType,
            timestamp: now,
            payload: buildBlockEventPayload(
              eventType,
              blockEventInputs,
            ) as unknown as Prisma.InputJsonValue,
          },
        });
      }
      // INCIDENT (option #7) — same-tx as the TOUCHDOWN above. New-
      // session branch is unlikely to hit this path (a heartbeat that
      // *opens* a session AND triggers TOUCHDOWN simultaneously means
      // the user reconnected mid-flight at the exact moment of touch-
      // down, which is rare) but the symmetry with the existing-session
      // branch makes the code obvious and robust.
      if (incidentPayload) {
        await tx.acarsEvent.create({
          data: {
            sessionId: session.id,
            type: 'INCIDENT',
            timestamp: now,
            payload: incidentPayload,
          },
        });
      }
      return session;
    });
    sessionId = created.id;

    // Welle G / G4 — Follower-fanout für neuen LiveSession-start.
    // Nur in der NEW-session-branch — bei reconnect/existing-session
    // sind wir den followers nicht erneut "ist jetzt live"-benachrich-
    // tigung schuldig. Fire-and-forget; failures loggen aber nicht
    // den heartbeat-roundtrip blockieren (latency-budget ~50ms p99).
    void notifyFollowersOfLiveStart(userId, sessionId).catch((err) =>
      console.warn('[heartbeat] follower-fanout (live-start) failed:', err),
    );
  }

  // ─── M6: BLOCK_ON → auto-PIREP bridge ──────────────────────────────
  //
  // M3.9 committed AcarsEvent rows for BLOCK_OFF / TOUCHDOWN / BLOCK_ON
  // when the phase-detector saw a relevant transition, but did NOT
  // file a PIREP — that was deferred to M6.
  //
  // M6 closes the loop: when this heartbeat just produced a BLOCK_ON
  // event, fire the auto-PIREP helper. Side-channels (Discord broadcast,
  // rank-promotion check) are bundled inside the helper.
  //
  // CRITICAL: fire-and-forget. The heartbeat round-trip is ~50ms p99
  // and the client expects that latency budget so its 2Hz cadence
  // doesn't fall behind. PIREP-creation involves several queries plus
  // optional Discord HTTP — easily 200-400ms. Awaiting it would push
  // every BLOCK_ON heartbeat over budget. void + .catch() is the
  // canonical pattern; any failure logs but doesn't propagate.
  //
  // We pass null payload because the helper has sane fallbacks: it
  // derives flightTimeMin from session.connectedAt → session.lastUpdatedAt
  // (wall-clock, includes pre-flight time but accurate enough for v1).
  // When the client eventually starts posting BLOCK_ON events to
  // /api/acars/event with a richer payload (block-to-block delta,
  // total fuel burned), that path uses the same helper and overrides
  // the fallbacks. Both paths are idempotent via session.isActive.
  if (blockEventTypes.includes('BLOCK_ON')) {
    void triggerAutoPirep(sessionId, userId, null).catch((err) =>
      console.warn('[acars/heartbeat] auto-PIREP trigger failed:', err),
    );
  }

  // ─── Welle B — B2 phase 2B. ATC-session matcher ────────────────────
  //
  // Fire-and-forget like the auto-PIREP trigger above. Same rationale:
  // the matcher does a cached-bot-fetch + a prisma read + 0-2 writes
  // (typically 0 because most heartbeats see "same controller as before",
  // a no-op). Even cached worst-case (~20ms) is too much to add to the
  // hot heartbeat-response path.
  //
  // We pass com1ActiveMhz directly — the matcher knows how to handle
  // null (closes any open AtcSession) and how to handle bot-down (skips
  // the heartbeat without DB changes). All error-handling is internal
  // to matchAndPersistAtcSession; the .catch here is belt-and-braces
  // for the case where the matcher itself throws synchronously before
  // its internal try/catch can intercept.
  //
  // The matcher is invoked even when blockEventTypes triggers a BLOCK_ON
  // → auto-PIREP path: a session in the BLOCK_ON heartbeat could still
  // have an open AtcSession that needs closing (e.g., the pilot was on
  // EDDF_GND at touchdown and never tuned away). The matcher's
  // "close-existing-when-no-match" path handles that correctly because
  // post-BLOCK_ON the pilot's com1 is often still tuned but no longer
  // actively controlling, and we want the AtcSession to close cleanly.
  void matchAndPersistAtcSession(
    sessionId,
    data.radios?.com1ActiveMhz ?? null,
    data.position.latitude,
    data.position.longitude,
  ).catch((err) =>
    console.warn('[acars/heartbeat] atc-matcher trigger failed:', err),
  );

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
  //
  // Echo the resolved aircraft identity back too (M3.8.1).
  //
  // Same single-source-of-truth argument as for phase: the client's
  // raw SimConnect ATC MODEL simvar is often a localization token
  // (`ATCCOM.AC_MODEL_A320.0.text`) which is what the live-map fixed
  // via M3.8's resolver. Without echoing the resolved value the
  // tray-app and other clients would have to either show the ugly
  // raw string or duplicate the resolver logic. By including the
  // already-resolved values in the response we let any client surface
  // exactly what the live-map shows ("A320 / D-ANNE") with zero extra
  // logic.
  //
  // - aircraftType: M3.8-resolved ICAO designator (fleet-match →
  //   pattern-match → fallback). Always present.
  // - aircraftRegistration: tail number from the original heartbeat
  //   payload. Echoed verbatim — no resolver needed since registration
  //   is what the client actively types into the form. May be null
  //   for pilots flying with no registration set.
  return NextResponse.json(
    {
      ok: true,
      sessionId,
      currentPhase: resolved.phase,
      currentPhaseEnteredAt:
        resolved.state.enteredPhaseAt?.toISOString() ?? null,
      phaseChanged: resolved.changed,
      phaseSource: resolved.source,
      aircraftType: resolvedAircraft.icaoType,
      aircraftRegistration: data.aircraft.registration ?? null,
    },
    // Welle C / C6 — surface remaining-quota on every 200 so well-
    // behaved clients can read X-RateLimit-Remaining and slow down
    // preemptively before hitting a 429. rlHeaders is closed over
    // from the top of the handler — same values as on the 429 path,
    // updated to reflect THIS request's increment.
    { headers: rlHeaders },
  );
}
