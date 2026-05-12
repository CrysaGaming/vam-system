/**
 * Track 5 #17 (Section D) — Route-Suggester UI.
 *
 * Server-component die für einen pilot die top-5 route-vorschläge ab
 * seiner aktuellen position rendert. Zeigt am top der /bookings/new
 * page damit der pilot sofort eine "weiter so"-option sieht ohne durch
 * die ganze route-liste zu scrollen.
 *
 * # Layout
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ 🧭 Vorgeschlagene Folge-Flüge                            │
 *   │ Zuletzt gelandet: EDDM München    [vor 2 stunden]        │
 *   ├─────────────────────────────────────────────────────────┤
 *   │ ┌─────────────────────────────────────────────────────┐ │
 *   │ │ NGN901  EDDM → LSZH    Zürich      A320  D-AINA     │ │
 *   │ │ 113 nm · 🛫 Flugzeug am Standort · 🔁 3× geflogen    │ │
 *   │ │                                          [Buchen ►] │ │
 *   │ └─────────────────────────────────────────────────────┘ │
 *   │ … weitere cards                                          │
 *   └─────────────────────────────────────────────────────────┘
 *
 * # Conditional rendering
 *
 *   - getPilotLocation returns null → section hidden komplett (z.b. user
 *     hat keinen baseIcao und airline keinen primary hub)
 *   - getRouteSuggestions returns [] → section hidden (z.b. keine routes
 *     ab diesem airport in der airline)
 *
 * # Quick-book
 *
 *   Jede card hat ein <form action={quickBookFromSuggestion.bind(...)}>
 *   mit "Buchen"-button. Bei click → server-action erstellt booking →
 *   redirect /bookings/[id]. Active-booking-guard im createBooking blockt
 *   wenn der pilot schon ein offenes booking hat (error landet im
 *   next-error-boundary, V1 acceptable).
 */

import { getPilotLocation, getRouteSuggestions } from '@vam/db';
import { quickBookFromSuggestion } from './quick-book-action';

const SOURCE_LABEL: Record<
  'currentLocation' | 'baseIcao' | 'airlineHub',
  string
> = {
  currentLocation: 'Zuletzt gelandet',
  baseIcao: 'Dein Hub',
  airlineHub: 'Airline-Hub',
};

/**
 * Formatiert "vor 2 stunden" / "vor 3 tagen". Nur für currentLocation
 * sinnvoll — baseIcao und airlineHub haben kein updatedAt.
 */
function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return diffMin <= 1 ? 'gerade eben' : `vor ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `vor ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `vor ${diffD}d`;
  return date.toLocaleDateString('de-DE');
}

export async function RouteSuggestions({
  userId,
  airlineId,
}: {
  userId: string;
  airlineId: string;
}) {
  const location = await getPilotLocation(userId);
  if (!location) return null;

  const suggestions = await getRouteSuggestions({
    userId,
    airlineId,
    fromIcao: location.icao,
    limit: 5,
  });
  if (suggestions.length === 0) return null;

  return (
    <section className="bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-700/40 rounded-lg p-6 mb-8">
      <header className="mb-4 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm uppercase tracking-wider text-indigo-700 dark:text-indigo-400 font-semibold">
            🧭 Vorgeschlagene Folge-Flüge
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {SOURCE_LABEL[location.source]}:{' '}
            <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
              {location.icao}
            </span>
            {location.airportName && (
              <span className="text-gray-500"> · {location.airportName}</span>
            )}
            {location.airportCity &&
              location.airportCity !== location.airportName && (
                <span className="text-gray-500"> ({location.airportCity})</span>
              )}
          </p>
        </div>
        {location.source === 'currentLocation' && location.updatedAt && (
          <span className="text-[11px] text-gray-400 tabular-nums">
            {formatRelative(location.updatedAt)}
          </span>
        )}
      </header>

      <ul className="space-y-2">
        {suggestions.map((s) => (
          <li
            key={s.routeId}
            className="bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-md p-3 flex items-center gap-3 flex-wrap"
          >
            {/* Route headline: flight-number, DEP→ARR, arrival city */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="font-mono font-bold text-base text-gray-900 dark:text-gray-100">
                  {s.flightNumber}
                </span>
                <span className="text-sm text-gray-700 dark:text-gray-300 font-mono">
                  {s.departure.icao} → {s.arrival.icao}
                </span>
                {s.arrival.city && (
                  <span className="text-xs text-gray-500">
                    {s.arrival.city}
                  </span>
                )}
              </div>

              {/* Sub-line: aircraft, distance, badges */}
              <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1 text-xs text-gray-600 dark:text-gray-400">
                {s.aircraft && (
                  <span className="font-mono">
                    {s.aircraft.registration}
                    <span className="text-gray-400"> · {s.aircraft.type}</span>
                  </span>
                )}
                <span className="tabular-nums">{s.distanceNm} nm</span>
                {s.aircraftAtAirport && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400 rounded text-[10px] font-semibold"
                    title="Aircraft.currentLocationIcao matched — kein ferry-flight nötig"
                  >
                    <span aria-hidden="true">🛫</span>
                    Flugzeug am Standort
                  </span>
                )}
                {s.pilotFlightCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-700 dark:text-indigo-400 rounded text-[10px] font-semibold"
                    title={`Du hast diese Route schon ${s.pilotFlightCount}× geflogen`}
                  >
                    <span aria-hidden="true">🔁</span>
                    {s.pilotFlightCount}× geflogen
                  </span>
                )}
              </div>
            </div>

            {/* Quick-book button. bind() einbacked die routeId in die
                server-action; das form posted ohne FormData-fields. */}
            <form
              action={quickBookFromSuggestion.bind(null, s.routeId)}
              className="shrink-0"
            >
              <button
                type="submit"
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-full transition whitespace-nowrap"
              >
                Buchen →
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
