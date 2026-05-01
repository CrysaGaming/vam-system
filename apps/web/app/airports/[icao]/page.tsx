import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';

/**
 * Airport Detail Page — vollständige info für einen einzelnen airport.
 *
 * Routing: /airports/[icao] — ICAO ist case-insensitive (URL kann lowercase
 * sein, wir normalisieren zu upper für den DB-lookup). 404 wenn unbekannt.
 *
 * Datenmodell: lädt airport + alle relations (runways/frequencies/navaids)
 * plus aggregate-counts für routes/pireps. Eine query mit include statt
 * 4 separate queries — N+1-frei und auch bei 50+ runways noch schnell weil
 * alles indexiert (siehe schema.prisma Runway/AirportFrequency/Navaid indexes).
 *
 * Layout-prinzip: lange scroll-page mit klar getrennten sections statt
 * tabs/accordions. Bei airport-data ist alles gleich-wichtig, splitting
 * würde nur klick-friction erzeugen. Mobile-friendly via max-w-Container
 * und responsive grid-cols.
 *
 * Access: any logged-in user. Airports sind global-shared catalog.
 */

// Type-emoji-mapping wie in airport-browser.tsx — gleicher visual-vocab.
const TYPE_LABELS: Record<string, { emoji: string; label: string }> = {
  large_airport: { emoji: '🛬', label: 'Large Airport' },
  medium_airport: { emoji: '✈️', label: 'Medium Airport' },
  small_airport: { emoji: '🛩️', label: 'Small Airport' },
  heliport: { emoji: '🚁', label: 'Heliport' },
  seaplane_base: { emoji: '🌊', label: 'Seaplane Base' },
  balloonport: { emoji: '🎈', label: 'Balloonport' },
  closed: { emoji: '🚫', label: 'Closed' },
};

const CONTINENT_LABELS: Record<string, string> = {
  NA: 'Nordamerika',
  SA: 'Südamerika',
  EU: 'Europa',
  AS: 'Asien',
  AF: 'Afrika',
  OC: 'Ozeanien',
  AN: 'Antarktis',
};

// Frequency-type labels — OurAirports-vocab in human-readable form.
const FREQ_TYPE_LABELS: Record<string, string> = {
  TWR: 'Tower',
  GND: 'Ground',
  APP: 'Approach',
  DEP: 'Departure',
  ATIS: 'ATIS',
  AWOS: 'AWOS (Wetter)',
  ASOS: 'ASOS (Wetter)',
  CTAF: 'CTAF',
  UNICOM: 'UNICOM',
  MULTICOM: 'MULTICOM',
  ARCAL: 'ARCAL',
  CLD: 'Clearance Delivery',
  RMP: 'Ramp',
  EMRG: 'Emergency',
  FSS: 'Flight Service Station',
};

// Surface-codes — OurAirports verwendet kurze codes wie ASPH, CONC, GRASS.
const SURFACE_LABELS: Record<string, string> = {
  ASPH: 'Asphalt',
  CONC: 'Beton',
  GRASS: 'Gras',
  GRAVEL: 'Schotter',
  WATER: 'Wasser',
  DIRT: 'Erde',
  SAND: 'Sand',
  SNOW: 'Schnee',
  ICE: 'Eis',
  TURF: 'Rasen',
  GRVL: 'Schotter',
  ASPH_GRVL: 'Asphalt/Schotter',
  ASPH_TURF: 'Asphalt/Rasen',
};

export default async function AirportDetailPage({
  params,
}: {
  params: Promise<{ icao: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  const { icao: rawIcao } = await params;
  const icao = rawIcao.toUpperCase();

  // Single query mit allen relations + count-aggregates. include + _count
  // ist hier billiger als 4 round-trips weil der Postgres-planner einen
  // einzigen JOIN-plan baut.
  const airport = await prisma.airport.findUnique({
    where: { icao },
    include: {
      // Runways: closed unten, längste oben — typisches piloten-interest-
      // ranking (welche bahn ist die längste/aktivste?).
      runways: {
        orderBy: [{ closed: 'asc' }, { lengthFt: 'desc' }],
      },
      // Frequencies: nach type sortiert (TWR vor GND vor APP — alphabetisch
      // ergibt zufällig sinnvolle reihenfolge), dann nach freq.
      frequencies: {
        orderBy: [{ type: 'asc' }, { frequencyMhz: 'asc' }],
      },
      navaids: {
        orderBy: [{ type: 'asc' }, { ident: 'asc' }],
      },
      verifiedBy: { select: { id: true, name: true } },
      _count: {
        select: {
          routesFrom: true,
          routesTo: true,
          pirepsFrom: true,
          pirepsTo: true,
        },
      },
    },
  });

  if (!airport) {
    notFound();
  }

  const typeMeta = airport.type ? TYPE_LABELS[airport.type] : null;
  const continentLabel = airport.continent
    ? CONTINENT_LABELS[airport.continent] ?? airport.continent
    : null;

  // OpenStreetMap deep-link mit zoom-level 14 (~stadt-grenze) — gibt einen
  // klickbaren marker auf den lat/lon point.
  const osmUrl = `https://www.openstreetmap.org/?mlat=${airport.latitude}&mlon=${airport.longitude}#map=14/${airport.latitude}/${airport.longitude}`;

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      {/* ───── Back-link ───── */}
      <Link
        href="/airports"
        className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 mb-6"
      >
        ← Zurück zur Airport-Liste
      </Link>

      {/* ───── Hero ───── */}
      <header className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold font-mono">{airport.icao}</h1>
              {airport.iata && (
                <span className="px-2 py-1 text-sm font-mono rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                  {airport.iata}
                </span>
              )}
              {airport.verified ? (
                <span
                  className="px-2 py-1 text-xs font-semibold rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                  title={
                    airport.verifiedAt
                      ? `Verified am ${airport.verifiedAt.toLocaleDateString('de-DE')}`
                      : 'Verified'
                  }
                >
                  ✓ Verified
                </span>
              ) : (
                <span
                  className="px-2 py-1 text-xs font-semibold rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300"
                  title="Daten noch nicht von System-Admin geprüft"
                >
                  ⚠ Provisional
                </span>
              )}
              {!airport.active && (
                <span className="px-2 py-1 text-xs font-semibold rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                  Inaktiv
                </span>
              )}
            </div>
            <h2 className="text-xl text-gray-700 dark:text-gray-200">
              {airport.name}
            </h2>
            {(airport.city || airport.country) && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {[airport.city, airport.country].filter(Boolean).join(', ')}
                {continentLabel && ` · ${continentLabel}`}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {typeMeta && (
              <span
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                title={`OurAirports type: ${airport.type}`}
              >
                <span>{typeMeta.emoji}</span>
                <span>{typeMeta.label}</span>
              </span>
            )}
            {airport.scheduledService && (
              <span
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                title="Bietet regulären Linienflug-Verkehr"
              >
                ✈ Linienflug
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ───── Quick-Stats Grid ───── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Position"
          value={`${airport.latitude.toFixed(4)}, ${airport.longitude.toFixed(4)}`}
          mono
        />
        <StatCard
          label="Höhe"
          value={
            airport.elevation != null
              ? `${airport.elevation.toLocaleString('de')} ft`
              : '—'
          }
        />
        <StatCard
          label="Runways"
          value={`${airport.runways.length}`}
          subtitle={
            airport.runways.length > 0
              ? `${airport.runways.filter((r) => !r.closed).length} aktiv`
              : undefined
          }
        />
        <StatCard
          label="Frequenzen"
          value={`${airport.frequencies.length}`}
        />
      </section>

      {/* ───── Position & Maps ───── */}
      <Section title="Position">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Field label="Latitude" value={airport.latitude.toFixed(6)} mono />
            <Field
              label="Longitude"
              value={airport.longitude.toFixed(6)}
              mono
            />
            {airport.elevation != null && (
              <Field
                label="Elevation"
                value={`${airport.elevation.toLocaleString('de')} ft (${Math.round(airport.elevation * 0.3048).toLocaleString('de')} m)`}
              />
            )}
            {airport.gpsCode && (
              <Field label="GPS-Code" value={airport.gpsCode} mono />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <a
              href={osmUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
            >
              🗺️ Auf OpenStreetMap öffnen
            </a>
            {airport.wikipediaLink && (
              <a
                href={airport.wikipediaLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
              >
                📖 Wikipedia
              </a>
            )}
          </div>
        </div>
      </Section>

      {/* ───── Runways ───── */}
      <Section title={`Runways (${airport.runways.length})`}>
        {airport.runways.length === 0 ? (
          <EmptyState text="Keine Runway-Daten verfügbar." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold">Bezeichnung</th>
                  <th className="px-3 py-2 font-semibold">Länge</th>
                  <th className="px-3 py-2 font-semibold">Breite</th>
                  <th className="px-3 py-2 font-semibold">Belag</th>
                  <th className="px-3 py-2 font-semibold">Heading</th>
                  <th className="px-3 py-2 font-semibold text-center">Licht</th>
                  <th className="px-3 py-2 font-semibold text-center">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {airport.runways.map((rw) => {
                  const surfaceLabel = rw.surface
                    ? SURFACE_LABELS[rw.surface] ?? rw.surface
                    : '—';
                  const lengthM =
                    rw.lengthFt != null
                      ? Math.round(rw.lengthFt * 0.3048)
                      : null;
                  const widthM =
                    rw.widthFt != null
                      ? Math.round(rw.widthFt * 0.3048)
                      : null;
                  const headings = [rw.leHeadingDegT, rw.heHeadingDegT]
                    .filter((h): h is number => h != null)
                    .map((h) => `${Math.round(h)}°`)
                    .join(' / ');

                  return (
                    <tr
                      key={rw.id}
                      className={
                        rw.closed ? 'opacity-50' : 'hover:bg-gray-50 dark:hover:bg-gray-800/30'
                      }
                    >
                      <td className="px-3 py-2 font-mono font-semibold">
                        {[rw.leIdent, rw.heIdent].filter(Boolean).join(' / ') ||
                          '—'}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {rw.lengthFt != null ? (
                          <>
                            {rw.lengthFt.toLocaleString('de')} ft
                            {lengthM != null && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {lengthM.toLocaleString('de')} m
                              </div>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {rw.widthFt != null ? (
                          <>
                            {rw.widthFt} ft
                            {widthM != null && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {widthM} m
                              </div>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                        {surfaceLabel}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {headings || '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {rw.lighted ? (
                          <span title="Beleuchtet">💡</span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-600">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {rw.closed ? (
                          <span className="px-2 py-0.5 text-xs rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                            Closed
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-xs rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                            Aktiv
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {airport.runways.length > 0 && (
          // Operations-info-hinweis: weder OurAirports noch AirportDB liefern
          // departure/arrival-zuteilung pro runway, weil das in der realität
          // dynamisch ist (windrichtung, lärmschutz-zeiten, NOTAMs, alternation
          // wie bei EGLL). Dieser hinweis verhindert dass user die fehlende
          // spalte für ein UI-bug halten — und verlinkt zu den primärquellen.
          <div className="mt-4 p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 text-xs text-blue-800 dark:text-blue-200">
            <strong>ℹ Hinweis:</strong> Die zuteilung welche runway für{' '}
            <em>departure</em> oder <em>arrival</em> genutzt wird, ist in den
            verfügbaren freien Daten-quellen (OurAirports, AirportDB) nicht
            enthalten — sie ändert sich windrichtungsbedingt und wird
            tagesaktuell über ATIS/AIP/NOTAMs bekanntgegeben.
          </div>
        )}
      </Section>

      {/* ───── Frequencies ───── */}
      <Section title={`Frequenzen (${airport.frequencies.length})`}>
        {airport.frequencies.length === 0 ? (
          <EmptyState text="Keine Frequenz-Daten verfügbar." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold">Typ</th>
                  <th className="px-3 py-2 font-semibold">Bezeichnung</th>
                  <th className="px-3 py-2 font-semibold">Frequenz</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {airport.frequencies.map((f) => {
                  const typeLabel = FREQ_TYPE_LABELS[f.type] ?? f.type;
                  return (
                    <tr
                      key={f.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/30"
                    >
                      <td className="px-3 py-2">
                        <span
                          className="inline-block px-2 py-0.5 text-xs font-mono rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                          title={`OurAirports code: ${f.type}`}
                        >
                          {f.type}
                        </span>
                        {typeLabel !== f.type && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {typeLabel}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                        {f.description || '—'}
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold">
                        {f.frequencyMhz.toFixed(3)} MHz
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ───── Navaids ───── */}
      <Section title={`Navigations-Hilfen (${airport.navaids.length})`}>
        {airport.navaids.length === 0 ? (
          <EmptyState text="Keine Navaid-Daten verfügbar." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold">Ident</th>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Typ</th>
                  <th className="px-3 py-2 font-semibold">Frequenz</th>
                  <th className="px-3 py-2 font-semibold">Position</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {airport.navaids.map((n) => {
                  // Frequency: VOR/ILS speichern in kHz*100 (108.10 MHz = 108100),
                  // NDB speichert direkt kHz. Heuristik: wenn freq > 30000 → MHz.
                  const freqDisplay =
                    n.frequencyKhz == null
                      ? '—'
                      : n.frequencyKhz > 30000
                        ? `${(n.frequencyKhz / 1000).toFixed(3)} MHz`
                        : `${n.frequencyKhz} kHz`;

                  return (
                    <tr
                      key={n.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/30"
                    >
                      <td className="px-3 py-2 font-mono font-semibold">
                        {n.ident}
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                        {n.name}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-block px-2 py-0.5 text-xs font-mono rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                          {n.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono">{freqDisplay}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                        {n.latitude.toFixed(3)}, {n.longitude.toFixed(3)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ───── VAM-Aktivität ───── */}
      <Section title="VAM-Aktivität">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Routen ab hier"
            value={`${airport._count.routesFrom}`}
          />
          <StatCard
            label="Routen hierhin"
            value={`${airport._count.routesTo}`}
          />
          <StatCard
            label="Departures (PIREPs)"
            value={`${airport._count.pirepsFrom}`}
          />
          <StatCard
            label="Arrivals (PIREPs)"
            value={`${airport._count.pirepsTo}`}
          />
        </div>
      </Section>

      {/* ───── Metadata ───── */}
      <Section title="Metadaten">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          {airport.verified && airport.verifiedBy && (
            <Field
              label="Verified von"
              value={airport.verifiedBy.name ?? airport.verifiedBy.id}
            />
          )}
          {airport.verifiedAt && (
            <Field
              label="Verified am"
              value={airport.verifiedAt.toLocaleString('de-DE')}
            />
          )}
          <Field
            label="Erstellt"
            value={airport.createdAt.toLocaleString('de-DE')}
          />
          <Field
            label="Zuletzt geändert"
            value={airport.updatedAt.toLocaleString('de-DE')}
          />
          {airport.proposedFromRequestId && (
            <Field
              label="Aus Request"
              value={airport.proposedFromRequestId}
              mono
            />
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
          Daten basierend auf{' '}
          <a
            href="https://ourairports.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700 dark:hover:text-gray-300"
          >
            OurAirports.com
          </a>{' '}
          (Public Domain) und ggf.{' '}
          <a
            href="https://airportdb.io"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700 dark:hover:text-gray-300"
          >
            AirportDB.io
          </a>
          .
        </p>
      </Section>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helper-components — co-located weil nur hier verwendet, klein, und
// das splitting in eigene file würde nur indirection einführen.
// ─────────────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6 mb-6">
      <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
        {title}
      </h3>
      {children}
    </section>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  mono,
}: {
  label: string;
  value: string;
  subtitle?: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
        {label}
      </div>
      <div
        className={`text-lg font-semibold text-gray-900 dark:text-gray-100 ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {subtitle}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span
        className={`text-gray-900 dark:text-gray-100 ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="text-sm text-gray-500 dark:text-gray-400 italic py-4 text-center">
      {text}
    </p>
  );
}
