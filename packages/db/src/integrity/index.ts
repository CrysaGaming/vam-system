/**
 * Track 4 #104 (Section T) — Data-Integrity-Check helpers.
 *
 * Read-only invariant-queries die typische konsistenz-probleme finden:
 * orphan-rows, counter-drift, dangling-FKs, negative-counts. Konsumiert
 * von der /admin/integrity-page.
 *
 * # Performance
 *
 * Alle checks sind COUNT-queries oder kleine SELECT-mit-LIMIT. Bei
 * 100k+ rows dauert ein full-table-COUNT vielleicht 50-200ms pro check.
 * Page revalidate=60 entspannt das.
 *
 * # Check-shape
 *
 * Jeder check returnt:
 *   { name, description, severity, count, examples?, query? }
 *
 * - severity: "ok" | "warn" | "error"
 * - count: anzahl betroffener rows (0 = ok)
 * - examples: bis zu 5 IDs für drill-down
 * - query: human-readable beschreibung des SQL für transparenz
 *
 * # Out-of-scope V1
 *
 * - Automatic repair-actions. Diese page ist read-only-detection. Repair
 *   würde fall-by-fall manual analysis brauchen (z.b. orphan-booking =
 *   delete oder restore? hängt vom kontext ab).
 * - Background-cron. Aktuell admin-triggered via page-load. Bei großer
 *   DB könnte man das täglich laufen lassen + cache.
 */

import { prisma } from "../index.js";

export interface IntegrityCheck {
  name: string;
  description: string;
  severity: "ok" | "warn" | "error";
  count: number;
  /** Bis zu 5 IDs der betroffenen rows für admin drill-down. */
  examples?: string[];
  /** Plain-language beschreibung der prüfung. */
  query: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Section A: Orphan-rows (FK-leakage)
// ─────────────────────────────────────────────────────────────────────────

async function checkOrphanBookings(): Promise<IntegrityCheck> {
  // Booking.user und Booking.airline sind non-null FKs.
  // Booking.routeId ist required → laut schema kann es theoretisch nicht
  // auf eine nicht-existierende route zeigen, ABER bei manual DB-edits
  // oder migrations-bugs könnte das passieren. Raw-SQL weil Prisma's
  // TypeScript-where keine "required FK ist orphan"-condition erlaubt.
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT b.id
    FROM "Booking" b
    LEFT JOIN "Route" r ON r.id = b."routeId"
    WHERE r.id IS NULL
    LIMIT 5
  `;
  let trueCount = rows.length;
  if (trueCount >= 5) {
    const c = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c
      FROM "Booking" b
      LEFT JOIN "Route" r ON r.id = b."routeId"
      WHERE r.id IS NULL
    `;
    trueCount = Number(c[0]?.c ?? 0);
  }

  return {
    name: "Bookings mit hängendem routeId",
    description:
      "Booking-row referenziert eine route die nicht existiert. routeId ist ein required FK — sollte unmöglich sein (DB-corruption oder schema-migration-bug).",
    severity: trueCount > 0 ? "error" : "ok",
    count: trueCount,
    examples: rows.map((r) => r.id),
    query: "Booking LEFT JOIN Route WHERE route.id IS NULL",
  };
}

async function checkOrphanPireps(): Promise<IntegrityCheck> {
  // Pirep hat bookingId optional FK. Wenn booking gelöscht wurde,
  // sollte bookingId NULL sein (SetNull). Hängende bookingId = drift.
  const orphans = await prisma.pirep.findMany({
    where: {
      bookingId: { not: null },
      booking: null,
    },
    select: { id: true },
    take: 5,
  });
  const count =
    orphans.length < 5
      ? orphans.length
      : await prisma.pirep.count({
          where: { bookingId: { not: null }, booking: null },
        });

  return {
    name: "PIREPs mit hängendem bookingId",
    description:
      "PIREP-row referenziert eine booking die nicht mehr existiert. FK-onDelete SetNull sollte das verhindern.",
    severity: count > 0 ? "warn" : "ok",
    count,
    examples: orphans.map((o) => o.id),
    query: "Pirep WHERE bookingId IS NOT NULL AND booking IS NULL",
  };
}

async function checkOrphanTransactions(): Promise<IntegrityCheck> {
  // Transaction.walletId ist non-null FK → laut prisma-schema kann es
  // theoretisch nicht auf eine nicht-existierende wallet zeigen. Raw-SQL
  // weil prisma's typed-where das nicht erlaubt (Wallet ist non-null
  // im scalar-relation-typ). Bei manual DB-edits oder migrations-bugs
  // könnte trotzdem ein orphan auftauchen.
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT t.id
    FROM "Transaction" t
    LEFT JOIN "Wallet" w ON w.id = t."walletId"
    WHERE w.id IS NULL
    LIMIT 5
  `;
  let trueCount = rows.length;
  if (trueCount >= 5) {
    const c = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c
      FROM "Transaction" t
      LEFT JOIN "Wallet" w ON w.id = t."walletId"
      WHERE w.id IS NULL
    `;
    trueCount = Number(c[0]?.c ?? 0);
  }

  return {
    name: "Transactions ohne wallet",
    description:
      "Transaction-row hat walletId, aber die wallet existiert nicht. Sollte unmöglich sein (non-null FK).",
    severity: trueCount > 0 ? "error" : "ok",
    count: trueCount,
    examples: rows.map((r) => r.id),
    query: "Transaction LEFT JOIN Wallet WHERE wallet.id IS NULL",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Section B: Counter-drift & capacity-violations
// ─────────────────────────────────────────────────────────────────────────

async function checkEventCapacityExceeded(): Promise<IntegrityCheck> {
  // Event.maxParticipants ist optional cap. Wenn gesetzt, sollte
  // count(EventParticipant) <= maxParticipants sein. Raw-query weil
  // wir die geJOINte aggregation brauchen.
  const rows = await prisma.$queryRaw<
    Array<{ id: string; maxParticipants: number; actualCount: bigint }>
  >`
    SELECT
      e.id,
      e."maxParticipants",
      COUNT(p.id) AS "actualCount"
    FROM "Event" e
    LEFT JOIN "EventParticipant" p ON p."eventId" = e.id
    WHERE e."maxParticipants" IS NOT NULL
    GROUP BY e.id, e."maxParticipants"
    HAVING COUNT(p.id) > e."maxParticipants"
    LIMIT 5
  `;
  let trueCount = rows.length;
  if (trueCount >= 5) {
    const c = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c FROM (
        SELECT e.id
        FROM "Event" e
        LEFT JOIN "EventParticipant" p ON p."eventId" = e.id
        WHERE e."maxParticipants" IS NOT NULL
        GROUP BY e.id, e."maxParticipants"
        HAVING COUNT(p.id) > e."maxParticipants"
      ) sub
    `;
    trueCount = Number(c[0]?.c ?? 0);
  }

  return {
    name: "Event maxParticipants überschritten",
    description:
      "Event hat einen maxParticipants-cap gesetzt, aber die tatsächliche participant-anzahl überschreitet ihn. Signup-action sollte das verhindern — drift = race-condition oder admin hat den cap nachträglich runtergesetzt.",
    severity: trueCount > 0 ? "warn" : "ok",
    count: trueCount,
    examples: rows.map((r) => r.id),
    query:
      "Event WHERE maxParticipants IS NOT NULL AND COUNT(EventParticipant WHERE eventId = id) > maxParticipants",
  };
}

async function checkWalletBalanceDrift(): Promise<IntegrityCheck> {
  // Wallet.balance sollte == sum(Transaction.amount where walletId = id)
  // sein. Drift wäre ein recordTransaction-bug der wallet.update vergessen
  // hat. Decimal-comparison über raw-query.
  const rows = await prisma.$queryRaw<
    Array<{ id: string; balance: string; sumAmount: string | null }>
  >`
    SELECT
      w.id,
      w.balance::text AS balance,
      COALESCE(SUM(t.amount), 0)::text AS "sumAmount"
    FROM "Wallet" w
    LEFT JOIN "Transaction" t ON t."walletId" = w.id
    GROUP BY w.id, w.balance
    HAVING w.balance != COALESCE(SUM(t.amount), 0)
    LIMIT 5
  `;
  let trueCount = rows.length;
  if (trueCount >= 5) {
    const c = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c FROM (
        SELECT w.id
        FROM "Wallet" w
        LEFT JOIN "Transaction" t ON t."walletId" = w.id
        GROUP BY w.id, w.balance
        HAVING w.balance != COALESCE(SUM(t.amount), 0)
      ) sub
    `;
    trueCount = Number(c[0]?.c ?? 0);
  }

  return {
    name: "Wallet-balance drift",
    description:
      "Wallet.balance weicht von der summe aller Transaction.amount für diese wallet ab. Drift bedeutet entweder ein bug in recordTransaction (update nicht atomic) oder eine manual DB-modification.",
    severity: trueCount > 0 ? "error" : "ok",
    count: trueCount,
    examples: rows.map((r) => r.id),
    query: "Wallet WHERE balance != SUM(Transaction.amount WHERE walletId = id)",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Section C: State-machine inconsistencies
// ─────────────────────────────────────────────────────────────────────────

async function checkCompletedBookingsWithoutPirep(): Promise<IntegrityCheck> {
  // Booking.state Completed sollte einen Pirep haben (oder die transition
  // wäre fehlerhaft passiert). Booking.pirep ist 1:1, also `is: null`
  // matched bookings ohne dazugehörigen Pirep.
  const rows = await prisma.booking.findMany({
    where: {
      state: "Completed",
      pirep: { is: null },
    },
    select: { id: true },
    take: 5,
  });
  const count =
    rows.length < 5
      ? rows.length
      : await prisma.booking.count({
          where: { state: "Completed", pirep: { is: null } },
        });

  return {
    name: "Completed bookings ohne PIREP",
    description:
      "Booking ist als Completed markiert hat aber keinen PIREP. Entweder wurde der pirep gelöscht oder die state-transition lief ohne pirep-submission.",
    severity: count > 0 ? "warn" : "ok",
    count,
    examples: rows.map((r) => r.id),
    query: "Booking WHERE state = Completed AND pirep IS NULL",
  };
}

async function checkApprovedPirepsWithoutTransaction(): Promise<IntegrityCheck> {
  // Approved PIREPs sollten transactions getriggert haben (revenue,
  // expenses, etc.) — nur wenn der user economyEnabled hat UND zur
  // airline mit economyEnabled gehört. Wir filtern auf user+airline-flag
  // damit roleplay-airlines nicht als drift gelten.
  const rows = await prisma.pirep.findMany({
    where: {
      status: "Approved",
      user: {
        economyEnabled: true,
        airline: { economyEnabled: true },
      },
      transactions: { none: {} },
    },
    select: { id: true },
    take: 5,
  });
  const count =
    rows.length < 5
      ? rows.length
      : await prisma.pirep.count({
          where: {
            status: "Approved",
            user: {
              economyEnabled: true,
              airline: { economyEnabled: true },
            },
            transactions: { none: {} },
          },
        });

  return {
    name: "Approved PIREPs ohne transactions (economy-active)",
    description:
      "PIREP ist approved + user UND airline haben economy aktiviert, aber keine Transaction wurde geschrieben. Bedeutet processFlightEconomy lief nicht oder rolled back.",
    severity: count > 0 ? "warn" : "ok",
    count,
    examples: rows.map((r) => r.id),
    query:
      "Pirep WHERE status=Approved AND user.economy AND airline.economy AND NOT EXISTS (Transaction WHERE pirepId = id)",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Section D: Negative-values
// ─────────────────────────────────────────────────────────────────────────

async function checkNegativeTemplateUseCount(): Promise<IntegrityCheck> {
  // EventTemplate.useCount wird bei jedem spawnEventFromTemplate
  // inkrementiert. Sollte ≥ 0 sein. Negativ wäre ein bug oder
  // manual DB-modification.
  const rows = await prisma.eventTemplate.findMany({
    where: { useCount: { lt: 0 } },
    select: { id: true },
    take: 5,
  });
  const count =
    rows.length < 5
      ? rows.length
      : await prisma.eventTemplate.count({
          where: { useCount: { lt: 0 } },
        });
  return {
    name: "EventTemplate.useCount negativ",
    description:
      "EventTemplate.useCount sollte ≥ 0 sein (wird nur inkrementiert, nie dekrementiert). Negativ deutet auf manual DB-modification oder einen seed-bug.",
    severity: count > 0 ? "warn" : "ok",
    count,
    examples: rows.map((r) => r.id),
    query: "EventTemplate WHERE useCount < 0",
  };
}

async function checkBookingsCompletedWithoutPirepEconomyActive(): Promise<IntegrityCheck> {
  // Cross-check: bookings die Completed sind UND in einer economy-aktiven
  // airline laufen — sollten transactions haben. Transaction.bookingId
  // ist FK aber es gibt keine reverse-relation auf Booking, also raw-SQL
  // mit LEFT JOIN. Filter auf user.economyEnabled + airline.economyEnabled
  // damit roleplay-airlines nicht als drift gelten.
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT b.id
    FROM "Booking" b
    JOIN "Airline" a ON a.id = b."airlineId"
    JOIN "User" u ON u.id = b."userId"
    LEFT JOIN "Transaction" t ON t."bookingId" = b.id
    WHERE b.state = 'Completed'
      AND a."economyEnabled" = true
      AND u."economyEnabled" = true
      AND t.id IS NULL
    GROUP BY b.id
    LIMIT 5
  `;
  let trueCount = rows.length;
  if (trueCount >= 5) {
    const c = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c FROM (
        SELECT b.id
        FROM "Booking" b
        JOIN "Airline" a ON a.id = b."airlineId"
        JOIN "User" u ON u.id = b."userId"
        LEFT JOIN "Transaction" t ON t."bookingId" = b.id
        WHERE b.state = 'Completed'
          AND a."economyEnabled" = true
          AND u."economyEnabled" = true
          AND t.id IS NULL
        GROUP BY b.id
      ) sub
    `;
    trueCount = Number(c[0]?.c ?? 0);
  }

  return {
    name: "Completed bookings ohne transactions (economy-active)",
    description:
      "Booking ist Completed, user+airline haben economy aktiviert, aber keine Transaction gebucht. Bedeutet processFlightEconomy lief nicht oder das booking wurde manuell als Completed gesetzt.",
    severity: trueCount > 0 ? "warn" : "ok",
    count: trueCount,
    examples: rows.map((r) => r.id),
    query:
      "Booking LEFT JOIN Transaction WHERE state=Completed AND user.economy AND airline.economy AND NO transaction",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Section E: Stale background-state
// ─────────────────────────────────────────────────────────────────────────

async function checkStaleLiveSessions(): Promise<IntegrityCheck> {
  // LiveSession ohne heartbeat seit > 30min wird typischerweise als
  // "verloren" betrachtet (ACARS-client crash, network-abriss). Wir
  // löschen sie nicht automatisch (Welle 9-design: sessions sind
  // lange-lebige objekte mit position-history), aber wir flaggen sie.
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const rows = await prisma.liveSession.findMany({
    where: { lastAcarsHeartbeat: { lt: cutoff } },
    select: { id: true },
    take: 5,
  });
  const count =
    rows.length < 5
      ? rows.length
      : await prisma.liveSession.count({
          where: { lastAcarsHeartbeat: { lt: cutoff } },
        });
  return {
    name: "LiveSessions ohne heartbeat > 30min",
    description:
      "ACARS-clients sollen jede ~10s heartbeats schicken. Sessions ohne heartbeat seit 30min sind wahrscheinlich abgestürzt. Diese sind nicht inherent broken — nur stale.",
    severity: count > 50 ? "warn" : "ok",
    count,
    examples: rows.map((r) => r.id),
    query: "LiveSession WHERE lastAcarsHeartbeat < now() - 30 min",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Master runner
// ─────────────────────────────────────────────────────────────────────────

export interface IntegrityReport {
  checks: IntegrityCheck[];
  runAt: Date;
  durationMs: number;
  summary: {
    total: number;
    ok: number;
    warn: number;
    error: number;
  };
}

export async function runIntegrityChecks(): Promise<IntegrityReport> {
  const startedAt = performance.now();
  const checks = await Promise.all([
    checkOrphanBookings(),
    checkOrphanPireps(),
    checkOrphanTransactions(),
    checkEventCapacityExceeded(),
    checkWalletBalanceDrift(),
    checkCompletedBookingsWithoutPirep(),
    checkApprovedPirepsWithoutTransaction(),
    checkNegativeTemplateUseCount(),
    checkBookingsCompletedWithoutPirepEconomyActive(),
    checkStaleLiveSessions(),
  ]);
  const durationMs = Math.round(performance.now() - startedAt);
  return {
    checks,
    runAt: new Date(),
    durationMs,
    summary: {
      total: checks.length,
      ok: checks.filter((c) => c.severity === "ok").length,
      warn: checks.filter((c) => c.severity === "warn").length,
      error: checks.filter((c) => c.severity === "error").length,
    },
  };
}
