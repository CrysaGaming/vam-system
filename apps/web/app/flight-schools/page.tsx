import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma, licenseDisplayName, type LicenseType } from '@vam/db';

/**
 * Pilot-side flight-school browse-page (Welle 13E-12).
 *
 * Read-only liste aller AKTIVEN Flight-Schools im system. Pilot wählt
 * eine schule + license-typ aus und kann sich dann auf der detail-page
 * einschreiben (kommt im next sub-commit). MVP-funktion ohne search/
 * filter — bei aktuellem dataset (vermutlich <50 schulen) ist die
 * gesamt-liste übersichtlich.
 *
 * Gating: hasCareer required (mirror of /licenses page-gating, siehe
 * 13D-3-pattern). Direkter URL-zugriff ohne career-toggles → redirect
 * auf /settings#profile damit der pilot weiß wo er das aktivieren kann.
 *
 * Sortierung: rating-DESC (beste schulen oben), dann airport-icao-ASC,
 * dann name-ASC. Inactive-schools werden gar nicht gefetcht — die sieht
 * nur der system-admin in /admin/flight-schools.
 *
 * UI-density-ziel: pilot sieht auf einen blick:
 *   - wer (name, rating)
 *   - wo (airport-code + city)
 *   - was wird angeboten (license-typen als tag-liste)
 *   - was kostet das ungefähr (theory + air rates)
 * Detail-page (/flight-schools/[id]) hat dann description + enrollment.
 */
export default async function FlightSchoolsBrowsePage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { airline: { select: { careerEnabled: true } } },
  });

  if (!user) redirect('/');

  // Career-gating wie in /licenses und /wallet — beide flags müssen ON
  // sein. Redirect-target ist /settings#profile damit der pilot direkt
  // die opt-in-toggles sieht (CareerCard im profile-tab).
  const hasCareer = !!(user.careerEnabled && user.airline?.careerEnabled);
  if (!hasCareer) {
    redirect('/settings#profile');
  }

  const [schools, activeEnrollments] = await Promise.all([
    prisma.flightSchool.findMany({
      where: { active: true },
      include: {
        airport: { select: { name: true, city: true, country: true } },
        _count: { select: { enrollments: true } },
      },
      orderBy: [
        { rating: 'desc' },
        { airportIcao: 'asc' },
        { name: 'asc' },
      ],
    }),
    // Pilot sieht auf der page auch welche enrollments er bereits hat.
    // Status IN_PROGRESS/EXAM_SCHEDULED zählt als "noch laufend" — abgeschlossene
    // (PASSED/FAILED/WITHDRAWN) zeigen wir hier nicht; die sind in /licenses
    // bzw. der detail-page einzusehen.
    prisma.flightSchoolEnrollment.findMany({
      where: {
        userId: user.id,
        status: { in: ['IN_PROGRESS', 'EXAM_SCHEDULED'] },
      },
      include: {
        school: { select: { id: true, name: true, airportIcao: true } },
      },
      orderBy: { enrolledAt: 'desc' },
    }),
  ]);

  return (
    <main className="px-6 py-8 sm:px-10 lg:px-12 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Flugschulen</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Wähle eine Flugschule, um eine neue Pilot-Lizenz zu erwerben. Jede
          Schule hat eigene Tarife, Rating und angebotene Lizenzen.
        </p>
      </header>

      {/* Active enrollments — wenn der pilot grade in einem training ist,
          ist DAS die wichtigste info auf dieser page. Prominent oben. */}
      {activeEnrollments.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold mb-2">
            Aktuelle Trainings ({activeEnrollments.length})
          </h2>
          <div className="bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-500/30 rounded-lg divide-y divide-gray-200 dark:divide-gray-800">
            {activeEnrollments.map((e) => (
              <Link
                key={e.id}
                href={`/flight-schools/${e.school.id}`}
                className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-sm">
                    {licenseDisplayName(e.licenseType)} ·{' '}
                    <span className="text-gray-500 dark:text-gray-400 font-normal">
                      {e.school.name}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    <span className="font-mono">{e.school.airportIcao}</span> ·{' '}
                    Theorie {e.hoursTheory.toFixed(1)}h · Praxis{' '}
                    {e.hoursPractical.toFixed(1)}h · Sim {e.hoursSim.toFixed(1)}h
                  </p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 font-semibold uppercase tracking-wider shrink-0">
                  {e.status === 'IN_PROGRESS' ? 'Laufend' : 'Prüfung'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* All active schools — main browse-list */}
      <section>
        <h2 className="text-base font-semibold mb-2">
          Alle Flugschulen ({schools.length})
        </h2>
        {schools.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-12 text-center">
            <p className="text-3xl mb-2" aria-hidden="true">
              🎓
            </p>
            <p className="text-sm font-semibold mb-1">
              Aktuell sind keine Flugschulen verfügbar
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">
              Frag einen System-Admin, ob Flight-Schools angelegt werden können.
              Sobald welche aktiv sind, erscheinen sie hier.
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {schools.map((s) => (
              <SchoolCard key={s.id} school={s} />
            ))}
          </div>
        )}
      </section>

      <p className="mt-8 text-xs text-gray-500 dark:text-gray-500 text-center">
        Career-System verwalten in den{' '}
        <Link
          href="/settings#profile"
          className="underline hover:text-gray-700 dark:hover:text-gray-300"
        >
          Profil-Einstellungen
        </Link>
        .
      </p>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

interface SchoolCardData {
  id: string;
  name: string;
  airportIcao: string;
  rating: number;
  offeredLicenses: LicenseType[];
  hourlyRateGround: { toString(): string };
  hourlyRateAir: { toString(): string };
  hourlyRateSim: { toString(): string } | null;
  description: string | null;
  airport: {
    name: string;
    city: string | null;
    country: string | null;
  };
  _count: { enrollments: number };
}

function SchoolCard({ school }: { school: SchoolCardData }) {
  return (
    <Link
      href={`/flight-schools/${school.id}`}
      className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-sm transition"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-base text-gray-900 dark:text-white truncate">
            {school.name}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            <span className="font-mono font-semibold">{school.airportIcao}</span>{' '}
            · {school.airport.name}
            {school.airport.city ? `, ${school.airport.city}` : ''}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
            ★ {school.rating.toFixed(1)}
          </p>
          <p className="text-[10px] text-gray-500 dark:text-gray-500 uppercase tracking-wider mt-0.5">
            {school._count.enrollments}{' '}
            {school._count.enrollments === 1 ? 'Pilot' : 'Pilots'}
          </p>
        </div>
      </div>

      {/* License-tags — max 5 sichtbar, danach +N. Pilot soll auf einen
          blick sehen ob seine gewünschte license dabei ist. */}
      <div className="flex flex-wrap gap-1 mb-3">
        {school.offeredLicenses.slice(0, 5).map((lic) => (
          <span
            key={lic}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
          >
            {lic}
          </span>
        ))}
        {school.offeredLicenses.length > 5 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
            +{school.offeredLicenses.length - 5}
          </span>
        )}
      </div>

      {/* Tarife-mini-grid. theory + flug sind immer da, sim optional. */}
      <div className="grid grid-cols-3 gap-2 text-xs border-t border-gray-200 dark:border-gray-800 pt-2">
        <div>
          <p className="text-gray-500 dark:text-gray-500 uppercase text-[10px] tracking-wider">
            Theorie
          </p>
          <p className="font-mono font-semibold mt-0.5">
            {Number(school.hourlyRateGround).toFixed(0)} VAM$/h
          </p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-500 uppercase text-[10px] tracking-wider">
            Flug
          </p>
          <p className="font-mono font-semibold mt-0.5">
            {Number(school.hourlyRateAir).toFixed(0)} VAM$/h
          </p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-500 uppercase text-[10px] tracking-wider">
            Sim
          </p>
          <p className="font-mono font-semibold mt-0.5">
            {school.hourlyRateSim
              ? `${Number(school.hourlyRateSim).toFixed(0)} VAM$/h`
              : '—'}
          </p>
        </div>
      </div>
    </Link>
  );
}
