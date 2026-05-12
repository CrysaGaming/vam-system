'use server';

import { auth } from '@/auth';
import { prisma, Prisma, processFlightEconomy, InsufficientFundsError, runAutoGrantForUser, evaluatePilotGoals } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { emitPirepApproved, emitPirepRejected, emitPirepSubmitted } from '@/lib/bot-events';
import {
  dispatchPirepApprovedEmail,
  dispatchPirepRejectedEmail,
} from '@/lib/email/dispatchers/pirep-decision';
import {
  parseDiscordTemplates,
  renderForEvent,
} from '@/lib/discord-templates';
import { evaluatePromotion } from '@/lib/ranks';
import { APPROVER_ROLES, isApproverRole } from '@/lib/roles';

/**
 * Server-side guard: throws wenn der current user keine approver-rolle hat.
 * Approver-rollen sind in @/lib/roles.ts (APPROVER_ROLES) zentralisiert
 * damit die liste nicht in mehreren files driftet — siehe dortigen
 * dokumentations-block.
 */
async function assertCanApprove() {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user) {
    throw new Error('User nicht gefunden');
  }

  if (!isApproverRole(user.role?.name)) {
    throw new Error(
      `Keine Berechtigung — nur ${APPROVER_ROLES.join(', ')} dürfen PIREPs prüfen`,
    );
  }

  return user;
}

/**
 * Genehmigt einen PIREP. Nur für rollen aus APPROVER_ROLES.
 * Postet Bot-Event nach #pireps.
 */
export async function approvePirep(pirepId: string) {
  const approver = await assertCanApprove();

  // Hole PIREP inkl. aller Daten für Bot-Embed
  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    include: {
      route: true,
      departure: true,
      arrival: true,
      aircraft: true,
      user: {
        include: {
          accounts: {
            where: { provider: 'discord' },
            select: { providerAccountId: true },
          },
          // Track 4 #83 (Section P): Discord-template-overrides werden
          // auf airline-ebene konfiguriert. Wir holen sie via user.airline
          // damit das include in einem roundtrip mit dem rest der PIREP-
          // daten kommt — keine separate query.
          airline: {
            select: { discordTemplates: true },
          },
        },
      },
    },
  });

  if (!pirep) {
    throw new Error('PIREP nicht gefunden');
  }

  if (pirep.status !== 'Submitted') {
    throw new Error(`PIREP hat bereits Status: ${pirep.status}`);
  }

  // Welle 4: Position-tracking. Bei approval setzen wir User.currentLocation*
  // auf den arrival-airport. Quelle = PIREP (audit-trail über LocationSource
  // enum). Das passiert ATOMAR mit dem PIREP-status-update via $transaction
  // — wenn entweder fehlschlägt, rollback. Verhindert inconsistent state
  // wo PIREP="Approved" aber User.currentLocation noch alt ist.
  //
  // Edge-cases:
  // - User hat schon eine ACARS/VATSIM-position: wir überschreiben trotzdem
  //   mit PIREP. Source-precedence (ACARS > VATSIM/IVAO > PIREP > JUMPSEAT >
  //   MANUAL) ist eine read-side concern (welche position bevorzugen wir
  //   beim ANZEIGEN?), nicht write-side. Beim WRITE setzen wir immer auf
  //   den aktuellsten event. App kann später z.B. live ACARS-positions
  //   bevorzugen wenn currentLocationAt jünger als x minuten ist.
  // - Multi-leg-flights: jeder approved PIREP setzt position auf seinen
  //   arrival. Sequenzielle approvals → letzte arrival gewinnt (correct).
  // - PIREP-re-approval nach un-reject: rejectPirep cleart position NICHT
  //   (siehe dortigen kommentar), also bleibt die alte position bis ein
  //   neuer PIREP approved wird. Bewusst — un-reject ist ein admin-fix-flow,
  //   nicht ein flight-event.
  //
  // Welle 5: Aircraft-position-tracking. Wenn der PIREP an ein aircraft
  // gebunden ist (aircraftId not null), setzen wir auch Aircraft.current
  // Location*. Mirrors die User-position-logik. Wenn aircraftId null ist
  // (z.B. legacy-PIREPs ohne aircraft, oder free-flight-PIREPs), kein
  // aircraft-update. Conditional ins transaction-array gepushed damit die
  // atomicity erhalten bleibt — entweder beide updates greifen oder keiner.
  // RETIRED-aircraft kriegen trotzdem position-updates wenn ein PIREP an
  // sie gebunden ist (kann durch alte bookings passieren); audit-trail
  // ist wertvoller als status-purity.
  const transactionOps: Prisma.PrismaPromise<unknown>[] = [
    prisma.pirep.update({
      where: { id: pirepId },
      data: {
        status: 'Approved',
        approvedAt: new Date(),
        approvedById: approver.id,
        // Falls vorher rejected war (nicht möglich aus diesem Zweig, aber defensiv): clearen
        rejectedAt: null,
        rejectionReason: null,
      },
    }),
    prisma.user.update({
      where: { id: pirep.userId },
      data: {
        currentLocationIcao: pirep.arrival.icao,
        currentLocationSource: 'PIREP',
        currentLocationAt: new Date(),
      },
    }),
  ];

  if (pirep.aircraftId) {
    transactionOps.push(
      prisma.aircraft.update({
        where: { id: pirep.aircraftId },
        data: {
          currentLocationIcao: pirep.arrival.icao,
          currentLocationAt: new Date(),
        },
      }),
    );
  }

  await prisma.$transaction(transactionOps);

  // Welle 13 (Economy MVP): nach erfolgreichem approval die economy
  // verarbeiten — passenger/cargo revenue auf airline-wallet, fuel/
  // landing/ground/catering expenses auf airline-wallet, salary-transfer
  // airline → user. Idempotent via Pirep.revenueProcessed-flag.
  //
  // Kein await innerhalb der approval-$transaction weil:
  //   1. Economy-processing hat seine eigene atomicity (separate
  //      $transaction für die 4-7 wallet-bewegungen)
  //   2. Wenn economy fehlschlägt (z.B. airline-wallet ist nicht
  //      mehr decken-fähig auch mit credit-puffer), soll der approval
  //      trotzdem stehen — admin kann später re-eval'n.
  //   3. Nicht-economy-airlines/-pilots sollen ohne overhead approven
  //      können — processFlightEconomy returnt early mit reason.
  //
  // Errors loggen wir, aber werfen NICHT weiter — der approval ist
  // gültig auch wenn die wallet-buchungen scheitern.
  try {
    const result = await processFlightEconomy(pirepId);
    if (result.processed) {
      console.info(
        `[approvePirep] economy processed for ${pirepId}: net=${result.summary.net.toString()} VAM$`,
      );
    } else if (result.reason !== 'airline-economy-disabled' && result.reason !== 'user-economy-disabled') {
      // Nur loggen wenn die airline/user economy aktiv haben — sonst
      // ist das normal-skip und log-noise.
      console.info(`[approvePirep] economy skipped: ${result.reason}`);
    }
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      console.error(
        `[approvePirep] economy-processing failed for ${pirepId}: airline-wallet insufficient funds (${err.message}). Approval stands; admin can retry via re-eval.`,
      );
    } else {
      console.error('[approvePirep] economy-processing failed:', err);
    }
  }

  // Bot benachrichtigen — silent failure wenn Bot offline
  try {
    // Track 4 #83 (Section P): Render airline-spezifische template-
    // overrides (falls konfiguriert), spreade in den payload. Wenn keine
    // templates gesetzt, ist overrides ein leeres objekt — bot rendert
    // den default-embed.
    const flightNumber = pirep.route?.flightNumber ?? 'PIREP';
    const route = `${pirep.departure.icao} → ${pirep.arrival.icao}`;
    const templates = parseDiscordTemplates(
      pirep.user.airline?.discordTemplates ?? null,
    );
    const overrides = renderForEvent(templates, 'pirepApproved', {
      pilot: pirep.user.name ?? 'Unbenannt',
      flightNumber,
      departure: pirep.departure.icao,
      arrival: pirep.arrival.icao,
      route,
      approver: approver.name ?? 'Unbenannt',
    });

    await emitPirepApproved({
      pirepId: pirep.id,
      flightNumber,
      pilotDiscordId: pirep.user.accounts[0]?.providerAccountId ?? null,
      pilotName: pirep.user.name ?? 'Unbenannt',
      approverName: approver.name ?? 'Unbenannt',
      approverDiscordId: null, // wird im nächsten Step befüllt wenn nötig
      departureIcao: pirep.departure.icao,
      arrivalIcao: pirep.arrival.icao,
      ...overrides,
    });
  } catch (err) {
    console.error('[approvePirep] Bot-Event fehlgeschlagen:', err);
  }

  // Track 4 #82 (Section P): Email-dispatch. Gated via user's
  // notificationPrefs (pirepDecision.email). Silent skip wenn pref off,
  // no RESEND_API_KEY, oder send fehlschlägt. Niemals throw — der approval
  // ist schon committed, email ist sekundär.
  //
  // Wir spawnen das mit `void` + .catch damit die action sofort zurück-
  // kommt — der user sieht im UI dass approval durch ist, ohne auf
  // resend's API-roundtrip (typisch 200-500ms) zu warten. Errors
  // werden vom dispatcher selbst geloggt.
  void dispatchPirepApprovedEmail({
    pirepId: pirep.id,
    userEmail: pirep.user.email,
    userName: pirep.user.name,
    userNotificationPrefs: pirep.user.notificationPrefs,
    flightNumber: pirep.route?.flightNumber ?? 'PIREP',
    departureIcao: pirep.departure.icao,
    arrivalIcao: pirep.arrival.icao,
    approverName: approver.name ?? 'Unbenannt',
  }).catch((err) =>
    console.warn('[approvePirep] email dispatch threw unexpectedly:', err),
  );

  // Track 5 #7 — Auto-grant awards. Nach jeder approval evaluieren ob
  // der pilot durch diesen flug neue criteria-awards verdient hat.
  // Async-fire-and-forget mit eigenem try/catch: ein fehlschlag im
  // award-system darf den approval-flow nicht blockieren.
  //
  // Idempotent: runAutoGrantForUser checkt ownedAwards und skippt
  // bereits vergebene. Bei race-conditions (zwei parallel-approvals
  // beider auf den gleichen threshold-flip fallen) fängt der @@unique-
  // constraint auf UserAward die zweite vergabe ab.
  //
  // Toast/notification: V1 silent grant. Pilot sieht die awards beim
  // nächsten visit auf /awards/personal. V2 könnte einen toast über
  // den dashboard-stream pushen.
  try {
    const granted = await runAutoGrantForUser(pirep.userId);
    if (granted.length > 0) {
      console.info(
        `[approvePirep] auto-granted ${granted.length} award(s) to user ${pirep.userId}: ${granted.map((g) => g.awardName).join(', ')}`,
      );
    }
  } catch (err) {
    console.error('[approvePirep] auto-grant evaluation failed:', err);
  }

  // Track 5 #10 — Evaluate pilot-goals nach approval. Idempotent
  // (skipt periods that already incremented). Fire-and-forget mit
  // try/catch — goal-eval-fehlschlag darf approval nicht blockieren.
  // Period-keys werden in UTC berechnet (V1), pilots in unterschiedlichen
  // tz könnten leicht abweichende period-boundaries erleben aber das ist
  // ok für streak-counts in der grössenordnung von wochen/monaten.
  try {
    const goalResults = await evaluatePilotGoals(pirep.userId);
    const incremented = goalResults.filter((r) => r.incrementedThisCall);
    if (incremented.length > 0) {
      console.info(
        `[approvePirep] pilot-goal streak incremented for user ${pirep.userId}: ${incremented.map((r) => `${r.kind}=${r.newStreak}`).join(', ')}`,
      );
    }
  } catch (err) {
    console.error('[approvePirep] pilot-goal evaluation failed:', err);
  }

  // Caches invalidieren
  revalidatePath('/pireps');
  revalidatePath('/pireps/pending');
  revalidatePath(`/pireps/${pirepId}`);
  revalidatePath('/dashboard');
}

/**
 * Lehnt einen PIREP ab. Nur für rollen aus APPROVER_ROLES.
 * Grund ist erforderlich.
 * Postet Bot-Event nach #pireps.
 */
export async function rejectPirep(pirepId: string, reason: string) {
  const approver = await assertCanApprove();

  if (!reason || reason.trim().length < 3) {
    throw new Error('Ablehnungsgrund muss mindestens 3 Zeichen lang sein');
  }

  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    include: {
      route: true,
      departure: true,
      arrival: true,
      aircraft: true,
      user: {
        include: {
          accounts: {
            where: { provider: 'discord' },
            select: { providerAccountId: true },
          },
          // Track 4 #83 (Section P): siehe approvePirep für details zum
          // airline-template-include.
          airline: {
            select: { discordTemplates: true },
          },
        },
      },
    },
  });

  if (!pirep) {
    throw new Error('PIREP nicht gefunden');
  }

  if (pirep.status !== 'Submitted') {
    throw new Error(`PIREP hat bereits Status: ${pirep.status}`);
  }

  await prisma.pirep.update({
    where: { id: pirepId },
    data: {
      status: 'Rejected',
      rejectedAt: new Date(),
      approvedById: approver.id,
      rejectionReason: reason.trim(),
      approvedAt: null,
    },
  });

  // Bot benachrichtigen
  try {
    // Track 4 #83 (Section P): Render airline-spezifische template-
    // overrides (falls konfiguriert). Reason wird als placeholder
    // mitgegeben damit der admin im rejected-template die begründung
    // einbauen kann (`{reason}`).
    const flightNumber = pirep.route?.flightNumber ?? 'PIREP';
    const route = `${pirep.departure.icao} → ${pirep.arrival.icao}`;
    const templates = parseDiscordTemplates(
      pirep.user.airline?.discordTemplates ?? null,
    );
    const overrides = renderForEvent(templates, 'pirepRejected', {
      pilot: pirep.user.name ?? 'Unbenannt',
      flightNumber,
      departure: pirep.departure.icao,
      arrival: pirep.arrival.icao,
      route,
      approver: approver.name ?? 'Unbenannt',
      reason: reason.trim(),
    });

    await emitPirepRejected({
      pirepId: pirep.id,
      flightNumber,
      pilotDiscordId: pirep.user.accounts[0]?.providerAccountId ?? null,
      pilotName: pirep.user.name ?? 'Unbenannt',
      approverName: approver.name ?? 'Unbenannt',
      approverDiscordId: null,
      departureIcao: pirep.departure.icao,
      arrivalIcao: pirep.arrival.icao,
      reason: reason.trim(),
      ...overrides,
    });
  } catch (err) {
    console.error('[rejectPirep] Bot-Event fehlgeschlagen:', err);
  }

  // Track 4 #82 (Section P): Email-dispatch — siehe approvePirep für
  // den vollen kommentar zur void+catch-strategie + silent-skip-gating.
  // Reason wird mit übergeben weil das rejected-template eine begründung
  // im body anzeigt.
  void dispatchPirepRejectedEmail({
    pirepId: pirep.id,
    userEmail: pirep.user.email,
    userName: pirep.user.name,
    userNotificationPrefs: pirep.user.notificationPrefs,
    flightNumber: pirep.route?.flightNumber ?? 'PIREP',
    departureIcao: pirep.departure.icao,
    arrivalIcao: pirep.arrival.icao,
    approverName: approver.name ?? 'Unbenannt',
    reason: reason.trim(),
  }).catch((err) =>
    console.warn('[rejectPirep] email dispatch threw unexpectedly:', err),
  );

  revalidatePath('/pireps');
  revalidatePath('/pireps/pending');
  revalidatePath(`/pireps/${pirepId}`);
  revalidatePath('/dashboard');
}

// ─────────────────────────────────────────────────────────────────────────
// Draft PIREP Actions (option #19 — Edit-Before-Submit)
//
// The auto-PIREP path now lands in PirepStatus.Draft (see
// generate-pirep.ts and auto-pirep.ts). The pilot reviews the splice-
// generated remarks and metric values via /pireps/[id], optionally
// edits them, then promotes the PIREP to Submitted via
// submitDraftPirep — that's the transition that fires emitPirepSubmitted
// (Discord broadcast) and evaluatePromotion (rank check).
//
// Three actions:
//   - updateDraftPirep:   pilot edits remarks / flight-time / fuel /
//                         landing-rate. Stays Draft.
//   - submitDraftPirep:   Draft → Submitted, fires side-channels, this
//                         is the canonical "publish" gesture.
//   - discardDraftPirep:  pilot deletes the auto-generated draft,
//                         e.g. flight was a botched session. Removes
//                         the Pirep row, restores the booking state if
//                         the PIREP closed one out, restores user totals.
//                         Has cascading consequences — only allowed for
//                         the OWNING pilot, only on Draft.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Server-side guard for Draft actions: the pilot must be the owner
 * of the PIREP (auto-PIREP attribution = the user whose ACARS-session
 * BLOCK_ON'd). Returns the loaded PIREP with the relations the actions
 * need so each action doesn't have to re-fetch.
 *
 * Authorization is owner-only. Approvers don't get to edit/submit a
 * pilot's draft — that would short-circuit the whole point of the
 * Draft state. If a pilot abandons a draft and an admin wants to
 * clean up, the admin can use the existing rejectPirep flow once
 * it's Submitted (which means the pilot would first have to submit
 * it — but if they never do, the draft just sits there. v2 could
 * add a TTL-cron that auto-submits drafts older than 24h.)
 */
async function loadDraftAsOwner(pirepId: string) {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    include: {
      route: true,
      departure: true,
      arrival: true,
      aircraft: true,
      user: {
        select: { id: true, name: true, discordId: true },
      },
      booking: {
        select: { id: true, state: true, legCount: true, legsCompleted: true },
      },
    },
  });

  if (!pirep) {
    throw new Error('PIREP nicht gefunden');
  }
  if (pirep.userId !== session.user.id) {
    // Owner-only: even airline-admins can't poke other pilots' drafts.
    throw new Error('Nur der einreichende Pilot kann diesen Draft bearbeiten');
  }
  if (pirep.status !== 'Draft') {
    throw new Error(
      `PIREP ist nicht im Draft-Status (aktuell: ${pirep.status}) — eine Änderung ist nicht mehr möglich`,
    );
  }

  return pirep;
}

/**
 * Update a Draft's editable fields. The pilot can edit:
 *   - remarks: free text, often used to remove the [ACARS-flag]/
 *     [Replay-flag] prefixes the auto-generator spliced in when
 *     the pilot has a legitimate explanation (e.g. "sim-rate flag
 *     was a glitch, real flight was 1.0x").
 *   - flightTimeMin: server-derived block-to-block can be off when
 *     the BLOCK_OFF/BLOCK_ON detection misfired; pilot can correct.
 *   - fuelUsedKg: optional, ACARS may not have captured it.
 *   - landingRateFpm: optional, TOUCHDOWN event might have been
 *     missed (touch-and-go before final landing).
 *
 * Anything else stays as the auto-generator wrote it: route,
 * departure, arrival, aircraft, network, flightType. Those are
 * derived from the LiveSession + booking-match and changing them
 * would invalidate the Discord embed enrichment + economy attribution
 * — out of scope for option #19.
 *
 * Validation:
 *   - remarks: max 5000 chars (Pirep.remarks is text, but a text-area
 *     this big indicates the pilot is writing a novel, not a debrief).
 *   - flightTimeMin: must be > 0 if provided. null is allowed (clear).
 *   - fuelUsedKg: must be >= 0 if provided. null clears.
 *   - landingRateFpm: any int. Negative = sink-rate at touchdown,
 *     positive = climb (e.g. touch-and-go followed by go-around).
 */
export async function updateDraftPirep(
  pirepId: string,
  input: {
    remarks?: string | null;
    flightTimeMin?: number | null;
    fuelUsedKg?: number | null;
    landingRateFpm?: number | null;
  },
) {
  await loadDraftAsOwner(pirepId);

  // Trim + length-guard remarks. Empty string → null (consistent with
  // schema's nullable remarks-column; UI doesn't differentiate "no
  // remarks" from "empty remarks", and storing "" muddles count-of-
  // pireps-with-remarks queries).
  const trimmed = input.remarks?.trim() ?? null;
  const remarks = trimmed === '' ? null : trimmed;
  if (remarks !== null && remarks.length > 5000) {
    throw new Error('Remarks dürfen maximal 5000 Zeichen lang sein');
  }

  // Numeric-field guards. We accept undefined (no change) vs. null
  // (clear the value) vs. number (set). The server-action contract
  // on the form-side passes undefined for "field not in form" and
  // null for "field cleared explicitly", so the prisma update only
  // touches keys the pilot actually changed.
  if (
    input.flightTimeMin !== undefined &&
    input.flightTimeMin !== null &&
    input.flightTimeMin <= 0
  ) {
    throw new Error('Flugzeit muss größer als 0 sein');
  }
  if (
    input.fuelUsedKg !== undefined &&
    input.fuelUsedKg !== null &&
    input.fuelUsedKg < 0
  ) {
    throw new Error('Treibstoff darf nicht negativ sein');
  }

  const data: Prisma.PirepUpdateInput = {};
  if (input.remarks !== undefined) data.remarks = remarks;
  if (input.flightTimeMin !== undefined) data.flightTimeMin = input.flightTimeMin;
  if (input.fuelUsedKg !== undefined) data.fuelUsedKg = input.fuelUsedKg;
  if (input.landingRateFpm !== undefined) data.landingRateFpm = input.landingRateFpm;

  // Empty patch = no-op. Avoids a useless write + revalidatePath.
  if (Object.keys(data).length === 0) {
    return;
  }

  await prisma.pirep.update({
    where: { id: pirepId },
    data,
  });

  revalidatePath(`/pireps/${pirepId}`);
}

/**
 * Promote a Draft to Submitted. This is the gesture that publishes
 * the PIREP — Discord broadcast (#pireps embed), rank-promotion
 * evaluation, admin-queue inclusion all flow from here.
 *
 * Atomic: status update + side-channel dispatch. Status update is
 * a single SQL statement; side-channels are best-effort fire-and-
 * forget (matching the M6 contract — bot-down or rank-evaluator
 * crash should NOT block the publish). The side-channels read the
 * fresh-Submitted PIREP via the IDs we have in scope; even if they
 * fail, the PIREP is published (it's the source-of-truth row, not
 * the Discord-embed copy).
 *
 * submittedAt is NOT touched. The Pirep.submittedAt column was set
 * to NOW() at Draft creation time (default @default(now())) and
 * represents "when did the auto-generator file this", which is
 * still meaningful as a flight-end-timestamp. If the pilot sits on
 * a Draft for hours and submits late, that's their choice — the
 * submitted-at-timestamp shouldn't lie about when the actual flight
 * landed. v2 could add a separate publishedAt column if the
 * distinction becomes important; not in v1.
 */
export async function submitDraftPirep(pirepId: string) {
  const pirep = await loadDraftAsOwner(pirepId);

  // Single update — no transaction needed because there's only one
  // mutation. Side-channels fire AFTER commit (read-your-writes:
  // emitPirepSubmitted is the bot-side notification; if we fired
  // pre-commit and the update threw, the bot would see a phantom
  // PIREP that doesn't exist).
  await prisma.pirep.update({
    where: { id: pirepId },
    data: { status: 'Submitted' },
  });

  // Side-channels — fire-and-forget, mirrors the M6 contract that
  // moved here from auto-pirep.ts. Use void + .catch so a Discord
  // outage doesn't make a successfully-submitted PIREP look failed
  // in the action's return.
  //
  // Why we send a basic embed-payload: at submit time we don't have
  // the option-#17 enrichment fields (aircraftTitle from LiveSession,
  // hasHardLanding from INCIDENT-event) re-fetched. The Pirep row
  // alone gives us most of what the bot needs; if we want full
  // option-#17 richness on the Submit-side too, a v2 task can pull
  // the LiveSession + AcarsEvent rows by following the
  // triggeredPirepId backlink. For v1, basic embed > no embed > full
  // re-fetch latency.
  const flightNumber = pirep.route?.flightNumber ?? 'PIREP';
  void emitPirepSubmitted({
    pirepId: pirep.id,
    userId: pirep.userId,
    flightNumber,
    departureIcao: pirep.departure.icao,
    arrivalIcao: pirep.arrival.icao,
    flightTimeMin: pirep.flightTimeMin ?? 0,
    aircraftRegistration: pirep.aircraft?.registration ?? null,
    remarks: pirep.remarks,
    pilotName: pirep.user.name,
    aircraftType: pirep.aircraft?.type ?? null,
    aircraftTitle: null,
    landingRateFpm: pirep.landingRateFpm,
    fuelUsedKg: pirep.fuelUsedKg,
    network: pirep.network,
    hasHardLanding: false,
    incidentSeverity: null,
  }).catch((err) =>
    console.warn('[submitDraftPirep] emitPirepSubmitted failed:', err),
  );

  void evaluatePromotion(pirep.userId).catch((err) =>
    console.warn('[submitDraftPirep] evaluatePromotion failed:', err),
  );

  revalidatePath('/pireps');
  revalidatePath('/pireps/pending');
  revalidatePath(`/pireps/${pirepId}`);
  revalidatePath('/dashboard');
}

/**
 * Discard a Draft entirely. The PIREP row is deleted, user totals
 * (totalFlightHours + totalFlights) are decremented, and any
 * matching booking is rolled back to its previous state.
 *
 * This is the escape hatch for "the auto-generator filed a Draft
 * for what was actually a sim-crash / test-flight / wrong-session".
 * Without this, the pilot would have to submit a junk PIREP and
 * then have an admin reject it — which clutters the rejected-PIREP
 * audit-log with stuff that was never a real flight intent.
 *
 * Booking rollback semantics:
 *   - Single-leg booking (legCount=1): the auto-PIREP path moved
 *     the booking from Created/SimBriefDispatched to Completed
 *     and incremented legsCompleted to 1. Rollback: decrement
 *     legsCompleted to 0, set state to Created (the conservative
 *     fallback — we don't know if SimBrief was used). The user
 *     can re-fly and the booking will find a fresh auto-PIREP.
 *
 *   - Multi-leg booking (legCount>1): legsCompleted was bumped
 *     and state was either Completed (if final leg) or
 *     InProgress (mid-tour). Rollback: decrement legsCompleted,
 *     and if the new value is 0 set state to Created (no legs
 *     done yet) else set to InProgress (still mid-tour).
 *
 * We do NOT restore the FlightPlanCache association — it stays
 * pointing at the (now-deleted) Pirep id since we use SetNull on
 * cascade. The cache row is orphaned, but expires naturally via
 * the FlightPlanCache.expiresAt TTL. v2 could re-link it to the
 * booking; not worth the complexity for v1.
 *
 * User totals decrement is unconditional — the auto-PIREP
 * incremented them at Draft-create time and we'd be lying about
 * the user's totals if we left a phantom flight in their counter.
 */
export async function discardDraftPirep(pirepId: string) {
  const pirep = await loadDraftAsOwner(pirepId);

  await prisma.$transaction(async (tx) => {
    // Decrement user totals. Mirrors the increment at Draft-create
    // time in generate-pirep.ts. Use the actual flightTimeMin from
    // the row (not the input) because the pilot may have edited it
    // via updateDraftPirep before discarding.
    const flightHoursToReverse = (pirep.flightTimeMin ?? 0) / 60;
    await tx.user.update({
      where: { id: pirep.userId },
      data: {
        totalFlightHours: { decrement: flightHoursToReverse },
        totalFlights: { decrement: 1 },
      },
    });

    // Booking rollback — only if the Draft closed out a booking.
    // We have booking.legCount + legsCompleted from the loadDraft
    // helper, so we can compute the correct restoration without
    // re-fetching.
    if (pirep.booking) {
      const newLegsCompleted = Math.max(0, pirep.booking.legsCompleted - 1);
      // State: if all legs would be 0, restore to Created (clean
      // booking, ready for a fresh attempt). Otherwise the tour
      // continues with one fewer leg done — InProgress.
      const newState = newLegsCompleted === 0 ? 'Created' : 'InProgress';
      await tx.booking.update({
        where: { id: pirep.booking.id },
        data: {
          legsCompleted: newLegsCompleted,
          state: newState,
        },
      });
    }

    // Finally, delete the Draft. Cascading: AcarsEvent.triggeredPirepId
    // becomes null (SetNull), FlightPlanCache.pirepId becomes null
    // (SetNull, cache row orphaned but TTL-expirable), Transaction.pirepId
    // becomes null (SetNull, no economy was processed for a Draft
    // anyway since processFlightEconomy gates on status=Approved).
    await tx.pirep.delete({
      where: { id: pirepId },
    });
  });

  revalidatePath('/pireps');
  revalidatePath('/dashboard');

  // Caller redirects to /pireps after this returns. We don't redirect
  // here because returning a redirect-result from a Server-Action
  // requires `redirect()` which throws NEXT_REDIRECT — fine, but we
  // want the form-handler in the page to be in control of the
  // redirect target (e.g. /pireps with a toast hint).
}

/**
 * Track 4 #60 (Section L): Kudos-toggle für einen PIREP.
 *
 * Idempotenter toggle:
 *   - User hat noch keinen kudos für diesen PIREP → INSERT, return given=true
 *   - User hat schon einen kudos → DELETE, return given=false
 *
 * Self-kudos-block: pilot kann NICHT sich selbst kudos geben. Wir checken
 * das hier in der action (nicht im schema) damit die error-message
 * verständlich ist und nicht ein generic constraint-violation aus DB.
 *
 * Beide branches revalidieren den PIREP-detail-pfad damit der UI-state
 * (count + isOwn) frisch geladen wird.
 *
 * Race-condition: zwei gleichzeitige toggle-calls könnten theoretisch
 * race'n und beide entweder INSERT oder beide DELETE versuchen. INSERT-
 * race wird durch @@unique([pirepId, userId]) als P2002 abgefangen — wir
 * fangen den fall ab und treat das als \"war schon\". DELETE-race ist
 * harmlos (zweiter delete betrifft 0 rows).
 *
 * Return shape: { given: boolean, count: number } — UI kann optimistisch
 * den state setzen, aber bekommt die authoritative count zurück damit
 * die anzeige stimmt.
 */
export async function togglePirepKudos(
  pirepId: string,
): Promise<{ given: boolean; count: number }> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Nicht eingeloggt.');
  }
  const userId = session.user.id;

  // Resolve PIREP-owner für self-kudos-check. Bewusst kein .findUniqueOrThrow —
  // wenn pirep nicht existiert, wollen wir eine klare error-message.
  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    select: { userId: true },
  });
  if (!pirep) {
    throw new Error('PIREP nicht gefunden.');
  }
  if (pirep.userId === userId) {
    throw new Error('Du kannst dir nicht selbst einen Kudos geben.');
  }

  // Existing-check via unique-index. Falls vorhanden → DELETE (toggle off),
  // sonst INSERT (toggle on). Wir nutzen das @@unique constraint via
  // findUnique({ where: { pirepId_userId } }).
  const existing = await prisma.pirepKudos.findUnique({
    where: { pirepId_userId: { pirepId, userId } },
    select: { id: true },
  });

  let given: boolean;
  if (existing) {
    await prisma.pirepKudos.delete({ where: { id: existing.id } });
    given = false;
  } else {
    try {
      await prisma.pirepKudos.create({ data: { pirepId, userId } });
      given = true;
    } catch (e) {
      // P2002 = unique-constraint violation (race-condition: someone
      // else's INSERT landed between our findUnique and create). Treat
      // als \"war schon gegeben\".
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        given = true;
      } else {
        throw e;
      }
    }
  }

  // Fresh count nach mutation. Bewusst nach dem toggle weil die UI dann
  // den authoritative wert hat ohne dass wir einen 2. round-trip vom
  // client brauchen.
  const count = await prisma.pirepKudos.count({ where: { pirepId } });

  revalidatePath(`/pireps/${pirepId}`);

  return { given, count };
}