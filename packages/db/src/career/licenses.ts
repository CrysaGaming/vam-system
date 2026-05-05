/**
 * License-helpers für Welle 13E Career-System.
 *
 * Was hier rein gehört:
 *   - grantLicense    — issue eine neue PilotLicense
 *   - revokeLicense   — disciplinary, status → REVOKED (mit reason)
 *   - suspendLicense  — temporäre suspension, status → SUSPENDED
 *   - reinstateLicense — SUSPENDED/EXPIRED → ACTIVE (nach renewal)
 *   - expireLicenses  — bulk-update aller licenses deren expiresAt überschritten ist
 *   - getUserLicenses — alle licenses eines users (incl. nicht-active)
 *   - getActiveLicenses — nur ACTIVE-status
 *   - hasLicense — quick-check für canPilotFlyAircraft
 *   - generateCertificateNumber — "VAM-{TYPE}-{YYYY}-{6digits}" deterministic
 *
 * Was NICHT hier rein gehört:
 *   - Type-ratings (siehe ./type-ratings.ts) — separates concept
 *   - Booking-gate-logik (siehe ./can-fly.ts) — composite über licenses + ratings
 *   - Aircraft-requirements lookup (siehe ./requirements.ts)
 *
 * Sicherheits-prinzip:
 *   PilotLicense rows werden NIE physisch gelöscht (auch nicht bei revoke).
 *   Status-änderung ist die canonical-action. Audit-trail bleibt erhalten —
 *   ein nachträglicher dispute über eine REVOKED-license soll die history
 *   sichtbar haben. user-deletion ist die einzige cascade die einen
 *   PilotLicense-row entfernt (Cascade auf userId), und bei einer user-
 *   deletion ist der audit-trail bereits anderweitig verloren.
 *
 * Convention: alle helpers akzeptieren optional einen `db: DbClient`-
 * parameter für composition mit outer-transactions (z.B. flight-school-
 * completion-flow in 13E-12: erstellt PilotLicense + closing FlightSchool-
 * Enrollment in einer einzigen transaction). Default ist der globale
 * prisma-client.
 */

import {
  Prisma,
  type PilotLicense,
  type LicenseType,
  type LicenseStatus,
} from "@prisma/client";
import { prisma } from "../index.js";
import type { DbClient } from "../economy/wallet.js";

// ─────────────────────────────────────────────────────────────────────────
// generateCertificateNumber
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generiert einen unique certificate-number nach dem VAM-format
 * "VAM-{TYPE}-{YYYY}-{6digits}".
 *
 * Beispiele:
 *   VAM-PPL-2026-000147
 *   VAM-ATPL-2026-002384
 *   VAM-IR-2026-000891
 *
 * Algorithmus:
 *   1. Zähle existing licenses des typs im current-year.
 *   2. sequence = count + 1, gepaddet auf 6 stellen.
 *   3. type-string ist enum-name, ersetze underscores durch nichts:
 *        INSTRUMENT_RATING → INSTRUMENTRATING (zu lang) — wir nehmen die
 *        kurzform aus der bekannten map. Falls type unbekannt → enum-name
 *        as-is.
 *
 * Race-condition: zwei concurrent grants im selben year-type könnten
 * dieselbe sequence kriegen. Das @unique constraint auf certificateNumber
 * im schema fängt das ab — der zweite insert failed mit P2002, caller
 * kann retry'en. In der praxis (low-throughput VA) extrem unwahrscheinlich.
 */
const LICENSE_TYPE_SHORT: Record<LicenseType, string> = {
  SPL: "SPL",
  PPL: "PPL",
  NIGHT_RATING: "NR",
  INSTRUMENT_RATING: "IR",
  MULTI_ENGINE_RATING: "ME",
  CPL: "CPL",
  MCC: "MCC",
  ATPL: "ATPL",
  TRI: "TRI",
  TRE: "TRE",
};

export async function generateCertificateNumber(
  type: LicenseType,
  db: DbClient = prisma,
): Promise<string> {
  const year = new Date().getFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  const count = await db.pilotLicense.count({
    where: {
      type,
      issuedAt: { gte: yearStart, lt: yearEnd },
    },
  });

  const sequence = (count + 1).toString().padStart(6, "0");
  const typeShort = LICENSE_TYPE_SHORT[type];
  return `VAM-${typeShort}-${year}-${sequence}`;
}

// ─────────────────────────────────────────────────────────────────────────
// grantLicense
// ─────────────────────────────────────────────────────────────────────────

export interface GrantLicenseInput {
  userId: string;
  type: LicenseType;
  /** Falls weggelassen: jetzt. */
  issuedAt?: Date;
  /** Falls weggelassen: keine expiry (most basic-licenses). */
  expiresAt?: Date | null;
  /** Default "VAM-Internal". */
  issuingAuthority?: string;
  /** Falls weggelassen: auto-generiert via generateCertificateNumber. */
  certificateNumber?: string;
  /** Audit-trail: wer hat ausgestellt. NULL für system-issued (z.B. exam-pass). */
  issuedById?: string | null;
  /** Optional notes. */
  notes?: string | null;
}

/**
 * Stellt eine neue license aus.
 *
 * Idempotency: WENN bereits eine license dieses (userId, type) existiert,
 * wird ein P2002-error geworfen (composite-unique-constraint). Caller
 * sollte zuerst getActiveLicenses + check oder hasLicense aufrufen wenn
 * idempotent-grant gewünscht ist.
 *
 * Failure-modes:
 *   - P2002 (userId, type) — license existiert schon
 *   - P2002 (certificateNumber) — sequence-race-condition (extrem rare)
 */
export async function grantLicense(
  input: GrantLicenseInput,
  db: DbClient = prisma,
): Promise<PilotLicense> {
  const issuedAt = input.issuedAt ?? new Date();
  const certificateNumber =
    input.certificateNumber ?? (await generateCertificateNumber(input.type, db));

  return db.pilotLicense.create({
    data: {
      userId: input.userId,
      type: input.type,
      issuedAt,
      expiresAt: input.expiresAt ?? null,
      issuingAuthority: input.issuingAuthority ?? "VAM-Internal",
      certificateNumber,
      status: "ACTIVE",
      issuedById: input.issuedById ?? null,
      notes: input.notes ?? null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// revokeLicense / suspendLicense / reinstateLicense
// ─────────────────────────────────────────────────────────────────────────

export interface RevokeLicenseInput {
  /** License-id. */
  id: string;
  /** Required für audit-trail. Wird in `notes` appended. */
  reason: string;
  /** Wer revoked. NULL für system-revoke (auto-expire-cron etc). */
  revokedById?: string | null;
}

/**
 * Setzt status → REVOKED. Disciplinary-action.
 * Reason wird mit timestamp + admin-id in notes appended (existing notes
 * bleiben erhalten — wir override'n nicht den ganzen notes-text).
 *
 * Failure-modes:
 *   - P2025 — license nicht gefunden
 */
export async function revokeLicense(
  input: RevokeLicenseInput,
  db: DbClient = prisma,
): Promise<PilotLicense> {
  const license = await db.pilotLicense.findUniqueOrThrow({ where: { id: input.id } });
  const stamp = new Date().toISOString();
  const adminPart = input.revokedById ? ` (admin: ${input.revokedById})` : "";
  const newNote = `[${stamp}] REVOKED${adminPart}: ${input.reason}`;
  const notes = license.notes ? `${license.notes}\n${newNote}` : newNote;

  return db.pilotLicense.update({
    where: { id: input.id },
    data: { status: "REVOKED", notes },
  });
}

export interface SuspendLicenseInput {
  id: string;
  reason: string;
  suspendedById?: string | null;
}

/** Setzt status → SUSPENDED. Reversible via reinstateLicense. */
export async function suspendLicense(
  input: SuspendLicenseInput,
  db: DbClient = prisma,
): Promise<PilotLicense> {
  const license = await db.pilotLicense.findUniqueOrThrow({ where: { id: input.id } });
  const stamp = new Date().toISOString();
  const adminPart = input.suspendedById ? ` (admin: ${input.suspendedById})` : "";
  const newNote = `[${stamp}] SUSPENDED${adminPart}: ${input.reason}`;
  const notes = license.notes ? `${license.notes}\n${newNote}` : newNote;

  return db.pilotLicense.update({
    where: { id: input.id },
    data: { status: "SUSPENDED", notes },
  });
}

export interface ReinstateLicenseInput {
  id: string;
  reason?: string;
  reinstatedById?: string | null;
  /** Falls weggelassen: bestehender expiresAt bleibt. Bei renewal: neues datum. */
  newExpiresAt?: Date | null;
}

/**
 * Setzt status → ACTIVE. Funktioniert von SUSPENDED ODER EXPIRED aus.
 * Optional kann ein neues expiresAt mitgegeben werden (typisch für
 * renewal-flows nach recurrent-training).
 *
 * Hinweis: REVOKED-licenses sind terminal — wir lassen reinstate
 * trotzdem zu (admin-override für fehlentscheidung), aber das ist
 * caller-policy. Im UI wird REVOKED → ACTIVE blockiert oder mit
 * extra-confirmation abgesichert.
 */
export async function reinstateLicense(
  input: ReinstateLicenseInput,
  db: DbClient = prisma,
): Promise<PilotLicense> {
  const license = await db.pilotLicense.findUniqueOrThrow({ where: { id: input.id } });
  const stamp = new Date().toISOString();
  const adminPart = input.reinstatedById ? ` (admin: ${input.reinstatedById})` : "";
  const reasonPart = input.reason ? `: ${input.reason}` : "";
  const newNote = `[${stamp}] REINSTATED${adminPart}${reasonPart}`;
  const notes = license.notes ? `${license.notes}\n${newNote}` : newNote;

  const updateData: Prisma.PilotLicenseUpdateInput = {
    status: "ACTIVE",
    notes,
  };
  if (input.newExpiresAt !== undefined) {
    updateData.expiresAt = input.newExpiresAt;
  }

  return db.pilotLicense.update({
    where: { id: input.id },
    data: updateData,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// expireLicenses (bulk)
// ─────────────────────────────────────────────────────────────────────────

export interface ExpireLicensesResult {
  expiredCount: number;
}

/**
 * Bulk-update: alle ACTIVE-licenses deren expiresAt < now() → status EXPIRED.
 * Designed für cron-job (täglich um 00:05 UTC). Idempotent: zweiter aufruf
 * findet keine zu expiren-en mehr.
 *
 * Hinweis: wir touchen NICHT licenses ohne expiresAt (PPL z.B. expired nie),
 * NICHT bereits-expirede oder REVOKED/SUSPENDED licenses. WHERE-clause sehr
 * konservativ.
 */
export async function expireLicenses(
  db: DbClient = prisma,
): Promise<ExpireLicensesResult> {
  const now = new Date();
  const result = await db.pilotLicense.updateMany({
    where: {
      status: "ACTIVE",
      expiresAt: { not: null, lt: now },
    },
    data: { status: "EXPIRED" },
  });
  return { expiredCount: result.count };
}

// ─────────────────────────────────────────────────────────────────────────
// Read-helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Alle licenses eines users — egal welcher status. Sortiert: ACTIVE zuerst,
 * dann nach issuedAt-DESC (neueste oben).
 *
 * Use-cases: pilot-licenses-page (history-view), admin-pilot-detail.
 */
export async function getUserLicenses(
  userId: string,
  db: DbClient = prisma,
): Promise<PilotLicense[]> {
  return db.pilotLicense.findMany({
    where: { userId },
    orderBy: [{ status: "asc" }, { issuedAt: "desc" }],
  });
}

/**
 * Nur ACTIVE-status. Optimized index-hit auf @@index([userId, status]).
 *
 * Use-cases: canPilotFlyAircraft-check, license-summary-card.
 */
export async function getActiveLicenses(
  userId: string,
  db: DbClient = prisma,
): Promise<PilotLicense[]> {
  return db.pilotLicense.findMany({
    where: { userId, status: "ACTIVE" },
    orderBy: { type: "asc" },
  });
}

/**
 * Quick-boolean: hat der user diesen license-typ ACTIVE?
 *
 * Use-case: einzelner check innerhalb von canPilotFlyAircraft-loops.
 * Diese funktion ist optimiert für den fall "check 5 license-types in
 * sequence". Wenn du ALLE licenses eines users brauchst, nutze
 * getActiveLicenses und filter im memory.
 */
export async function hasLicense(
  userId: string,
  type: LicenseType,
  db: DbClient = prisma,
): Promise<boolean> {
  const license = await db.pilotLicense.findUnique({
    where: { userId_type: { userId, type } },
    select: { status: true },
  });
  return license?.status === "ACTIVE";
}

/**
 * Licenses die in den nächsten N tagen ablaufen (für renewal-reminders).
 * Default 30 tage. Returnt ACTIVE-licenses mit expiresAt in [now, now+N].
 *
 * Use-case: dashboard-warning-card "deine PPL läuft in 14 tagen ab",
 * email-reminder-cron-job.
 */
export async function getExpiringLicenses(
  userId: string,
  daysAhead: number = 30,
  db: DbClient = prisma,
): Promise<PilotLicense[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() + daysAhead * 86_400_000);
  return db.pilotLicense.findMany({
    where: {
      userId,
      status: "ACTIVE",
      expiresAt: { not: null, gte: now, lte: cutoff },
    },
    orderBy: { expiresAt: "asc" },
  });
}
