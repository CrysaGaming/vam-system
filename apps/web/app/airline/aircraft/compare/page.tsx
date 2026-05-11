import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { CompareTypePicker } from './compare-type-picker';

/**
 * /airline/aircraft/compare — Side-by-side Aircraft-Type Compare-Table
 * (Track 4 #88, Section Q).
 *
 * Use-case: admin überlegt welcher type zur fleet-expansion passt, will
 * sehen wie sich z.B. B738 vs A20N vs E195 in range/capacity/cruise/fuel
 * vergleichen. Bisher müsste man 3-4 catalog-pages nebeneinander aufmachen
 * — diese page rendert die gleichen specs in einer kompakten tabelle.
 *
 * Architektur-decision:
 * - Pure server-component. State = URL (?types=A320,B738,E190). Picker und
 *   remove-buttons sind klassische GET-forms / links. Keine client-side-
 *   js. Vorteil: deep-linkbar, shareable URLs, no hydration costs.
 * - Max 4 types pro vergleich. Bei mehr wird's eng auf desktop und chaotisch
 *   auf mobile. Vier deckt die häufigsten use-cases ab (narrow-body
 *   shootout, wide-body shootout, etc.).
 * - Best-value-highlighting pro row: range/capacity/cruise = "höher ist
 *   besser", fuel = "niedriger ist besser". Bei tie kein highlight
 *   (verhindert dass beide grün werden und der vergleich confusing wird).
 * - Quick-add aus eigener fleet: "✈ Meine Flotte" füllt die query mit den
 *   types die im airline-aircraft-bestand vorkommen (bis max 4).
 *
 * Out-of-scope:
 * - Charts/visualisierung der differenzen → tabelle reicht für 4 cols
 * - Mehr specs (MTOW, fuel-capacity, wingspan, …) → wäre nice aber
 *   AircraftType-model hat das aktuell nicht; siehe schema-extension TODO
 * - Saved comparisons → ein admin-feature für später
 * - Performance-prediction (was würde route X kosten mit type Y) → eigene
 *   page in Welle 8+
 */

const MAX_TYPES = 4;

const CATEGORY_LABELS: Record<string, string> = {
  narrow_body: 'Narrow-Body',
  wide_body: 'Wide-Body',
  regional: 'Regional',
  cargo: 'Cargo',
  ga: 'General Aviation',
};

interface SearchParams {
  types?: string;
}

export default async function AircraftCompareTablePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAirlineManagerWithAirlinePage();
  const params = await searchParams;

  // Parse + dedup + cap requested types. URL ist die source-of-truth,
  // daher gehört die clamping-logik hierher.
  const requestedRaw = (params.types ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const dedup = Array.from(new Set(requestedRaw)).slice(0, MAX_TYPES);

  // Load selected types in parallel mit "fleet-types" für den quick-add-
  // button. Fleet-types sind die ICAO-codes die in der eigenen Aircraft-
  // tabelle tatsächlich vorkommen (über aircraftType-relation, nicht über
  // free-text-type-string, weil wir comparable specs brauchen).
  const [selectedTypes, fleetTypeUsage] = await Promise.all([
    dedup.length > 0
      ? prisma.aircraftType.findMany({
          where: { icaoType: { in: dedup }, active: true },
        })
      : Promise.resolve([]),
    prisma.aircraft.findMany({
      where: { airlineId: user.airlineId, aircraftTypeId: { not: null } },
      select: {
        aircraftType: {
          select: { icaoType: true, name: true, manufacturer: true },
        },
      },
      distinct: ['aircraftTypeId'],
    }),
  ]);

  const fleetIcaoTypes = Array.from(
    new Set(
      fleetTypeUsage
        .map((a) => a.aircraftType?.icaoType)
        .filter((v): v is string => !!v),
    ),
  );

  // Map dedup-order → selectedTypes-order. Prisma's IN-query liefert NICHT
  // in der reihenfolge die wir gegeben haben — wir reorderen damit die
  // spaltenreihenfolge der URL-reihenfolge entspricht.
  const typeByIcao = new Map(selectedTypes.map((t) => [t.icaoType, t]));
  const orderedTypes = dedup
    .map((icao) => typeByIcao.get(icao))
    .filter((t): t is (typeof selectedTypes)[number] => !!t);

  // Welche ICAO-codes haben wir NICHT gefunden? → user feedback
  const notFound = dedup.filter((icao) => !typeByIcao.has(icao));

  // Best-value-highlight: pro spec berechnen wir welcher type den besten
  // wert hat (oder null bei tie).
  const bestRange = bestIndexBy(orderedTypes, (t) => t.rangeNm, 'max');
  const bestCapacity = bestIndexBy(orderedTypes, (t) => t.capacityPax, 'max');
  const bestCruise = bestIndexBy(orderedTypes, (t) => t.cruiseSpeedKt, 'max');
  const bestFuel = bestIndexBy(orderedTypes, (t) => t.fuelBurnKgH, 'min');

  // URL-helper: returns ?types=A,B,C ohne diese eine.
  function urlMinus(icao: string): string {
    const rest = dedup.filter((c) => c !== icao);
    return rest.length > 0
      ? `/airline/aircraft/compare?types=${rest.join(',')}`
      : '/airline/aircraft/compare';
  }

  // Quick-add URL für fleet-types (bis MAX_TYPES, ohne duplikate mit
  // existing selection).
  const fleetQuickAddTypes = fleetIcaoTypes
    .filter((icao) => !dedup.includes(icao))
    .slice(0, MAX_TYPES - dedup.length);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-wrap items-start justify-between gap-4 mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <Link
              href="/airline/aircraft"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              ← Zurück zur Aircraft-Verwaltung
            </Link>
            <h1 className="text-3xl font-bold tracking-tight mt-2">
              Aircraft-Type Vergleich
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Side-by-side specs für bis zu {MAX_TYPES} aircraft-types.
              Nützlich für fleet-expansion-entscheidungen.
            </p>
          </div>
        </header>

        {/* Picker section */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Types auswählen ({orderedTypes.length} / {MAX_TYPES})
          </h2>

          {/* Selected chips with remove-button */}
          {orderedTypes.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {orderedTypes.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-100 dark:bg-indigo-500/20 border border-indigo-300 dark:border-indigo-500/40 rounded text-xs"
                >
                  <span className="font-mono font-semibold">{t.icaoType}</span>
                  <span className="text-gray-600 dark:text-gray-400">
                    {t.manufacturer} {t.name}
                  </span>
                  <Link
                    href={urlMinus(t.icaoType)}
                    className="ml-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 font-mono"
                    aria-label={`${t.icaoType} entfernen`}
                  >
                    ✕
                  </Link>
                </span>
              ))}
            </div>
          )}

          {/* Add by ICAO-code input. Client-component weil wir existing
              dedup-array mit dem neuen code mergen + zur URL pushen müssen
              (klassisches HTML-form könnte nur GET mit fixen name=value,
              kein dynamic merge). Bleibt minimal — kein autocomplete. */}
          <CompareTypePicker currentTypes={dedup} max={MAX_TYPES} />

          {/* Quick-add from fleet */}
          {fleetQuickAddTypes.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-gray-500 dark:text-gray-500">
                Aus deiner Flotte:
              </span>
              {fleetQuickAddTypes.map((icao) => {
                const rest = [...dedup, icao];
                return (
                  <Link
                    key={icao}
                    href={`/airline/aircraft/compare?types=${rest.join(',')}`}
                    className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded text-xs font-mono transition"
                  >
                    + {icao}
                  </Link>
                );
              })}
            </div>
          )}

          {notFound.length > 0 && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
              ⚠️ Nicht im Catalog gefunden:{' '}
              <span className="font-mono">{notFound.join(', ')}</span>
            </p>
          )}
        </section>

        {/* Comparison table */}
        {orderedTypes.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-12 text-center">
            <p className="text-lg text-gray-700 dark:text-gray-300 mb-2">
              Noch keine Types ausgewählt
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Trage ICAO-Codes oben ein (z.B. B738, A20N, E195) oder klick
              auf einen quick-add-button aus deiner Flotte.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium px-4 py-3 w-32">
                    Spec
                  </th>
                  {orderedTypes.map((t) => (
                    <th
                      key={t.id}
                      className="text-left px-4 py-3 align-bottom min-w-[200px]"
                    >
                      <div className="font-mono text-base font-bold">
                        {t.icaoType}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                        {t.manufacturer} {t.name}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-px bg-gray-100 dark:bg-gray-800 rounded text-gray-600 dark:text-gray-400">
                          {CATEGORY_LABELS[t.category] ?? t.category}
                        </span>
                        {t.verified && (
                          <span
                            className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-semibold"
                            title="Catalog-Eintrag verifiziert"
                          >
                            ✓ Verified
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                <SpecRow
                  label="Range"
                  unit="nm"
                  hint="Maximum reichweite"
                  best={bestRange}
                  bestHint="weiteste reichweite"
                  values={orderedTypes.map((t) =>
                    t.rangeNm.toLocaleString('de-DE'),
                  )}
                />
                <SpecRow
                  label="Sitze (2-class)"
                  unit="Pax"
                  hint="Typische konfiguration"
                  best={bestCapacity}
                  bestHint="meiste passagiere"
                  values={orderedTypes.map((t) =>
                    t.capacityPax.toLocaleString('de-DE'),
                  )}
                />
                <SpecRow
                  label="Cruise-Speed"
                  unit="kt"
                  hint="Typische reisegeschwindigkeit"
                  best={bestCruise}
                  bestHint="schnellster cruise"
                  values={orderedTypes.map((t) =>
                    t.cruiseSpeedKt.toLocaleString('de-DE'),
                  )}
                />
                <SpecRow
                  label="Fuel-Burn"
                  unit="kg/h"
                  hint="Approximate fuel-burn im cruise"
                  best={bestFuel}
                  bestHint="effizientester verbrauch"
                  values={orderedTypes.map((t) =>
                    t.fuelBurnKgH.toLocaleString('de-DE'),
                  )}
                />
              </tbody>
            </table>
          </div>
        )}

        <aside className="mt-6 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Hinweis:
            </strong>{' '}
            Die specs kommen aus dem AircraftType-Catalog. ✓ Verified bedeutet,
            dass die werte von einem Catalog-Maintainer gegengeprüft wurden.
            Werte ohne Verified-Tag sind community-eingaben und können
            ungenauigkeiten enthalten.
          </p>
          <p className="mt-2">
            <strong className="text-gray-700 dark:text-gray-300">★ Best:
            </strong>{' '}
            Markiert den jeweils besten wert pro spec. Bei range/capacity/cruise
            ist höher = besser, bei fuel-burn ist niedriger = besser. Bei tie
            wird kein highlight gezeigt.
          </p>
        </aside>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

interface SpecRowProps {
  label: string;
  unit: string;
  hint: string;
  best: number | null;
  bestHint: string;
  values: string[];
}

function SpecRow({ label, unit, hint, best, bestHint, values }: SpecRowProps) {
  return (
    <tr>
      <td className="px-4 py-3 align-top">
        <div className="font-medium text-gray-900 dark:text-white">{label}</div>
        <div className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">
          {hint}
        </div>
      </td>
      {values.map((v, i) => {
        const isBest = best === i;
        return (
          <td
            key={i}
            className={`px-4 py-3 align-top ${
              isBest
                ? 'bg-emerald-50 dark:bg-emerald-500/10'
                : ''
            }`}
          >
            <div className="flex items-baseline gap-1.5">
              <span
                className={`text-2xl font-bold font-mono ${
                  isBest
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-gray-900 dark:text-white'
                }`}
              >
                {v}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-500">
                {unit}
              </span>
              {isBest && (
                <span
                  className="text-[10px] uppercase tracking-wide font-semibold text-emerald-700 dark:text-emerald-400 ml-1"
                  title={bestHint}
                >
                  ★ Best
                </span>
              )}
            </div>
          </td>
        );
      })}
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns the index of the type with the best value per `extractor`. If
 * mehrere types den selben besten wert haben (tie), returns null statt
 * einen davon willkürlich zu markieren — würde sonst verwirrend wirken.
 */
function bestIndexBy<T>(
  items: T[],
  extractor: (item: T) => number,
  mode: 'min' | 'max',
): number | null {
  if (items.length === 0) return null;
  let bestIdx = 0;
  let bestVal = extractor(items[0]);
  let ties = 0;
  for (let i = 1; i < items.length; i++) {
    const v = extractor(items[i]);
    if ((mode === 'max' && v > bestVal) || (mode === 'min' && v < bestVal)) {
      bestVal = v;
      bestIdx = i;
      ties = 0;
    } else if (v === bestVal) {
      ties++;
    }
  }
  return ties > 0 ? null : bestIdx;
}
