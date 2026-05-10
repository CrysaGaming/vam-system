import { prisma } from '@vam/db';
import { requireAdminPage } from '@/lib/roles';
import Link from 'next/link';
import { RequestsQueue } from './requests-queue';

/**
 * Admin Request-Queue. Combined view of open AirportRequests + AircraftType-
 * Requests. Phase 1 single-tenant: same admin role gates submit AND approve;
 * Phase 2 will introduce a dedicated system-admin distinction so airline-
 * admins cannot self-approve.
 *
 * Defense-in-depth — server actions also check requireSystemAdmin, so even
 * if a non-admin loads this page, mutations are blocked.
 */
export default async function AdminRequestsPage() {
  const user = await requireAdminPage();
  // Open requests = Submitted + UnderReview. Recent decisions
  // (Approved/Rejected) werden separat darunter gezeigt (Track 4 #46).
  //
  // Track 4 #46 (Section I): Recent-Decisions-section. Hole approved+
  // rejected requests der letzten 30 Tage (limit 20 pro typ) mit reviewer-
  // info für audit-trail. reviewedAt ist im schema nullable aber bei
  // Approved/Rejected immer gesetzt (siehe state-machine docs am model-
  // header) — Prisma weiß das nicht, also defensive im UI.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [
    airportRequests,
    aircraftTypeRequests,
    recentAirportDecisions,
    recentAircraftTypeDecisions,
  ] = await Promise.all([
    prisma.airportRequest.findMany({
      where: { status: { in: ['Submitted', 'UnderReview'] } },
      orderBy: { submittedAt: 'asc' },
      include: {
        requestedBy: { select: { id: true, name: true, email: true } },
        requestedAirline: { select: { id: true, icao: true, name: true } },
      },
    }),
    prisma.aircraftTypeRequest.findMany({
      where: { status: { in: ['Submitted', 'UnderReview'] } },
      orderBy: { submittedAt: 'asc' },
      include: {
        requestedBy: { select: { id: true, name: true, email: true } },
        requestedAirline: { select: { id: true, icao: true, name: true } },
      },
    }),
    prisma.airportRequest.findMany({
      where: {
        status: { in: ['Approved', 'Rejected'] },
        reviewedAt: { gte: thirtyDaysAgo },
      },
      orderBy: { reviewedAt: 'desc' },
      take: 20,
      include: {
        requestedBy: { select: { id: true, name: true } },
        reviewer: { select: { id: true, name: true } },
      },
    }),
    prisma.aircraftTypeRequest.findMany({
      where: {
        status: { in: ['Approved', 'Rejected'] },
        reviewedAt: { gte: thirtyDaysAgo },
      },
      orderBy: { reviewedAt: 'desc' },
      take: 20,
      include: {
        requestedBy: { select: { id: true, name: true } },
        reviewer: { select: { id: true, name: true } },
      },
    }),
  ]);

  const totalOpen = airportRequests.length + aircraftTypeRequests.length;
  const totalRecentDecisions =
    recentAirportDecisions.length + recentAircraftTypeDecisions.length;

  // Merge + sort beide decision-arrays in einen kombinierten feed,
  // sortiert nach reviewedAt-desc damit der admin chronologisch sieht
  // was zuletzt entschieden wurde. Tagged mit `kind` damit die UI
  // verschiedene labels rendern kann.
  type DecisionRow =
    | {
        kind: 'airport';
        id: string;
        status: string;
        icao: string;
        name: string;
        country: string;
        reviewedAt: Date | null;
        reviewer: { id: string; name: string | null } | null;
        requestedBy: { id: string; name: string | null };
        rejectionReason: string | null;
        approvedAsVerified: boolean | null;
      }
    | {
        kind: 'aircraft';
        id: string;
        status: string;
        icaoType: string;
        manufacturer: string;
        name: string;
        reviewedAt: Date | null;
        reviewer: { id: string; name: string | null } | null;
        requestedBy: { id: string; name: string | null };
        rejectionReason: string | null;
        approvedAsVerified: boolean | null;
      };

  const decisions: DecisionRow[] = [
    ...recentAirportDecisions.map<DecisionRow>((r) => ({
      kind: 'airport',
      id: r.id,
      status: r.status,
      icao: r.icao,
      name: r.name,
      country: r.country,
      reviewedAt: r.reviewedAt,
      reviewer: r.reviewer,
      requestedBy: r.requestedBy,
      rejectionReason: r.rejectionReason,
      approvedAsVerified: r.approvedAsVerified,
    })),
    ...recentAircraftTypeDecisions.map<DecisionRow>((r) => ({
      kind: 'aircraft',
      id: r.id,
      status: r.status,
      icaoType: r.icaoType,
      manufacturer: r.manufacturer,
      name: r.name,
      reviewedAt: r.reviewedAt,
      reviewer: r.reviewer,
      requestedBy: r.requestedBy,
      rejectionReason: r.rejectionReason,
      approvedAsVerified: r.approvedAsVerified,
    })),
  ].sort((a, b) => {
    // Defensive: reviewedAt sollte bei Approved/Rejected immer gesetzt
    // sein, aber prisma-types lassen es nullable. Null-rows landen am ende.
    const aTime = a.reviewedAt?.getTime() ?? 0;
    const bTime = b.reviewedAt?.getTime() ?? 0;
    return bTime - aTime;
  });

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">
              Request-Queue
              {totalOpen > 0 && (
                <span className="ml-3 px-3 py-1 text-sm font-semibold rounded-full bg-yellow-500/20 text-yellow-700 dark:text-yellow-300">
                  {totalOpen} offen
                </span>
              )}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Airline-Vorschläge für neue Airports + Aircraft-Types. Approve oder reject.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </header>

        <RequestsQueue
          airportRequests={airportRequests}
          aircraftTypeRequests={aircraftTypeRequests}
        />

        {/* Track 4 #46 (Section I): Recent-Decisions-section. Zeigt
            approved+rejected requests der letzten 30 Tage als kompakter
            audit-feed. Hilft dem admin nachvollziehen wer was wann
            entschieden hat (especially nützlich wenn ein requester fragt
            "warum ist mein request weg" — kann der admin hier direkt
            schauen). Versteckt wenn nichts zu zeigen. */}
        {totalRecentDecisions > 0 && (
          <section className="mt-10">
            <header className="flex items-baseline justify-between mb-4 pb-2 border-b border-gray-200 dark:border-gray-800">
              <div>
                <h2 className="text-lg font-semibold">
                  Letzte Entscheidungen
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {totalRecentDecisions}{' '}
                  {totalRecentDecisions === 1 ? 'Entscheidung' : 'Entscheidungen'}{' '}
                  · letzte 30 Tage
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {decisions.filter((d) => d.status === 'Approved').length} approved
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  {decisions.filter((d) => d.status === 'Rejected').length} rejected
                </span>
              </div>
            </header>

            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
              <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                {decisions.map((d) => (
                  <DecisionRow key={`${d.kind}-${d.id}`} decision={d} />
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

/**
 * Decision-row — sub-component für Track 4 #46. Kompakter audit-eintrag
 * mit status-icon, item-identifier (ICAO/icaoType + name), reviewer und
 * relative-time. Bei rejection wird der grund inline gezeigt damit der
 * admin den kontext direkt sieht — sonst müsste man zur detail-page
 * springen.
 *
 * Discriminated union via `kind` — typescript narrowing macht die
 * field-access type-safe (airport: icao+country, aircraft: icaoType+
 * manufacturer).
 */
function DecisionRow({
  decision,
}: {
  decision:
    | {
        kind: 'airport';
        id: string;
        status: string;
        icao: string;
        name: string;
        country: string;
        reviewedAt: Date | null;
        reviewer: { id: string; name: string | null } | null;
        requestedBy: { id: string; name: string | null };
        rejectionReason: string | null;
        approvedAsVerified: boolean | null;
      }
    | {
        kind: 'aircraft';
        id: string;
        status: string;
        icaoType: string;
        manufacturer: string;
        name: string;
        reviewedAt: Date | null;
        reviewer: { id: string; name: string | null } | null;
        requestedBy: { id: string; name: string | null };
        rejectionReason: string | null;
        approvedAsVerified: boolean | null;
      };
}) {
  const isApproved = decision.status === 'Approved';
  const statusClasses = isApproved
    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
    : 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30';
  const statusLabel = isApproved
    ? decision.approvedAsVerified
      ? 'Approved ✓ verified'
      : 'Approved (unverified)'
    : 'Rejected';

  // Datum-format: kombiniert relative-time ("vor 2h") + absolutes datum
  // im title-attribute für hover-precision. Audit-feeds profitieren von
  // beiden — schneller skim + exakter timestamp bei bedarf.
  const reviewedAt = decision.reviewedAt;
  const reviewedAtStr = reviewedAt
    ? new Intl.DateTimeFormat('de-DE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(reviewedAt)
    : '—';
  const relativeStr = reviewedAt ? formatRelativeAgo(reviewedAt) : '—';

  return (
    <li className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span
            className={`inline-flex shrink-0 px-2 py-0.5 rounded text-xs font-semibold border ${statusClasses}`}
            aria-label={`Status: ${statusLabel}`}
          >
            {statusLabel}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-mono font-semibold text-sm">
                {decision.kind === 'airport' ? decision.icao : decision.icaoType}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {decision.kind === 'airport'
                  ? `${decision.name} · ${decision.country}`
                  : `${decision.manufacturer} ${decision.name}`}
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                {decision.kind === 'airport' ? 'Airport' : 'Aircraft-Type'}
              </span>
            </div>
            {!isApproved && decision.rejectionReason && (
              <p className="text-xs text-red-700 dark:text-red-400 mt-1 italic">
                Grund: {decision.rejectionReason}
              </p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Eingereicht von{' '}
              <span className="text-gray-700 dark:text-gray-300">
                {decision.requestedBy.name ?? 'unbekannt'}
              </span>
              {decision.reviewer && (
                <>
                  {' · '}
                  Entschieden von{' '}
                  <span className="text-gray-700 dark:text-gray-300">
                    {decision.reviewer.name ?? 'unbekannt'}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        <time
          className="text-xs text-gray-500 dark:text-gray-400 tabular-nums shrink-0"
          dateTime={reviewedAt?.toISOString() ?? ''}
          title={reviewedAtStr}
        >
          {relativeStr}
        </time>
      </div>
    </li>
  );
}

/**
 * Format "vor X" relative-time auf deutsch. Für audit-feeds. Schwellen:
 *   <1min   → "gerade eben"
 *   <60min  → "vor Xmin"
 *   <24h    → "vor Xh"
 *   <7d     → "vor Xd"
 *   sonst   → "vor Xw"
 *
 * Bewusst grob — audit-rows brauchen keine sekundengenauen relativ-
 * zeiten, der exakte timestamp ist eh im title-attribute beim hover.
 */
function formatRelativeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `vor ${days}d`;
  const weeks = Math.floor(days / 7);
  return `vor ${weeks}w`;
}
