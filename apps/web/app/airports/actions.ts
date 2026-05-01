'use server';

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  fetchAirportDb,
  isAirportDbEnabled,
  mapAirportDbFrequencies,
  mapAirportDbNavaids,
  mapAirportDbRunways,
} from '@/lib/external-api/airportdb';

// ───── Permission Gates ─────

/**
 * Airline-admin gate. Submit/withdraw operations require an admin user
 * with an airline assignment. Pilots cannot propose airports.
 */
async function requireAirlineAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || user.role.name !== 'admin') {
    throw new Error('forbidden');
  }
  if (!user.airlineId) {
    throw new Error('no-airline');
  }

  return { user, airlineId: user.airlineId };
}

/**
 * System-admin gate. Approve/reject operations.
 *
 * Phase 1 single-tenant simplification: same as airline-admin (role='admin').
 * Phase 2+ when multi-tenancy lands: a separate 'system_admin' role or
 * User.isSystemAdmin boolean will gate this — system-admin can approve
 * across airlines, airline-admin should NOT be able to approve their own
 * proposals.
 *
 * TODO Phase 2: replace with proper system-admin distinction when there are
 * multiple airlines.
 */
async function requireSystemAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || user.role.name !== 'admin') {
    throw new Error('forbidden');
  }

  return { user };
}

// ───── Validation Schemas ─────

// Airport-Daten — gleiches Format wie Airport-table-fields. Wird sowohl beim
// Submit (Request anlegen) als auch beim Approve mit Edits verwendet.
const AirportDataSchema = z.object({
  icao: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4}$/, 'ICAO must be exactly 4 letters/digits'),
  iata: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3}$/, 'IATA must be exactly 3 letters/digits')
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
  name: z.string().trim().min(1).max(100),
  city: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
  country: z.string().trim().min(1).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  elevation: z.number().int().nullable().optional(),
});

const SubmitAirportRequestSchema = AirportDataSchema.extend({
  reason: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
});

export type SubmitAirportRequestInput = z.input<typeof SubmitAirportRequestSchema>;

const ApproveAirportRequestSchema = z.object({
  requestId: z.string().min(1),
  asVerified: z.boolean(),
  // Optional edits to the proposed data — system-admin can correct typos
  // before approving. If omitted, the request data is used verbatim.
  edits: AirportDataSchema.partial().nullable().optional(),
  reviewerNotes: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
});

export type ApproveAirportRequestInput = z.input<typeof ApproveAirportRequestSchema>;

// ───── Submit ─────

/**
 * Airline-admin proposes a new airport. Creates an AirportRequest row in
 * Submitted status. System-admin must approve before it becomes a real
 * Airport.
 *
 * Duplicate-detection: rejects if ICAO already exists in Airport table OR
 * in an open (Submitted/UnderReview) AirportRequest. Approved/Rejected
 * requests don't block re-submission (e.g. user can re-submit after a
 * rejection with corrected data).
 */
export async function submitAirportRequest(input: SubmitAirportRequestInput) {
  const { user, airlineId } = await requireAirlineAdmin();
  const data = SubmitAirportRequestSchema.parse(input);

  // Duplicate check: ICAO already in Airport table?
  const existingAirport = await prisma.airport.findUnique({
    where: { icao: data.icao },
    select: { id: true, name: true, verified: true },
  });
  if (existingAirport) {
    throw new Error(
      `Airport ${data.icao} (${existingAirport.name}) existiert bereits${
        existingAirport.verified ? '' : ' (unverified)'
      }`,
    );
  }

  // Duplicate check: open request for same ICAO?
  const existingOpenRequest = await prisma.airportRequest.findFirst({
    where: {
      icao: data.icao,
      status: { in: ['Submitted', 'UnderReview'] },
    },
    select: { id: true, requestedById: true, submittedAt: true },
  });
  if (existingOpenRequest) {
    const ownLabel = existingOpenRequest.requestedById === user.id ? ' (deiner)' : '';
    throw new Error(
      `Es gibt bereits einen offenen Request für ${data.icao}${ownLabel} vom ` +
        `${existingOpenRequest.submittedAt.toISOString().slice(0, 10)}`,
    );
  }

  const request = await prisma.airportRequest.create({
    data: {
      icao: data.icao,
      iata: data.iata ?? null,
      name: data.name,
      city: data.city ?? null,
      country: data.country,
      latitude: data.latitude,
      longitude: data.longitude,
      elevation: data.elevation ?? null,
      reason: data.reason ?? null,
      requestedById: user.id,
      requestedAirlineId: airlineId,
      status: 'Submitted',
    },
  });

  revalidatePath('/airports');
  revalidatePath('/admin/requests');

  return { id: request.id };
}

// ───── Withdraw (Self-Reject) ─────

/**
 * Airline-admin zieht einen eigenen offenen Request zurück. Setzt status
 * auf Rejected mit selbst-angegebenem Grund "withdrawn by submitter".
 * Nur für Submitted/UnderReview — Approved/Rejected sind terminal.
 */
export async function withdrawAirportRequest(requestId: string) {
  const { user } = await requireAirlineAdmin();

  const request = await prisma.airportRequest.findUnique({
    where: { id: requestId },
    select: { id: true, requestedById: true, status: true },
  });
  if (!request) throw new Error('Request nicht gefunden');
  if (request.requestedById !== user.id) {
    throw new Error('Du kannst nur eigene Requests zurückziehen');
  }
  if (request.status !== 'Submitted' && request.status !== 'UnderReview') {
    throw new Error(`Request hat bereits Status: ${request.status}`);
  }

  await prisma.airportRequest.update({
    where: { id: requestId },
    data: {
      status: 'Rejected',
      reviewedAt: new Date(),
      reviewedById: user.id,
      rejectionReason: 'withdrawn by submitter',
    },
  });

  revalidatePath('/airports');
  revalidatePath('/admin/requests');
}

// ───── Approve ─────

/**
 * System-admin genehmigt einen AirportRequest. Erzeugt eine Airport-row
 * (verified=asVerified) und linkt sie via proposedFromRequestId zurück.
 * Setzt request.status auf Approved.
 *
 * asVerified=true → Airport wird sofort als "system-curated" markiert (kein
 * warning-badge im UI). asVerified=false → Airport ist sichtbar/usable aber
 * mit "unverified — daten nicht system-geprüft"-warning. Letzteres ist der
 * fast-track für plausible aber unverifizierte requests.
 *
 * Atomicity: Airport-create + Request-update in einer Transaktion. Wenn
 * eines fehlschlägt (z.B. ICAO-collision während approval), wird gar nichts
 * geschrieben.
 */
export async function approveAirportRequest(input: ApproveAirportRequestInput) {
  const { user: approver } = await requireSystemAdmin();
  const { requestId, asVerified, edits, reviewerNotes } =
    ApproveAirportRequestSchema.parse(input);

  const request = await prisma.airportRequest.findUnique({
    where: { id: requestId },
  });
  if (!request) throw new Error('Request nicht gefunden');
  if (request.status === 'Approved' || request.status === 'Rejected') {
    throw new Error(`Request ist bereits terminal: ${request.status}`);
  }

  // Effective data = request data overlaid with admin edits (if any)
  const effective = {
    icao: edits?.icao ?? request.icao,
    iata: edits?.iata !== undefined ? edits.iata : request.iata,
    name: edits?.name ?? request.name,
    city: edits?.city !== undefined ? edits.city : request.city,
    country: edits?.country ?? request.country,
    latitude: edits?.latitude ?? request.latitude,
    longitude: edits?.longitude ?? request.longitude,
    elevation:
      edits?.elevation !== undefined ? edits.elevation : request.elevation,
  };

  // Re-check ICAO collision at approve-time (defense against race where
  // another request was approved with same ICAO between submit and approve).
  const collision = await prisma.airport.findUnique({
    where: { icao: effective.icao },
    select: { id: true, name: true },
  });
  if (collision) {
    throw new Error(
      `Airport ${effective.icao} (${collision.name}) existiert bereits — ` +
        `bitte Request rejecten statt approven`,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const airport = await tx.airport.create({
      data: {
        icao: effective.icao,
        iata: effective.iata,
        name: effective.name,
        city: effective.city,
        country: effective.country,
        latitude: effective.latitude,
        longitude: effective.longitude,
        elevation: effective.elevation,
        verified: asVerified,
        verifiedAt: asVerified ? new Date() : null,
        verifiedById: asVerified ? approver.id : null,
        proposedFromRequestId: request.id,
      },
    });

    await tx.airportRequest.update({
      where: { id: request.id },
      data: {
        status: 'Approved',
        reviewedAt: new Date(),
        reviewedById: approver.id,
        reviewerNotes: reviewerNotes ?? null,
        approvedAsVerified: asVerified,
      },
    });

    return airport;
  });

  // ───── AirportDB.io fallback-enrichment ─────
  //
  // Pfad C: Wenn der approved airport NICHT in OurAirports war (also keine
  // runway/freq/navaid records existieren), versuchen wir das hobby-service
  // AirportDB.io als fallback. Best-effort: errors loggen, aber nicht die
  // approval scheitern lassen — der admin hat ja bereits zugestimmt.
  //
  // Idempotent: wenn das script später nochmal läuft (z.B. zweiter approve-
  // versuch nach race), würden wir die selben records nochmal anlegen ohne
  // unique-key. Daher nur ausführen wenn die detail-tabellen LEER sind für
  // diese ICAO.
  await tryEnrichFromAirportDb(result.icao).catch((err) => {
    console.warn(
      `[airportdb] Enrichment failed for ${result.icao} but approval already committed:`,
      err instanceof Error ? err.message : err,
    );
  });

  revalidatePath('/airports');
  revalidatePath('/admin/requests');
  revalidatePath('/admin/airports');

  return { airportId: result.id, icao: result.icao };
}

/**
 * AirportDB.io fallback-enrichment für einen frisch-approveten airport.
 *
 * Logik:
 *   1. Skip wenn AIRPORTDB_API_TOKEN unset — graceful degradation
 *   2. Skip wenn airport schon detail-records hat (war in OurAirports)
 *   3. Fetch von AirportDB.io. Bei null (404/error) → silent skip
 *   4. Insert mapped runways/frequencies/navaids in einer transaction
 *
 * Nur best-effort — errors werden geloggt aber propagiert nicht. Caller
 * sollte den await mit .catch() einhüllen oder als fire-and-forget callen.
 */
async function tryEnrichFromAirportDb(icao: string): Promise<void> {
  if (!isAirportDbEnabled()) return;

  // Hat der airport schon detail-records? Wenn ja, war er in OurAirports
  // und wir brauchen kein external enrichment. Single-query check:
  const [runwayCount, freqCount] = await Promise.all([
    prisma.runway.count({ where: { airportIcao: icao } }),
    prisma.airportFrequency.count({ where: { airportIcao: icao } }),
  ]);
  if (runwayCount > 0 || freqCount > 0) {
    console.info(
      `[airportdb] Skipping enrichment for ${icao} — already has details ` +
        `(${runwayCount} runways, ${freqCount} freqs from OurAirports)`,
    );
    return;
  }

  console.info(`[airportdb] Fetching enrichment for ${icao}...`);
  const data = await fetchAirportDb(icao);
  if (!data) return; // Network error, 404, or token-disabled — silent

  // Mappe response → Prisma create-shapes
  const runways = mapAirportDbRunways(data.runways);
  // AirportDB.io könnte entweder `freqs` oder `frequencies` als key nutzen
  const freqs = mapAirportDbFrequencies(data.freqs ?? data.frequencies);
  const navaids = mapAirportDbNavaids(data.navaids);

  if (runways.length === 0 && freqs.length === 0 && navaids.length === 0) {
    console.info(`[airportdb] ${icao} response had no detail data — skip insert`);
    return;
  }

  // Bulk-insert in transaction. Keine ourAirportsId (kommen ja von
  // AirportDB.io) — daher nutzen wir die nullable-id-migration.
  await prisma.$transaction([
    ...(runways.length > 0
      ? [
          prisma.runway.createMany({
            data: runways.map((r) => ({ ...r, airportIcao: icao })),
          }),
        ]
      : []),
    ...(freqs.length > 0
      ? [
          prisma.airportFrequency.createMany({
            data: freqs.map((f) => ({ ...f, airportIcao: icao })),
          }),
        ]
      : []),
    ...(navaids.length > 0
      ? [
          prisma.navaid.createMany({
            data: navaids.map((n) => ({
              ...n,
              associatedAirportIcao: icao,
            })),
          }),
        ]
      : []),
  ]);

  console.info(
    `[airportdb] ✓ Enriched ${icao}: ${runways.length} runways, ` +
      `${freqs.length} freqs, ${navaids.length} navaids`,
  );
}

// ───── Reject ─────

/**
 * System-admin lehnt einen AirportRequest ab. rejectionReason ist Pflicht
 * — der submitter sieht ihn im UI und kann ggf. korrigiert re-submitten.
 */
export async function rejectAirportRequest(
  requestId: string,
  rejectionReason: string,
) {
  const { user: reviewer } = await requireSystemAdmin();

  const reason = z
    .string()
    .trim()
    .min(1, 'Begründung erforderlich')
    .max(500)
    .parse(rejectionReason);

  const request = await prisma.airportRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true },
  });
  if (!request) throw new Error('Request nicht gefunden');
  if (request.status === 'Approved' || request.status === 'Rejected') {
    throw new Error(`Request ist bereits terminal: ${request.status}`);
  }

  await prisma.airportRequest.update({
    where: { id: requestId },
    data: {
      status: 'Rejected',
      reviewedAt: new Date(),
      reviewedById: reviewer.id,
      rejectionReason: reason,
    },
  });

  revalidatePath('/airports');
  revalidatePath('/admin/requests');
}
