import Link from 'next/link';
import { prisma } from '@vam/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Vision §9.3.20 — Airport-Detail-Pages mit Live-Stats (Item 10/10).
 *
 * # Was ist hier — und was nicht (v1)
 *
 * v1 ist ein admin-dashboard-AGGREGATION-widget, NICHT eine neue
 * detail-page. Die existing /airports/[icao]/page.tsx hat bereits
 * eine "Quick-Stats"-section mit pirepsFrom/pirepsTo counts (siehe
 * line 218-540 dort) — die "live-stats"-funktionalität pro airport
 * existiert also schon. Was fehlte: eine cross-airline TRAFFIC-
 * ÜBERSICHT auf admin-ebene. Welche airports werden überhaupt
 * geflogen? Wo ist die plattform aktiv?
 *
 * Drei sektionen:
 *   1. Top-10-airports nach traffic last 30d (departures + arrivals
 *      kombiniert), mit progress-bar relativ zum traffic-king. Click
 *      auf row → existing /airports/[icao] page.
 *   2. Catalog-puls — total airports, total airports mit traffic
 *      last 30d (= "aktiv"), total flights last 30d.
 *   3. Schnellzugriff zur airport-curation page.
 *
 * Bewusst NICHT in v1 (eigene tickets):
 *   - Eine NEUE /airports/[icao]/stats route. Detail-page hat schon
 *     stats — extra route würde duplikat erzeugen.
 *   - Real-time-traffic (websocket-stream "FRA hat gerade departure").
 *     Aktuelle daten reichen, real-time ist eigenes ticket §9.2.1.
 *   - Heatmap-overlay auf einer weltkarte. PirepHeatmap-widget unten
 *     auf der page macht das schon (per route, nicht per airport,
 *     aber visuell überlappend). Eigenes ticket wenn doch gewünscht.
 *   - Airport-of-the-week / quietest-airport-engagement-card. Nice-
 *     stretch-feature, eigenes ticket.
 *
 * # Performance
 *
 * Zwei parallel groupBy-queries (departureId, arrivalId) je gefiltert
 * auf last 30d und status != Rejected. Beide nutzen pirep.submittedAt-
 * index. Merge im JS auf Map<airportId, dep+arr> → sort → take 10.
 * Plus eine findMany für die airport-details der top-10. Plus 3
 * counts für catalog-puls. Total ~6 queries — alle parallel.
 *
 * revalidate=30 in der page cached für 30s.
 *
 * # Auth
 *
 * Wird nur in admin/page.tsx gerendert; die page selbst gated mit
 * requireAdminPage(). Pure read-only — keine actions erforderlich.
 */
export async function AirportTrafficStats() {
  const past30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  // Filter: pireps last 30d die nicht rejected sind. Submitted (pending)
  // zählen weil sie reflect echte fluglokationen — admin will den traffic
  // sehen, nicht nur den approved-anteil. Rejected werden ausgeschlossen
  // weil sie ja oft duplikate oder fehleinträge sind.
  const submittedAtFilter = { gte: past30d };
  const statusFilter = { not: 'Rejected' as const };

  const [departures, arrivals, totalAirports, totalFlights] = await Promise.all([
    prisma.pirep.groupBy({
      by: ['departureId'],
      _count: true,
      where: { submittedAt: submittedAtFilter, status: statusFilter },
    }),
    prisma.pirep.groupBy({
      by: ['arrivalId'],
      _count: true,
      where: { submittedAt: submittedAtFilter, status: statusFilter },
    }),
    prisma.airport.count(),
    prisma.pirep.count({
      where: { submittedAt: submittedAtFilter, status: statusFilter },
    }),
  ]);

  // Merge auf Map<airportId, {dep, arr}>. Beide groupBy-results haben
  // typed _count: number weil das filter-where die query-shape garantiert.
  const trafficMap = new Map<string, { dep: number; arr: number }>();
  for (const d of departures) {
    const entry = trafficMap.get(d.departureId) ?? { dep: 0, arr: 0 };
    entry.dep = d._count;
    trafficMap.set(d.departureId, entry);
  }
  for (const a of arrivals) {
    const entry = trafficMap.get(a.arrivalId) ?? { dep: 0, arr: 0 };
    entry.arr = a._count;
    trafficMap.set(a.arrivalId, entry);
  }

  const activeAirportCount = trafficMap.size;

  // Top-10 by total traffic. Stable secondary-sort auf airportId für
  // deterministisches ranking bei tie (z.B. zwei airports mit je 1 dep).
  const topEntries = Array.from(trafficMap.entries())
    .map(([airportId, t]) => ({ airportId, dep: t.dep, arr: t.arr, total: t.dep + t.arr }))
    .sort((a, b) => b.total - a.total || a.airportId.localeCompare(b.airportId))
    .slice(0, 10);

  const topAirports =
    topEntries.length === 0
      ? []
      : await prisma.airport.findMany({
          where: { id: { in: topEntries.map((t) => t.airportId) } },
          select: { id: true, icao: true, iata: true, name: true, city: true, country: true },
        });
  const airportLookup = new Map(topAirports.map((a) => [a.id, a]));

  // Max für progress-bar-skalierung. Schützt gegen division-by-zero
  // wenn alle entries null sind (theoretisch nicht möglich nach filter,
  // aber clean-code).
  const maxTotal = topEntries[0]?.total ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Airport-Traffic (Live-Stats)</CardTitle>
        <CardDescription>
          Top-10 airports nach PIREP-traffic der letzten 30 Tage. Vision §9.3.20.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Top-10 traffic-leaderboard */}
        <section>
          {topEntries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Keine PIREPs in den letzten 30 Tagen.
              </p>
            </div>
          ) : (
            <ol className="space-y-2">
              {topEntries.map((entry, idx) => {
                const airport = airportLookup.get(entry.airportId);
                if (!airport) return null;
                const widthPct = maxTotal > 0 ? (entry.total / maxTotal) * 100 : 0;
                return (
                  <li key={entry.airportId}>
                    <Link
                      href={`/airports/${airport.icao}`}
                      className="block group rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary transition-colors"
                    >
                      <div className="px-3 py-2 flex items-center gap-3">
                        <span className="w-6 text-xs font-bold text-gray-400 dark:text-gray-500 tabular-nums">
                          #{idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-mono font-semibold group-hover:text-primary transition-colors">
                              {airport.icao}
                            </span>
                            {airport.iata && (
                              <span className="text-xs text-gray-400 dark:text-gray-500">
                                {airport.iata}
                              </span>
                            )}
                            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {airport.name}
                              {airport.city ? ` · ${airport.city}` : ''}
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>
                        </div>
                        <div className="text-right whitespace-nowrap">
                          <div className="text-sm font-semibold tabular-nums">
                            {entry.total}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                            {entry.dep}↑ {entry.arr}↓
                          </div>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* Catalog-puls */}
        <section className="grid grid-cols-3 gap-3 pt-2 border-t border-gray-200 dark:border-gray-800">
          <PulseStat
            label="Im catalog"
            value={totalAirports.toLocaleString('de-DE')}
            sublabel="Airports gesamt"
          />
          <PulseStat
            label="Aktiv 30d"
            value={activeAirportCount.toLocaleString('de-DE')}
            sublabel={
              totalAirports > 0
                ? `${((activeAirportCount / totalAirports) * 100).toFixed(1)}% des catalogs`
                : '—'
            }
          />
          <PulseStat
            label="Flüge 30d"
            value={totalFlights.toLocaleString('de-DE')}
            sublabel="Total PIREPs"
          />
        </section>

        {/* Quick-link */}
        <div className="text-xs text-gray-500 dark:text-gray-400">
          <Link
            href="/admin/requests"
            className="text-primary hover:underline"
          >
            Catalog-Requests reviewen →
          </Link>
          <span className="mx-2">·</span>
          <Link href="/airports" className="text-primary hover:underline">
            Airport-Browser →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

interface PulseStatProps {
  label: string;
  value: string;
  sublabel: string;
}

function PulseStat({ label, value, sublabel }: PulseStatProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2 bg-gray-50/60 dark:bg-gray-900/40">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-xl font-bold tabular-nums mt-0.5">{value}</p>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
        {sublabel}
      </p>
    </div>
  );
}
