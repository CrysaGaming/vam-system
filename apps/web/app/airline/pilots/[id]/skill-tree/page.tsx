import { notFound } from 'next/navigation';
import {
  prisma,
  licenseDisplayName,
  type LicenseType,
  type LicenseStatus,
} from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { EndorsementStickers } from '@/components/endorsement-stickers';

/**
 * Track 4 #90 (Section R) — Skill-Tree für pilot-progression.
 *
 * Visuelle progression-chart die zeigt:
 *   1. License-Hierarchy als baum (SPL → PPL → CPL → ATPL → TRI/TRE)
 *      mit add-on branch (NIGHT/IR/ME) ab PPL
 *   2. Type-Ratings als seitenpanel (alle aircraft-types die der pilot
 *      qualified ist)
 *   3. Hour-Milestones als ladder (50h/100h/.../10000h)
 *
 * Use-case: admin sieht auf einen blick wo ein pilot in seiner career
 * steht, was er hat, was als nächstes ansteht. Schneller als die flat-
 * listen auf der haupt-pilot-page (die existiert weiter — beide ergänzen
 * sich: tree für overview, listen für details/actions).
 *
 * Architektur-decision:
 * - Pure server-component, kein client-state
 * - DERIVED view aus existing PilotLicense + TypeRating + flight-hours
 *   tabellen. Kein neues schema, kein migration.
 * - Prereq-rules sind im code definiert (TIER_DEFINITIONS array) statt
 *   in DB — sie sind structural und ändern sich nicht zur runtime.
 *   Echte ICAO-prereqs sind noch komplexer (z.B. ATPL braucht 1500h),
 *   aber für die visualisierung reichen license-only-prereqs.
 * - Status pro node wird gemapped: HELD+ACTIVE → unlocked (emerald),
 *   HELD+EXPIRED → expired (amber), HELD+REVOKED/SUSPENDED → blocked
 *   (red/amber), NOT-HELD+prereqs-met → available (indigo-outline),
 *   NOT-HELD+prereqs-missing → locked (gray)
 *
 * Out-of-scope:
 * - Pilot-self-view (würde unter /career/skill-tree leben) — kommt wenn
 *   pilot-facing portal aufgebaut wird
 * - Editable: skill-tree ist read-only. Grants/revokes laufen über die
 *   haupt-pilot-page wie bisher
 * - Animationen / unlock-celebrations
 * - Drill-down zu einzelnen licenses → links zur haupt-pilot-page
 */

// ─────────────────────────────────────────────────────────────────────────
// Tier-definitions: structural hierarchy der lizenz-progression.
// ─────────────────────────────────────────────────────────────────────────

interface TierNode {
  type: LicenseType;
  /** Prereqs (license-types) die VOR diesem node held werden müssen */
  prereqs: LicenseType[];
  /** Kurze beschreibung was diese license tut */
  description: string;
}

interface Tier {
  /** Visual tier-level (0 = bottom = foundation) */
  level: number;
  /** Display-label für die zeile */
  label: string;
  /** Nodes in diesem tier (mehrere wenn parallel/optional) */
  nodes: TierNode[];
}

/**
 * Standard career-progression EASA-style. Vereinfachte prereqs (echte
 * ICAO-rules sind komplexer mit hours-thresholds etc., aber für die
 * visualisierung reicht die license-hierarchy).
 */
const TIER_DEFINITIONS: Tier[] = [
  {
    level: 0,
    label: 'Foundation',
    nodes: [
      {
        type: 'SPL',
        prereqs: [],
        description: 'Student Pilot — solo-flight permit, in-training only',
      },
    ],
  },
  {
    level: 1,
    label: 'Private',
    nodes: [
      {
        type: 'PPL',
        prereqs: ['SPL'],
        description: 'Private Pilot — VFR, single-engine, day, non-commercial',
      },
    ],
  },
  {
    level: 2,
    label: 'Add-Ons',
    nodes: [
      {
        type: 'NIGHT_RATING',
        prereqs: ['PPL'],
        description: 'Night-flying VFR-extension',
      },
      {
        type: 'INSTRUMENT_RATING',
        prereqs: ['PPL'],
        description: 'IR — IFR-flying',
      },
      {
        type: 'MULTI_ENGINE_RATING',
        prereqs: ['PPL'],
        description: 'ME — multi-engine class rating',
      },
    ],
  },
  {
    level: 3,
    label: 'Commercial',
    nodes: [
      {
        type: 'CPL',
        prereqs: ['PPL'],
        description: 'Commercial Pilot — fly for money, single-pilot ops',
      },
    ],
  },
  {
    level: 4,
    label: 'Multi-Crew',
    nodes: [
      {
        type: 'MCC',
        prereqs: ['CPL'],
        description: 'Multi-Crew Cooperation — required für two-pilot type-ratings',
      },
    ],
  },
  {
    level: 5,
    label: 'Airline',
    nodes: [
      {
        type: 'ATPL',
        prereqs: ['CPL', 'MCC'],
        description: 'Airline Transport Pilot — captain für commercial-airlines',
      },
    ],
  },
  {
    level: 6,
    label: 'Instructor',
    nodes: [
      {
        type: 'TRI',
        prereqs: ['ATPL'],
        description: 'Type Rating Instructor — kann andere TR-piloten ausbilden',
      },
      {
        type: 'TRE',
        prereqs: ['ATPL'],
        description: 'Type Rating Examiner — kann TR-checks abnehmen',
      },
    ],
  },
];

// Hour-milestones für die ladder. Werte gewählt nach üblichen aviation-
// thresholds (250h = CPL-minimum, 1500h = ATPL-eligibility, etc.).
const HOUR_MILESTONES: { hours: number; emoji: string; label: string }[] = [
  { hours: 50, emoji: '🛫', label: 'First Solo' },
  { hours: 100, emoji: '🥉', label: 'Apprentice' },
  { hours: 250, emoji: '🥈', label: 'CPL-Threshold' },
  { hours: 500, emoji: '🥇', label: 'Professional' },
  { hours: 1000, emoji: '🏆', label: 'Veteran' },
  { hours: 1500, emoji: '💎', label: 'ATPL-Eligible' },
  { hours: 2500, emoji: '🌟', label: 'Senior' },
  { hours: 5000, emoji: '👑', label: 'Captain-Tier' },
  { hours: 10000, emoji: '⭐', label: 'Legend' },
];

// ─────────────────────────────────────────────────────────────────────────
// Node-status logic
// ─────────────────────────────────────────────────────────────────────────

type NodeStatus =
  | 'unlocked'      // held + ACTIVE
  | 'expired'       // held + EXPIRED
  | 'suspended'     // held + SUSPENDED
  | 'revoked'       // held + REVOKED
  | 'available'     // not held, prereqs all met
  | 'locked';       // not held, prereqs missing

interface NodeRender {
  type: LicenseType;
  status: NodeStatus;
  /** Bei held: license-record (issuedAt, expiresAt, certNumber, etc.) */
  license: {
    issuedAt: Date;
    expiresAt: Date | null;
    certificateNumber: string;
    status: LicenseStatus;
  } | null;
  prereqs: LicenseType[];
  description: string;
}

function computeStatus(
  type: LicenseType,
  licensesByType: Map<LicenseType, NodeRender['license']>,
  prereqs: LicenseType[],
): NodeStatus {
  const own = licensesByType.get(type);
  if (own) {
    switch (own.status) {
      case 'ACTIVE':
        return 'unlocked';
      case 'EXPIRED':
        return 'expired';
      case 'SUSPENDED':
        return 'suspended';
      case 'REVOKED':
        return 'revoked';
    }
  }
  // Not held — check if prereqs are all ACTIVE-held
  const prereqsMet = prereqs.every((pre) => {
    const p = licensesByType.get(pre);
    return p?.status === 'ACTIVE';
  });
  return prereqsMet ? 'available' : 'locked';
}

// ─────────────────────────────────────────────────────────────────────────
// Visual styles per status
// ─────────────────────────────────────────────────────────────────────────

const NODE_STYLES: Record<NodeStatus, string> = {
  unlocked:
    'bg-emerald-100 dark:bg-emerald-500/20 border-emerald-500 text-emerald-900 dark:text-emerald-100',
  expired:
    'bg-amber-100 dark:bg-amber-500/20 border-amber-500 text-amber-900 dark:text-amber-200',
  suspended:
    'bg-amber-100 dark:bg-amber-500/20 border-amber-600 text-amber-900 dark:text-amber-200',
  revoked:
    'bg-red-100 dark:bg-red-500/20 border-red-500 text-red-900 dark:text-red-200',
  available:
    'bg-white dark:bg-gray-900 border-indigo-400 dark:border-indigo-500 border-dashed text-gray-700 dark:text-gray-300',
  locked:
    'bg-gray-100 dark:bg-gray-900/50 border-gray-300 dark:border-gray-700 border-dashed text-gray-400 dark:text-gray-600',
};

const STATUS_ICON: Record<NodeStatus, string> = {
  unlocked: '🔓',
  expired: '⏰',
  suspended: '⏸️',
  revoked: '❌',
  available: '✨',
  locked: '🔒',
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  unlocked: 'Aktiv',
  expired: 'Abgelaufen',
  suspended: 'Suspendiert',
  revoked: 'Widerrufen',
  available: 'Verfügbar',
  locked: 'Gesperrt',
};

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PilotSkillTreePage({ params }: Props) {
  const { id: targetUserId } = await params;
  const actor = await requireAirlineManagerWithAirlinePage();

  // Multi-tenant gate: target-pilot muss in derselben airline sein.
  // Spiegelt das pattern aus /airline/pilots/[id]/page.tsx.
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      airlineId: true,
      careerEnabled: true,
      // Track 4 #92: Stats für endorsement-stickers. Denormalized
      // fields auf User (von PIREP-approval-flow maintained).
      totalFlightHours: true,
      totalFlights: true,
      rank: { select: { name: true } },
      role: { select: { name: true } },
    },
  });

  if (!target || target.airlineId !== actor.airlineId) {
    notFound();
  }

  // Lizenz-records + type-ratings + flight-hours parallel laden.
  // Flight-hours kommen aus approved PIREPs (spiegelt die berechnung
  // in /airline/aircraft listing für consistency).
  const [licenses, typeRatings, hoursAgg] = await Promise.all([
    prisma.pilotLicense.findMany({
      where: { userId: target.id },
      select: {
        type: true,
        status: true,
        issuedAt: true,
        expiresAt: true,
        certificateNumber: true,
      },
      orderBy: { issuedAt: 'asc' },
    }),
    prisma.typeRating.findMany({
      where: { userId: target.id },
      select: {
        aircraftType: true,
        obtainedAt: true,
        expiresAt: true,
        hoursOnType: true,
        lastFlownAt: true,
      },
      orderBy: { obtainedAt: 'asc' },
    }),
    prisma.pirep.aggregate({
      where: { userId: target.id, status: 'Approved' },
      _sum: { flightTimeMin: true },
      _count: { _all: true },
    }),
  ]);

  // Build license-lookup map für status-computation.
  const licensesByType = new Map<LicenseType, NodeRender['license']>();
  for (const l of licenses) {
    licensesByType.set(l.type, {
      issuedAt: l.issuedAt,
      expiresAt: l.expiresAt,
      certificateNumber: l.certificateNumber,
      status: l.status,
    });
  }

  // Compute status per tier-node.
  const tiersRendered = TIER_DEFINITIONS.map((tier) => ({
    ...tier,
    nodes: tier.nodes.map((node): NodeRender => ({
      type: node.type,
      status: computeStatus(node.type, licensesByType, node.prereqs),
      license: licensesByType.get(node.type) ?? null,
      prereqs: node.prereqs,
      description: node.description,
    })),
  }));

  const totalHours = (hoursAgg._sum.flightTimeMin ?? 0) / 60;
  const totalPireps = hoursAgg._count._all;

  // Summary-stats für banner
  const unlockedCount = Array.from(licensesByType.values()).filter(
    (l) => l?.status === 'ACTIVE',
  ).length;
  const expiredCount = Array.from(licensesByType.values()).filter(
    (l) => l?.status === 'EXPIRED',
  ).length;

  const todayMs = Date.now();
  const activeTypeRatings = typeRatings.filter(
    (tr) => !tr.expiresAt || tr.expiresAt.getTime() > todayMs,
  );
  const expiredTypeRatings = typeRatings.filter(
    (tr) => tr.expiresAt && tr.expiresAt.getTime() <= todayMs,
  );

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <Link
            href={`/airline/pilots/${target.id}`}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            ← Zurück zum Pilot
          </Link>
          <div className="mt-3 flex flex-wrap items-start gap-4">
            {target.image ? (
              <picture className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={target.image}
                  alt=""
                  className="w-20 h-20 rounded-full object-cover border border-gray-200 dark:border-gray-800"
                />
              </picture>
            ) : (
              <div
                className="w-20 h-20 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-2xl font-semibold text-gray-500 dark:text-gray-400 shrink-0"
                aria-hidden="true"
              >
                {(target.name ?? target.email ?? '?').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-3xl font-bold tracking-tight">
                {target.name ?? target.email}
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                🌳 Skill-Tree — Lizenz-Progression & Type-Ratings
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                {target.rank?.name ?? 'Kein Rank'}
                {target.role?.name && ` · ${target.role.name}`}
                {!target.careerEnabled && (
                  <span className="ml-2 text-amber-700 dark:text-amber-400">
                    ⚠️ Career-Mode deaktiviert
                  </span>
                )}
              </p>
            </div>
          </div>
        </header>

        {/* Summary banner */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <SummaryCard
            label="Lizenzen aktiv"
            value={unlockedCount.toString()}
            sublabel={`von ${TIER_DEFINITIONS.reduce(
              (sum, t) => sum + t.nodes.length,
              0,
            )} möglich`}
          />
          <SummaryCard
            label="Type-Ratings"
            value={activeTypeRatings.length.toString()}
            sublabel={
              expiredTypeRatings.length > 0
                ? `${expiredTypeRatings.length} abgelaufen`
                : 'alle gültig'
            }
            warn={expiredTypeRatings.length > 0}
          />
          <SummaryCard
            label="Flugstunden"
            value={totalHours.toFixed(1)}
            sublabel={`${totalPireps} approved PIREPs`}
          />
          <SummaryCard
            label="Abgelaufen"
            value={expiredCount.toString()}
            sublabel="Lizenzen zum erneuern"
            warn={expiredCount > 0}
          />
        </section>

        {/* Track 4 #92 (Section R): Endorsement-Stickers — achievement-
            badge-collection. Sky=license, Emerald=type-rating, Amber=
            top-hour-milestone, Purple=top-pirep-milestone. Sitzt zwischen
            summary-cards und tree weil's der celebratory-overview ist —
            erst stats (zahlen), dann achievements (was hab ich erreicht),
            dann progression-tree (was kommt noch). */}
        <section className="mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
          <h2 className="text-lg font-semibold mb-1">Endorsements</h2>
          <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
            Achievement-Sticker für aktive Lizenzen, gültige Type-Ratings
            und höchste Stunden-/Flug-Meilensteine.
          </p>
          <EndorsementStickers
            licenses={licenses}
            typeRatings={typeRatings}
            totalFlightHours={target.totalFlightHours}
            totalFlights={target.totalFlights}
          />
        </section>

        {/* Two-column grid: license-tree links, side-panels rechts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* License progression tree */}
          <section className="lg:col-span-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5 sm:p-6">
            <h2 className="text-lg font-semibold mb-1">Lizenz-Progression</h2>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-6">
              EASA-style hierarchy. Connector-lines zeigen die prereq-kette.
              Add-ons (NIGHT/IR/ME) branchen von PPL.
            </p>

            <div className="space-y-3">
              {tiersRendered.map((tier, tierIdx) => {
                const isAddOnTier = tier.label === 'Add-Ons';
                return (
                  <div key={tier.level}>
                    {/* Vertical connector vom vorigen tier — außer beim ersten */}
                    {tierIdx > 0 && (
                      <div className="flex justify-center" aria-hidden="true">
                        <div className="w-0.5 h-3 bg-gray-300 dark:bg-gray-700" />
                      </div>
                    )}

                    {/* Tier-label links + nodes-row */}
                    <div className="flex items-center gap-3">
                      <span className="w-20 shrink-0 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-500 text-right">
                        {tier.label}
                      </span>
                      <div
                        className={`flex-1 flex ${
                          isAddOnTier
                            ? 'gap-2 justify-around flex-wrap'
                            : 'justify-center'
                        }`}
                      >
                        {tier.nodes.map((node) => (
                          <LicenseNode key={node.type} node={node} />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Side-panels: type-ratings + hour-milestones */}
          <div className="space-y-6">
            {/* Type-Ratings */}
            <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
              <h2 className="text-lg font-semibold mb-1">Type-Ratings</h2>
              <p className="text-xs text-gray-500 dark:text-gray-500 mb-3">
                Aircraft-type qualifications. ⏰ = abgelaufen.
              </p>
              {typeRatings.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                  Noch keine Type-Ratings.
                </p>
              ) : (
                <ul className="space-y-2">
                  {typeRatings.map((tr) => {
                    const isExpired =
                      tr.expiresAt && tr.expiresAt.getTime() <= todayMs;
                    return (
                      <li
                        key={tr.aircraftType}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded border ${
                          isExpired
                            ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-500/30'
                            : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-500/30'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-mono font-bold">
                            {tr.aircraftType}
                          </div>
                          <div className="text-[11px] text-gray-600 dark:text-gray-400">
                            {tr.hoursOnType.toFixed(1)} h on type
                            {tr.lastFlownAt && (
                              <>
                                {' · '}
                                zuletzt{' '}
                                {tr.lastFlownAt.toLocaleDateString('de-DE')}
                              </>
                            )}
                          </div>
                        </div>
                        <div className="text-right text-[11px] shrink-0">
                          <div
                            className={
                              isExpired
                                ? 'text-amber-700 dark:text-amber-400 font-semibold'
                                : 'text-emerald-700 dark:text-emerald-400'
                            }
                          >
                            {isExpired ? '⏰ Abgelaufen' : '✓ Gültig'}
                          </div>
                          {tr.expiresAt && (
                            <div className="text-gray-500 dark:text-gray-500">
                              bis {tr.expiresAt.toLocaleDateString('de-DE')}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Hour-Milestones ladder */}
            <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
              <h2 className="text-lg font-semibold mb-1">
                Stunden-Meilensteine
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-500 mb-3">
                Career-progression nach flugstunden. Aktuell:{' '}
                <span className="font-mono font-semibold">
                  {totalHours.toFixed(1)} h
                </span>
              </p>
              <ol className="space-y-1.5">
                {HOUR_MILESTONES.map((ms) => {
                  const reached = totalHours >= ms.hours;
                  const nextNotReached =
                    !reached &&
                    HOUR_MILESTONES.findIndex(
                      (m) => totalHours < m.hours,
                    ) ===
                      HOUR_MILESTONES.indexOf(ms);
                  return (
                    <li
                      key={ms.hours}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${
                        reached
                          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-100'
                          : nextNotReached
                            ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-900 dark:text-indigo-100 border border-indigo-300 dark:border-indigo-500/40 border-dashed'
                            : 'text-gray-400 dark:text-gray-600'
                      }`}
                    >
                      <span aria-hidden="true" className="text-base">
                        {reached ? ms.emoji : '·'}
                      </span>
                      <span className="font-mono font-semibold text-xs">
                        {ms.hours.toLocaleString('de-DE')} h
                      </span>
                      <span className="flex-1 text-xs">{ms.label}</span>
                      {reached && (
                        <span
                          className="text-emerald-600 dark:text-emerald-400 text-xs"
                          aria-label="erreicht"
                        >
                          ✓
                        </span>
                      )}
                      {nextNotReached && (
                        <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono">
                          +{(ms.hours - totalHours).toFixed(0)} h
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        </div>

        {/* Legend footer */}
        <aside className="mt-8 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400">
          <p className="font-medium text-gray-700 dark:text-gray-300 mb-2">
            Legende
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            {(
              ['unlocked', 'available', 'locked', 'expired', 'suspended', 'revoked'] as NodeStatus[]
            ).map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span aria-hidden="true">{STATUS_ICON[s]}</span>
                <span>{STATUS_LABEL[s]}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs">
            Diese view ist read-only. Lizenzen ausstellen, widerrufen oder
            verlängern auf der{' '}
            <Link
              href={`/airline/pilots/${target.id}`}
              className="text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Pilot-Detailseite
            </Link>
            . Prereq-rules sind vereinfacht (echte ICAO-anforderungen wie
            stunden-thresholds für ATPL/CPL sind nicht visualisiert).
          </p>
        </aside>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function LicenseNode({ node }: { node: NodeRender }) {
  const style = NODE_STYLES[node.status];
  const icon = STATUS_ICON[node.status];
  const label = STATUS_LABEL[node.status];
  return (
    <div
      className={`w-32 px-2 py-2 rounded-lg border-2 ${style} text-center transition`}
      title={node.description}
    >
      <div className="text-[10px] uppercase tracking-wide opacity-60 flex items-center justify-center gap-1">
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="font-mono font-bold text-base mt-0.5">
        {licenseDisplayName(node.type)}
      </div>
      {node.license && (
        <div className="text-[10px] mt-0.5 opacity-75">
          {node.license.expiresAt ? (
            <>
              bis {node.license.expiresAt.toLocaleDateString('de-DE')}
            </>
          ) : (
            <>seit {node.license.issuedAt.toLocaleDateString('de-DE')}</>
          )}
        </div>
      )}
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  sublabel: string;
  warn?: boolean;
}

function SummaryCard({ label, value, sublabel, warn }: SummaryCardProps) {
  return (
    <div
      className={`bg-white dark:bg-gray-900 border rounded-lg p-4 ${
        warn
          ? 'border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10'
          : 'border-gray-200 dark:border-gray-800'
      }`}
    >
      <p
        className={`text-xs uppercase tracking-wide font-medium ${
          warn
            ? 'text-amber-700 dark:text-amber-400'
            : 'text-gray-500 dark:text-gray-400'
        }`}
      >
        {label}
      </p>
      <p
        className={`text-2xl font-bold font-mono mt-1 ${
          warn ? 'text-amber-900 dark:text-amber-200' : ''
        }`}
      >
        {value}
      </p>
      <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">
        {sublabel}
      </p>
    </div>
  );
}
