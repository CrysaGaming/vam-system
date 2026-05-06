import { notFound  } from 'next/navigation';
import {
  prisma,
  getUserLicenses,
  getUserTypeRatings,
  licenseDisplayName,
  type LicenseType,
  type LicenseStatus,
} from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { LicenseGrantForm } from './license-grant-form';
import { LicenseActions, TypeRatingActions } from './license-actions';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Welle 13E-6 — Pilot detail page für admin license-management.
 *
 * Routen:
 *   GET /airline/pilots/[id]
 *
 * Auth-gate: AIRLINE_MANAGER_ROLES + target-pilot muss in derselben airline
 * sein wie der actor (multi-tenant-isolation).
 *
 * Sections:
 *   - Pilot-info-block: avatar, name, rank, role, hours
 *   - Grant-form: combined license + type-rating grant (client-component)
 *   - Active licenses: liste mit per-row revoke/suspend buttons
 *   - Type ratings: liste mit per-row extend/remove buttons
 *   - Inactive licenses: REVOKED/EXPIRED/SUSPENDED audit-trail mit
 *     reinstate-buttons
 *
 * Out-of-scope für 13E-6:
 *   - Bulk-grant (mehrere licenses gleichzeitig vergeben)
 *   - License-history-timeline view
 *   - Performance-stats des pilots (gibt's auf /airline/pilots schon)
 *   - Booking-history (kommt mit 13E-7 booking-gate eventuell)
 */
export default async function PilotDetailPage({ params }: PageProps) {
  const { id: targetUserId } = await params;

  const actor = await requireAirlineManagerWithAirlinePage();
  // Target-pilot lookup mit multi-tenant-scope. Wenn target nicht in actor's
  // airline ist, returnen wir 404 statt 403 — wir wollen nicht leaken dass
  // der pilot in einer anderen airline existiert.
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: {
      role: { select: { name: true } },
      rank: { select: { name: true } },
      airline: { select: { id: true, name: true, careerEnabled: true } },
    },
  });

  if (!target || target.airlineId !== actor.airlineId) {
    notFound();
  }

  // Career-flag-info: airline kann career-toggle off haben, dann sind die
  // licenses zwar persistent aber haben keinen booking-effect. Wir zeigen
  // einen banner damit admin den status sieht.
  const careerActive = target.airline?.careerEnabled === true;

  // Parallele queries für licenses + type-ratings
  const [allLicenses, typeRatings] = await Promise.all([
    getUserLicenses(targetUserId),
    getUserTypeRatings(targetUserId),
  ]);

  const active = allLicenses.filter((l) => l.status === 'ACTIVE');
  const inactive = allLicenses.filter((l) => l.status !== 'ACTIVE');

  const existingLicenseTypes = allLicenses
    .filter((l) => l.status === 'ACTIVE' || l.status === 'SUSPENDED')
    .map((l) => l.type);
  const existingTypeRatings = typeRatings.map((tr) => tr.aircraftType);

  return (
    <main className="px-6 py-8 sm:px-10 lg:px-12 max-w-6xl mx-auto">
      {/* Breadcrumb-back-link */}
      <nav className="mb-4">
        <Link
          href="/airline/pilots"
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition"
        >
          ← Personal-Übersicht
        </Link>
      </nav>

      {/* Pilot-info-block */}
      <header className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
        <div className="flex items-start gap-4">
          {target.image ? (
            <picture>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={target.image}
                alt={target.name ?? 'Avatar'}
                className="w-16 h-16 rounded-full border border-gray-300 dark:border-gray-700 shrink-0"
              />
            </picture>
          ) : (
            <div className="w-16 h-16 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold mb-1 truncate">
              {target.name ?? 'Pilot'}
            </h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
              {target.email && (
                <span className="font-mono text-xs">{target.email}</span>
              )}
              {target.rank?.name && (
                <span>
                  <span className="text-gray-500">Rang:</span> {target.rank.name}
                </span>
              )}
              {target.role?.name && (
                <span>
                  <span className="text-gray-500">Rolle:</span> {target.role.name}
                </span>
              )}
              <span>
                <span className="text-gray-500">Stunden:</span>{' '}
                {target.totalFlightHours.toFixed(1)} h
              </span>
              <span>
                <span className="text-gray-500">Flüge:</span> {target.totalFlights}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Career-flag-banner: wenn airline.careerEnabled false ist, ist
          das management hier theoretisch unwirksam (booking-gate prüft
          den flag). Wir warnen statt zu blockieren — admin kann licenses
          vor der aktivierung schon vergeben. */}
      {!careerActive && (
        <div className="mb-6 px-4 py-3 rounded-lg border bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 text-sm">
          <p className="font-semibold mb-1">⚠️ Career-System für diese Airline deaktiviert</p>
          <p className="text-xs">
            Vergebene Lizenzen bleiben persistent in der DB, aber der booking-gate
            (Welle 13E-7) prüft sie nicht. Admin kann{' '}
            <Link href="/airline" className="underline hover:no-underline">
              das Career-System in den Airline-Einstellungen aktivieren
            </Link>
            .
          </p>
        </div>
      )}

      {/* 2-column grid: grant-form left, current state right. md+ side-by-
          side; mobile stacked. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="md:col-span-1">
          <LicenseGrantForm
            userId={targetUserId}
            existingLicenseTypes={existingLicenseTypes}
            existingTypeRatings={existingTypeRatings}
          />
        </div>

        <div className="md:col-span-2 space-y-6">
          <Section title="Aktive Lizenzen" subtitle="Status: ACTIVE">
            {active.length === 0 ? (
              <EmptyState text="Keine aktiven Lizenzen — über das Formular links neue vergeben." />
            ) : (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-200 dark:divide-gray-800">
                {active.map((lic) => (
                  <LicenseRow key={lic.id} license={lic} userId={targetUserId} />
                ))}
              </div>
            )}
          </Section>

          <Section title="Type Ratings" subtitle="Aircraft-spezifische Qualifikationen">
            {typeRatings.length === 0 ? (
              <EmptyState text="Keine Type-Ratings — über das Formular links neue vergeben." />
            ) : (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-200 dark:divide-gray-800">
                {typeRatings.map((tr) => (
                  <TypeRatingRow key={tr.id} rating={tr} userId={targetUserId} />
                ))}
              </div>
            )}
          </Section>

          {inactive.length > 0 && (
            <Section
              title="Inaktive Lizenzen"
              subtitle="Audit-trail: REVOKED, EXPIRED, SUSPENDED"
            >
              <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-200 dark:divide-gray-800">
                {inactive.map((lic) => (
                  <LicenseRow
                    key={lic.id}
                    license={lic}
                    userId={targetUserId}
                    dimmed
                  />
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-5 text-center">
      <p className="text-xs text-gray-500 dark:text-gray-400">{text}</p>
    </div>
  );
}

interface LicenseRowData {
  id: string;
  type: LicenseType;
  status: LicenseStatus;
  certificateNumber: string;
  issuedAt: Date;
  expiresAt: Date | null;
  notes: string | null;
}

function LicenseRow({
  license,
  userId,
  dimmed = false,
}: {
  license: LicenseRowData;
  userId: string;
  dimmed?: boolean;
}) {
  return (
    <div className={`p-4 ${dimmed ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 mb-1 flex-wrap">
            <h3 className="text-sm font-semibold">{licenseDisplayName(license.type)}</h3>
            <StatusBadge status={license.status} />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
            {license.certificateNumber}
          </p>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 text-right shrink-0">
          <p>Ausgestellt: {formatDate(license.issuedAt)}</p>
          {license.expiresAt ? (
            <p className="mt-0.5">Bis: {formatDate(license.expiresAt)}</p>
          ) : (
            <p className="mt-0.5 italic">Kein Ablauf</p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {license.notes && (
          <p className="flex-1 min-w-0 text-xs text-gray-500 dark:text-gray-500 whitespace-pre-line font-mono leading-relaxed">
            {license.notes}
          </p>
        )}
        <LicenseActions
          licenseId={license.id}
          userId={userId}
          status={license.status}
        />
      </div>
    </div>
  );
}

interface TypeRatingRowData {
  id: string;
  aircraftType: string;
  obtainedAt: Date;
  expiresAt: Date | null;
  hoursOnType: number;
  lastFlownAt: Date | null;
  notes: string | null;
}

function TypeRatingRow({
  rating,
  userId,
}: {
  rating: TypeRatingRowData;
  userId: string;
}) {
  const isExpired = !!rating.expiresAt && rating.expiresAt < new Date();

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 mb-1 flex-wrap">
            <h3 className="text-sm font-semibold font-mono">{rating.aircraftType}</h3>
            {isExpired && (
              <span className="px-2 py-0.5 text-[10px] uppercase tracking-wider rounded bg-red-500/15 text-red-700 dark:text-red-300 font-semibold">
                Expired
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <span className="font-semibold">{rating.hoursOnType.toFixed(1)} h</span> auf type
          </p>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 text-right shrink-0">
          <p>Erworben: {formatDate(rating.obtainedAt)}</p>
          {rating.expiresAt ? (
            <p className="mt-0.5">Bis: {formatDate(rating.expiresAt)}</p>
          ) : (
            <p className="mt-0.5 italic">Lifetime</p>
          )}
          {rating.lastFlownAt && (
            <p className="mt-0.5">Zuletzt: {formatDate(rating.lastFlownAt)}</p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {rating.notes && (
          <p className="flex-1 min-w-0 text-xs text-gray-500 dark:text-gray-500 whitespace-pre-line font-mono leading-relaxed">
            {rating.notes}
          </p>
        )}
        <TypeRatingActions
          ratingId={rating.id}
          userId={userId}
          isExpired={isExpired}
        />
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
