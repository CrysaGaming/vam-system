/**
 * Type-rating-helpers für Welle 13E Career-System.
 *
 * Type-ratings sind aircraft-spezifisch (A320, B738, B748). Anders als
 * licenses (klassen-rating: SE/ME/IR), gilt ein type-rating für genau ein
 * muster. Pilot braucht ein type-rating pro commercial-aircraft das er fliegt.
 *
 * Was hier rein gehört:
 *   - grantTypeRating       — issue ein neues type-rating
 *   - revokeTypeRating      — admin-action (entfernt das rating, NICHT die history)
 *   - extendTypeRating      — recurrent-pass: expiresAt += 12 monate
 *   - getUserTypeRatings    — alle ratings eines users
 *   - getActiveTypeRatings  — nur not-expired
 *   - hasTypeRating         — quick-check für canPilotFlyAircraft
 *   - incrementHoursOnType  — vom PIREP-approval-flow aufgerufen
 *   - expireTypeRatings     — bulk-update für cron
 *
 * Was NICHT hier rein gehört:
 *   - Aircraft-licenses-mapping (welches aircraft braucht welche licenses)
 *     → siehe ./requirements.ts
 *   - Booking-gate-composite (canPilotFlyAircraft) → ./can-fly.ts
 *
 * Sicherheits-prinzip wie bei licenses: revokeTypeRating ist ein hard-delete
 * weil type-ratings keinen status-feld haben. Für audit-trail muss revoke-
 * action separat geloggt werden (caller-responsibility, evtl. später eigene
 * audit-log-table).
 *
 * Convention: alle helpers akzeptieren optional einen `db: DbClient`-
 * parameter für composition mit outer-transactions. Default ist der globale
 * prisma-client.
 */

import {
  Prisma,
  type TypeRating,
} from "@prisma/client";
import { prisma } from "../index.js";
import type { DbClient } from "../economy/wallet.js";

// ─────────────────────────────────────────────────────────────────────────
// grantTypeRating
// ─────────────────────────────────────────────────────────────────────────

export interface GrantTypeRatingInput {
  userId: string;
  /** ICAO type-designator: "A320", "B738", "A35K". Case-sensitive. */
  aircraftType: string;
  /** Falls weggelassen: jetzt. */
  obtainedAt?: Date;
  /**
   * Falls weggelassen: obtainedAt + 12 monate. Type-ratings müssen
   * recurrent-checked werden alle 12 monate. expiresAt = null möglich
   * für admin-issued lifetime-ratings (selten, primär seed-data).
   */
  expiresAt?: Date | null;
  /** Wer hat das rating ausgestellt. NULL für system-issued. */
  issuedById?: string | null;
  /** Optional notes. */
  notes?: string | null;
}

/**
 * Issue ein neues type-rating.
 *
 * Idempotency: P2002-error wenn (userId, aircraftType) schon existiert.
 * Caller sollte hasTypeRating zuerst checken wenn idempotent gewünscht.
 *
 * Default-expiry-policy: 12 monate ab obtainedAt. Recurrent-checks
 * (extendTypeRating) verlängern um weitere 12 monate.
 */
export async function grantTypeRating(
  input: GrantTypeRatingInput,
  db: DbClient = prisma,
): Promise<TypeRating> {
  const obtainedAt = input.obtainedAt ?? new Date();
  let expiresAt: Date | null;
  if (input.expiresAt === undefined) {
    expiresAt = new Date(obtainedAt);
    expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 12);
  } else {
    expiresAt = input.expiresAt;
  }

  return db.typeRating.create({
    data: {
      userId: input.userId,
      aircraftType: input.aircraftType,
      obtainedAt,
      expiresAt,
      hoursOnType: 0,
      lastFlownAt: null,
      issuedById: input.issuedById ?? null,
      notes: input.notes ?? null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// extendTypeRating (recurrent)
// ─────────────────────────────────────────────────────────────────────────

export interface ExtendTypeRatingInput {
  /** TypeRating-id. */
  id: string;
  /** Falls weggelassen: 12 monate ab CURRENT expiresAt (oder ab now wenn already-expired). */
  newExpiresAt?: Date;
  /** Wer hat den check abgenommen. */
  issuedById?: string | null;
  /** Optional notes (z.B. "recurrent sim-check pass 04/2026"). */
  notesAppend?: string;
}

/**
 * Recurrent-pass: expiresAt verlängern. Wenn rating already-expired ist
 * (newExpiresAt nicht angegeben), zählt 12 monate ab now (= renewal nach
 * langer pause). Sonst 12 monate ab altem expiresAt (= consistent
 * recurrent-zyklus).
 */
export async function extendTypeRating(
  input: ExtendTypeRatingInput,
  db: DbClient = prisma,
): Promise<TypeRating> {
  const rating = await db.typeRating.findUniqueOrThrow({ where: { id: input.id } });

  let expiresAt: Date;
  if (input.newExpiresAt) {
    expiresAt = input.newExpiresAt;
  } else {
    const now = new Date();
    const base = rating.expiresAt && rating.expiresAt > now ? rating.expiresAt : now;
    expiresAt = new Date(base);
    expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 12);
  }

  let notes = rating.notes;
  if (input.notesAppend) {
    const stamp = new Date().toISOString();
    const adminPart = input.issuedById ? ` (admin: ${input.issuedById})` : "";
    const newNote = `[${stamp}] EXTENDED${adminPart}: ${input.notesAppend}`;
    notes = notes ? `${notes}\n${newNote}` : newNote;
  }

  return db.typeRating.update({
    where: { id: input.id },
    data: { expiresAt, notes },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// revokeTypeRating
// ─────────────────────────────────────────────────────────────────────────

/**
 * Hard-delete eines type-ratings. Im gegensatz zu PilotLicense (status-
 * feld) kennen type-ratings nur "exists/not-exists". Caller sollte vor
 * delete eine separate audit-log-zeile schreiben (z.B. via system.ts
 * SYSTEM-wallet-tx mit metadata oder später dedizierte audit-table).
 *
 * Beim canPilotFlyAircraft-check zählt das gelöschte rating dann sofort
 * als "missing" — pilot kann das aircraft nicht mehr fliegen.
 */
export async function revokeTypeRating(
  id: string,
  db: DbClient = prisma,
): Promise<void> {
  await db.typeRating.delete({ where: { id } });
}

// ─────────────────────────────────────────────────────────────────────────
// expireTypeRatings (bulk)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Type-ratings haben kein status-feld — "expired" ist implizit via
 * expiresAt < now(). Diese funktion ist daher nur ein read-helper für
 * UI-display ("zeige expired ratings rot"), kein status-update wie bei
 * licenses.
 *
 * Wir nutzen den expiresAt-vergleich app-layer in canPilotFlyAircraft.
 *
 * Das macht type-ratings simpler aber auch weniger audit-friendly. Im MVP
 * akzeptiert; wenn später nötig, kann ein status-feld nachgezogen werden.
 */
export async function getExpiredTypeRatings(
  userId: string,
  db: DbClient = prisma,
): Promise<TypeRating[]> {
  const now = new Date();
  return db.typeRating.findMany({
    where: {
      userId,
      expiresAt: { not: null, lt: now },
    },
    orderBy: { expiresAt: "desc" },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// incrementHoursOnType
// ─────────────────────────────────────────────────────────────────────────

export interface IncrementHoursInput {
  userId: string;
  aircraftType: string;
  /** Stunden zum hinzufügen (positiv). Float — typische werte 0.5–14.0. */
  hours: number;
  /** Wann wurde geflogen. Default: now. Updated lastFlownAt. */
  flownAt?: Date;
}

/**
 * Vom PIREP-approval-flow aufgerufen. Findet das passende type-rating
 * (case-exact-match auf aircraftType) und inkrementiert hoursOnType +
 * setzt lastFlownAt.
 *
 * Wenn kein type-rating existiert: noop (returnt null). Im career-mode
 * blockiert canPilotFlyAircraft den booking sowieso — wir vertrauen
 * darauf dass kein PIREP geapproved werden kann ohne valid type-rating.
 * Aber graceful: wir failen nicht hart, falls ein PIREP von vor career-
 * activation noch im flight-history landet.
 *
 * Edge-case: Pilot hat type-rating für "A320", PIREP nutzt "A320-200" —
 * wir matchen nur exakt. Caller muss den ICAO-typ vorher normalisieren.
 *
 * Returnt das geupdate-te rating, oder null wenn nichts zu updaten war.
 */
export async function incrementHoursOnType(
  input: IncrementHoursInput,
  db: DbClient = prisma,
): Promise<TypeRating | null> {
  if (input.hours <= 0) {
    return null;
  }

  const rating = await db.typeRating.findUnique({
    where: {
      userId_aircraftType: {
        userId: input.userId,
        aircraftType: input.aircraftType,
      },
    },
  });

  if (!rating) {
    return null;
  }

  return db.typeRating.update({
    where: { id: rating.id },
    data: {
      hoursOnType: { increment: input.hours },
      lastFlownAt: input.flownAt ?? new Date(),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Read-helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Alle type-ratings eines users. Sortiert nach lastFlownAt-DESC (zuletzt
 * geflogen oben), nulls zuletzt.
 */
export async function getUserTypeRatings(
  userId: string,
  db: DbClient = prisma,
): Promise<TypeRating[]> {
  return db.typeRating.findMany({
    where: { userId },
    orderBy: [{ lastFlownAt: { sort: "desc", nulls: "last" } }, { aircraftType: "asc" }],
  });
}

/**
 * Nur not-expired type-ratings (expiresAt > now ODER expiresAt = null).
 * Für canPilotFlyAircraft-check.
 */
export async function getActiveTypeRatings(
  userId: string,
  db: DbClient = prisma,
): Promise<TypeRating[]> {
  const now = new Date();
  return db.typeRating.findMany({
    where: {
      userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { aircraftType: "asc" },
  });
}

/**
 * Quick-boolean: hat user das type-rating für aircraftType ACTIVE
 * (= existiert + nicht expired)?
 */
export async function hasTypeRating(
  userId: string,
  aircraftType: string,
  db: DbClient = prisma,
): Promise<boolean> {
  const rating = await db.typeRating.findUnique({
    where: { userId_aircraftType: { userId, aircraftType } },
    select: { expiresAt: true },
  });
  if (!rating) return false;
  if (rating.expiresAt === null) return true;
  return rating.expiresAt > new Date();
}

/**
 * Type-ratings die in den nächsten N tagen ablaufen. Default 60 tage
 * (länger als license-default weil recurrent-checks geplant werden müssen).
 */
export async function getExpiringTypeRatings(
  userId: string,
  daysAhead: number = 60,
  db: DbClient = prisma,
): Promise<TypeRating[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() + daysAhead * 86_400_000);
  return db.typeRating.findMany({
    where: {
      userId,
      expiresAt: { not: null, gte: now, lte: cutoff },
    },
    orderBy: { expiresAt: "asc" },
  });
}
