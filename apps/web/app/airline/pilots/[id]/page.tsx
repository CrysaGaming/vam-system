import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import {
  prisma,
  getUserLicenses,
  getUserTypeRatings,
  licenseDisplayName,
  type LicenseType,
  type LicenseStatus,
} from '@vam/db';
import Link from 'next/link';
import { LicenseGrantForm, LicenseRowActions } from './license-management';
import {
  TypeRatingGrantForm,
  TypeRatingRowActions,
} from './type-rating-management';

/**
 * Welle 13E-6 — Pilot-detail-page für admins.
 *
 * Erste detail-page unter /airline/pilots/[id]. Im MVP ausschließlich
 * für license + type-rating management. Forward-compatible: spätere
 * Wellen können hier weitere admin-tools hinzufügen (per-pilot-history,
 * performance-analyse, manuelle PIREP-corrections, etc).
 *
 * Auth-gate: AIRLINE_MANAGER_ROLES (admin | airline-admin | instructor).
 * Plus: target-user muss member der actor-airline sein. Spiegelt die
 * scope-policy in actions.ts requireSameAirline().
 *
 * Zeigt:
 *   - Pilot-header: avatar, name, role, rank, email, joined-date
 *   - Lizenzen-section: liste aller licenses mit row-actions, plus
 *     grant-form unten
 *   - Type-Ratings-section: liste aller type-ratings mit row-actions,
 *     plus grant-form unten
 *
 * Out-of-scope:
 *   - Career-flag-toggle (admin kann nicht direkt im pilot-namen den
 *     career-toggle setzen — das ist user-self-service, ähnlich wie
 *     bei economy)
 *   - Historie der grant/revoke-actions (audit-log-tabelle existiert
 *     noch nicht; kommt später)
 */
export default async function PilotDetailPage({
  params,
}: {
  // Next.js 16: params ist jetzt ein Promise wie searchParams.
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const actor = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  const allowedRoles = ['admin', 'airline-admin', 'instructor'];
  if (
    !actor?.role ||
    !allowedRoles.includes(actor.role.name) ||
    !actor.airlineId
  ) {
    redirect('/dashboard');
  }

  const { id: pilotId } = await params;

  const pilot = await prisma.user.findUnique({
    where: { id: pilotId },
    include: {
      role: { select: { name: true } },
      rank: { select: { name: true } },
      airline: { select: { name: true, icao: true, careerEnabled: true } },
    },
  });

  // Scope-check: pilot existiert UND ist in derselben airline wie der actor.
  // Wenn nicht: 404 (statt 403 — wir leaken nicht ob die ID generell
  // existiert).
  if (!pilot || pilot.airlineId !== actor.airlineId) {
    notFound();
  }

  // Parallele queries für licenses + type-ratings.
  const [licenses, typeRatings] = await Promise.all([
    getUserLicenses(pilotId),
    getUserTypeRatings(pilotId),
  ]);

  const active = licenses.filter((l) => l.status === 'ACTIVE');
  const inactive = licenses.filter((l) => l.status !== 'ACTIVE');

  return (
    <main className="px-6 py-8 sm:px-10 lg:px-12 max-w-6xl mx-auto">
      {/* Breadcrumb back to personnel-list */}
      <nav className="mb-4 text-sm">
        <Link
          href="/airline/pilots"
          className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition"
        >
          ← Zurück zur Personnel-Übersicht
        </Link>
      </nav>

      {/* Pilot-header card */}
      <div className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
        <div className="flex items-start gap-4">
          {pilot.image ? (
            <picture>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pilot.image}
                alt={pilot.name ?? 'Pilot avatar'}
                className="w-16 h-16 rounded-full border border-gray-300 dark:border-gray-700 shrink-0"
              />
            </picture>
          ) : (
            <div className="w-16 h-16 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold mb-1 truncate">
              {pilot.name ?? 'Unbenannter Pilot'}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
              {pilot.email}
            </p>
            <div className="flex flex-wrap gap-2 mt-2 text-xs">
              {pilot.rank && (
                <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 font-semibold">
                  {pilot.rank.name}
                </span>
              )}
              {pilot.role && (
                <span className="px-2 py-0.5 rounded bg-purple-500/15 text-purple-700 dark:text-purple-300 font-semibold">
                  {pilot.role.name}
                </span>
              )}
              <span className="px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                {pilot.totalFlightHours.toFixed(1)}h • {pilot.totalFlights} Flüge
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Career-flag warning — wenn admin licenses vergibt aber career-system
          ist auf airline-ebene noch nicht aktiviert, ist das unwirksam. */}
      {!pilot.airline?.careerEnabled && (
        <div className="mb-6 px-4 py-3 rounded-lg border bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 text-sm">
          ⚠️ Career-System ist auf Airline-Ebene <strong>nicht aktiviert</strong>.
          Vergebene Lizenzen werden gespeichert aber nicht im booking-flow
          geprüft (canPilotFlyAircraft). Aktiviere das Career-System in den{' '}
          <Link href="/airline" className="underline font-semibold">
            Airline-Einstellungen
          </Link>
          .
        </div>
      )}

      {/* Lizenzen-section. Active-licenses werden als full-width cards
          gerendert weil pro license auch action-buttons sichtbar sein
          müssen (suspend/revoke). Inactive-licenses werden gedimmt unten
          gelistet als audit-trail. */}
      <section className="mb-8">
        <header className="mb-3">
          <h2 className="text-lg font-semibold">Lizenzen</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Verwalte die PilotLicenses dieses Piloten. Vergeben, suspendieren,
            widerrufen oder reaktivieren.
          </p>
        </header>

        {active.length === 0 && inactive.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 italic">
            Pilot hat noch keine Lizenzen.
          </p>
        ) : (
          <div className="space-y-3 mb-4">
            {active.map((lic) => (
              <LicenseRowDisplay key={lic.id} license={lic} userId={pilotId} />
            ))}
            {inactive.length > 0 && (
              <>
                <p className="text-xs uppercase tracking-wider text-gray-500 mt-4 mb-2">
                  Audit-Trail (inaktiv)
                </p>
                {inactive.map((lic) => (
                  <LicenseRowDisplay
                    key={lic.id}
                    license={lic}
                    userId={pilotId}
                    dimmed
                  />
                ))}
              </>
            )}
          </div>
        )}

        <LicenseGrantForm userId={pilotId} />
      </section>

      {/* Type-Ratings-section. Selbe layout-philosophie wie licenses, aber
          ohne dimmed-section weil type-ratings hard-deleted sind (kein
          audit-trail im record). */}
      <section className="mb-8">
        <header className="mb-3">
          <h2 className="text-lg font-semibold">Type Ratings</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Aircraft-spezifische qualifikationen mit recurrent-checks (12
            monate) und hours-on-type tracking.
          </p>
        </header>

        {typeRatings.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 italic">
            Pilot hat noch keine Type-Ratings.
          </p>
        ) : (
          <div className="space-y-3 mb-4">
            {typeRatings.map((tr) => (
              <TypeRatingRowDisplay
                key={tr.id}
                rating={tr}
                userId={pilotId}
              />
            ))}
          </div>
        )}

        <TypeRatingGrantForm userId={pilotId} />
      </section>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Server-rendered display rows (with embedded client-action buttons)
// ─────────────────────────────────────────────────────────────────────────

interface LicenseRowProps {
  license: {
    id: string;
    type: LicenseType;
    status: LicenseStatus;
    certificateNumber: string;
    issuedAt: Date;
    expiresAt: Date | null;
    notes: string | null;
  };
  userId: string;
  dimmed?: boolean;
}

function LicenseRowDisplay({ license, userId, dimmed = false }: LicenseRowProps) {
  return (
    <div
      className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 ${
        dimmed ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 mb-1 flex-wrap">
            <h3 className="text-base font-semibold">
              {licenseDisplayName(license.type)}
            </h3>
            <StatusBadge status={license.status} />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
            {license.certificateNumber}
          </p>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 text-right shrink-0">
          <p>Ausgestellt: {formatDate(license.issuedAt)}</p>
          {license.expiresAt ? (
            <p className="mt-0.5">Gültig bis: {formatDate(license.expiresAt)}</p>
          ) : (
            <p className="mt-0.5 italic">Lifetime</p>
          )}
        </div>
      </div>
      {license.notes && (
        <p className="my-2 pt-2 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-500 whitespace-pre-line font-mono">
          {license.notes}
        </p>
      )}
      <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
        <LicenseRowActions
          licenseId={license.id}
          userId={userId}
          status={license.status}
        />
      </div>
    </div>
  );
}

interface TypeRatingDisplayProps {
  rating: {
    id: string;
    aircraftType: string;
    obtainedAt: Date;
    expiresAt: Date | null;
    hoursOnType: number;
    lastFlownAt: Date | null;
  };
  userId: string;
}

function TypeRatingRowDisplay({ rating, userId }: TypeRatingDisplayProps) {
  const isExpired = rating.expiresAt && rating.expiresAt < new Date();
  const cutoff = new Date(Date.now() - 90 * 86_400_000);
  const recencyExpired = rating.lastFlownAt && rating.lastFlownAt < cutoff;

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 mb-1 flex-wrap">
            <h3 className="text-base font-semibold font-mono">
              {rating.aircraftType}
            </h3>
            {isExpired && (
              <span className="px-2 py-0.5 text-[10px] uppercase tracking-wider rounded bg-red-500/15 text-red-700 dark:text-red-300 font-semibold">
                Expired
              </span>
            )}
            {!isExpired && recencyExpired && (
              <span className="px-2 py-0.5 text-[10px] uppercase tracking-wider rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold">
                Recency lapsed
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <span className="font-semibold">
              {rating.hoursOnType.toFixed(1)} h
            </span>{' '}
            auf type
          </p>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 text-right shrink-0">
          <p>Erworben: {formatDate(rating.obtainedAt)}</p>
          {rating.expiresAt ? (
            <p className="mt-0.5">
              Gültig bis: {formatDate(rating.expiresAt)}
            </p>
          ) : (
            <p className="mt-0.5 italic">Lifetime</p>
          )}
          {rating.lastFlownAt && (
            <p className="mt-0.5">
              Zuletzt geflogen: {formatDate(rating.lastFlownAt)}
            </p>
          )}
        </div>
      </div>
      <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
        <TypeRatingRowActions ratingId={rating.id} userId={userId} />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: LicenseStatus }) {
  const config: Record<LicenseStatus, { label: string; classes: string }> = {
    ACTIVE: {
      label: 'Aktiv',
      classes: 'bg-green-500/15 text-green-700 dark:text-green-300',
    },
    EXPIRED: {
      label: 'Abgelaufen',
      classes: 'bg-gray-500/15 text-gray-700 dark:text-gray-400',
    },
    REVOKED: {
      label: 'Widerrufen',
      classes: 'bg-red-500/15 text-red-700 dark:text-red-300',
    },
    SUSPENDED: {
      label: 'Suspendiert',
      classes: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    },
  };
  const c = config[status];
  return (
    <span
      className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded font-semibold ${c.classes}`}
    >
      {c.label}
    </span>
  );
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}
