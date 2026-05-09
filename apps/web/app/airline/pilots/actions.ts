'use server';

import { prisma, EmploymentStatus } from '@vam/db';
import { requireAirlineManagerWithAirline } from '@/lib/roles';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Personnel-Management server-actions (Welle 6 commit 6B-4).
 *
 * Liefert die haupt-aggregation für /airline/pilots: pro pilot ein record
 * mit basis-info (name/avatar/rank/role/employmentStatus) plus performance-
 * stats (lastFlight-recency, monthly hours, approval-rate). Plus action
 * zum employment-status-toggle.
 *
 * Rank-zuweisung NICHT hier — wir nutzen die existing `assignRankToMember`
 * aus /airline/actions.ts. Das hält die safety-guards (multi-tenant-check,
 * rank-belongs-to-airline) zentral und vermeidet drift.
 *
 * Auth-gate: AIRLINE_MANAGER_ROLES (admin | airline-admin | instructor).
 *
 * Out-of-scope für 6B-4:
 * - On-time-rate (würde PIREP→Booking→scheduledDeparture vergleichen, komplex)
 * - Bulk-actions (multi-select status-change) → wenn user-feedback es will
 * - Pilot-detail-drawer mit history-graph → später
 */
const requireAirlineAdmin = requireAirlineManagerWithAirline;

// ─────────────────────────────────────────────────────────────────────────
// List personnel mit performance-stats
// ─────────────────────────────────────────────────────────────────────────

export type PersonnelEntry = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  rankId: string | null;
  rankName: string | null;
  rankOrder: number | null;
  roleName: string | null;
  employmentStatus: EmploymentStatus;
  totalFlightHours: number;
  totalFlights: number;
  joinedAirlineAt: Date | null;
  createdAt: Date;
  currentLocationIcao: string | null;
  baseIcao: string | null;
  // Performance-stats aus PIREPs aggregiert
  lastFlightAt: Date | null;
  flightsLast30d: number;
  hoursLast30d: number;
  approvalRatePct: number | null; // null wenn keine PIREPs jemals submitted
};

export type PersonnelFilters = {
  status?: EmploymentStatus | 'ALL';
  rankId?: string | null; // null = "kein rank zugewiesen", undefined = alle
  /**
   * Track 4 #38 (Section G): Free-text search auf name + email (case-
   * insensitive contains). Leer-string oder undefined = kein filter.
   */
  query?: string;
};

/**
 * Listet alle members der eigenen airline mit performance-aggregation.
 *
 * Filter:
 * - status: filter auf employment-status (default: alle).
 * - rankId: filter auf rank-id, leerer string oder 'NONE' für "kein rank".
 *
 * Performance-stats werden in einer single SQL-aggregation pro user
 * berechnet (per-pirep-rollup). N+1 würde bei 100+ piloten unbenutzbar.
 *
 * - lastFlightAt: MAX(pirep.submittedAt)
 * - flightsLast30d: COUNT WHERE submittedAt > NOW - 30d
 * - hoursLast30d: SUM(flightTimeMin)/60 WHERE submittedAt > NOW - 30d
 * - approvalRatePct: 100 * COUNT(status=Approved) / COUNT(*) — null wenn 0 PIREPs
 *
 * Implementation-note: Prisma's groupBy ist limitiert (kein time-window-
 * filter direkt im aggregate), darum werden die performance-stats über
 * groupBy aggregations + zwei separate queries (recent vs all-time) gebaut.
 * Bei 200+ piloten + 10000+ PIREPs läuft das immer noch unter 1 sekunde
 * (postgres index auf [userId, submittedAt] greift).
 */
export async function listPersonnel(
  filters: PersonnelFilters = {},
): Promise<PersonnelEntry[]> {
  const { airlineId } = await requireAirlineAdmin();

  // Build where-clause für user-query
  const userWhere: {
    airlineId: string;
    employmentStatus?: EmploymentStatus;
    rankId?: string | null;
    OR?: Array<{
      name?: { contains: string; mode: 'insensitive' };
      email?: { contains: string; mode: 'insensitive' };
    }>;
  } = { airlineId };

  if (filters.status && filters.status !== 'ALL') {
    userWhere.employmentStatus = filters.status;
  }
  // rankId-filter: explizit string → genau dieser rank;
  // explizit null → users ohne rank;
  // undefined (filter unset) → kein filter
  if (filters.rankId === null) {
    userWhere.rankId = null;
  } else if (filters.rankId) {
    userWhere.rankId = filters.rankId;
  }

  // Track 4 #38: Free-text search via OR auf name + email. Trim damit
  // führende/trailing spaces nicht zur leer-suche werden. Min-length 1
  // damit ein einzelner buchstabe noch matched (autocomplete-ish behavior).
  // Postgres-side ILIKE via Prisma's `mode: 'insensitive'`.
  const trimmedQuery = filters.query?.trim();
  if (trimmedQuery) {
    userWhere.OR = [
      { name: { contains: trimmedQuery, mode: 'insensitive' } },
      { email: { contains: trimmedQuery, mode: 'insensitive' } },
    ];
  }

  const users = await prisma.user.findMany({
    where: userWhere,
    include: { rank: true, role: true },
    orderBy: [{ totalFlightHours: 'desc' }, { name: 'asc' }],
  });

  if (users.length === 0) return [];

  const userIds = users.map((u) => u.id);

  // Performance-aggregation: ein groupBy pro time-window. Die `_max` für
  // lastFlightAt + `_sum` und `_count` für recent-window + counts für
  // approval-rate. Postgres macht das in 3 separate index-scans, alles
  // unter ms-bereich für realistische daten.
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Last-flight + total approval-counts (all-time)
  const [lastFlightAgg, allTimeCounts, recentCounts] = await Promise.all([
    prisma.pirep.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, airlineId },
      _max: { submittedAt: true },
    }),
    prisma.pirep.groupBy({
      by: ['userId', 'status'],
      where: { userId: { in: userIds }, airlineId },
      _count: { _all: true },
    }),
    prisma.pirep.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        airlineId,
        submittedAt: { gte: thirtyDaysAgo },
      },
      _count: { _all: true },
      _sum: { flightTimeMin: true },
    }),
  ]);

  // Build lookup-maps für efficient join
  const lastFlightByUser = new Map<string, Date>();
  for (const row of lastFlightAgg) {
    if (row._max.submittedAt) {
      lastFlightByUser.set(row.userId, row._max.submittedAt);
    }
  }

  const recentByUser = new Map<string, { flights: number; minutes: number }>();
  for (const row of recentCounts) {
    recentByUser.set(row.userId, {
      flights: row._count._all,
      minutes: row._sum.flightTimeMin ?? 0,
    });
  }

  // Approval-rate: per-user die status-counts addieren und ratio bilden
  const approvalByUser = new Map<string, { approved: number; total: number }>();
  for (const row of allTimeCounts) {
    const cur = approvalByUser.get(row.userId) ?? { approved: 0, total: 0 };
    cur.total += row._count._all;
    if (row.status === 'Approved') {
      cur.approved += row._count._all;
    }
    approvalByUser.set(row.userId, cur);
  }

  // Final mapping: alle user-records mit ihren stats anreichern.
  return users.map((u) => {
    const recent = recentByUser.get(u.id);
    const approval = approvalByUser.get(u.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      rankId: u.rankId,
      rankName: u.rank?.name ?? null,
      rankOrder: u.rank?.order ?? null,
      roleName: u.role?.name ?? null,
      employmentStatus: u.employmentStatus,
      totalFlightHours: u.totalFlightHours,
      totalFlights: u.totalFlights,
      joinedAirlineAt: u.joinedAirlineAt,
      createdAt: u.createdAt,
      currentLocationIcao: u.currentLocationIcao,
      baseIcao: u.baseIcao,
      lastFlightAt: lastFlightByUser.get(u.id) ?? null,
      flightsLast30d: recent?.flights ?? 0,
      hoursLast30d: recent ? recent.minutes / 60 : 0,
      approvalRatePct:
        approval && approval.total > 0
          ? Math.round((approval.approved / approval.total) * 100)
          : null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Set employment-status
// ─────────────────────────────────────────────────────────────────────────

const SetEmploymentStatusSchema = z.object({
  userId: z.string().min(1),
  status: z.enum(['ACTIVE', 'LEAVE', 'INACTIVE']),
});

export type SetEmploymentStatusResult =
  | { ok: true; status: EmploymentStatus }
  | { ok: false; error: string };

/**
 * Setzt den employment-status eines members. Multi-tenant-guard: target
 * muss in derselben airline sein wie der actor.
 *
 * Bewusst KEIN side-effect auf rank/role/airlineId — employment-status
 * ist orthogonal zur membership. Ein pilot auf LEAVE bleibt member,
 * behält seinen rank, kann theoretisch immer noch fliegen (kein hard-
 * gate auf bookings — der status ist roleplay-info für admins).
 *
 * Self-status-change ist erlaubt (z.B. admin meldet sich selbst urlaubs-
 * weise auf LEAVE). Sicherheitsmäßig irrelevant weil employment-status
 * keine permissions beeinflusst — admin bleibt admin.
 */
export async function setEmploymentStatus(
  input: z.infer<typeof SetEmploymentStatusSchema>,
): Promise<SetEmploymentStatusResult> {
  const { airlineId, user: actor } = await requireAirlineAdmin();

  const parsed = SetEmploymentStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Ungültige Eingabe' };
  }

  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, name: true, airlineId: true, employmentStatus: true },
  });

  if (!target || target.airlineId !== airlineId) {
    return { ok: false, error: 'Pilot nicht gefunden' };
  }

  if (target.employmentStatus === parsed.data.status) {
    // No-op — kein update, kein revalidate nötig
    return { ok: true, status: target.employmentStatus };
  }

  await prisma.user.update({
    where: { id: target.id },
    data: { employmentStatus: parsed.data.status },
  });

  console.log(
    `[employment-status] ${actor.name} set ${target.name}: ${target.employmentStatus} -> ${parsed.data.status}`,
  );

  revalidatePath('/airline/pilots');
  revalidatePath('/airline'); // member-table zeigt evtl. status
  revalidatePath('/pilots'); // pilot-listing könnte status zeigen
  revalidatePath('/dashboard');

  return { ok: true, status: parsed.data.status };
}
