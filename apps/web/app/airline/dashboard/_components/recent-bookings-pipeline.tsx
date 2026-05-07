import { prisma } from '@vam/db';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

/**
 * RecentBookingsPipeline — Track 3 #11.2.5 Phase-B Op-Widget #2.
 *
 * Kanban-style 3-spalten-pipeline der booking-states letzte 14 tage:
 * Geplant (Created) → Dispatched (SimBriefDispatched) → Abgeschlossen
 * (Completed). Zeigt pro spalte den count + die 3 jüngsten bookings als
 * mini-cards. Click führt zur booking-detail-page.
 *
 * # Design-Entscheidungen
 *
 * **Nur 3 spalten, nicht 5**: BookingState hat 5 werte (Created,
 * SimBriefDispatched, Completed, Cancelled, Expired). Cancelled+Expired
 * sind terminal-failure-states und gehören NICHT in den happy-path-flow
 * — sie würden visual "drag" erzeugen ("oh, sieht aus als hätten wir viele
 * cancelled bookings") wo eigentlich das normal-noise von 7d-expiry-cycles
 * ist. Wenn diese counts wichtig werden, gehören sie in eine separate
 * "Issues"-section, nicht den pipeline-flow.
 *
 * **14-tage-fenster**: Booking expiry ist 7d, aber Completed-state bleibt
 * länger sichtbar wenn der pilot nach 6-7 tagen die booking ausgeführt
 * hat. 14d zeigt also eine vollständige completion-cycle plus puffer für
 * sehr-späte completions. Created+SimBriefDispatched-bookings älter als
 * 7d gibts nicht (würden expired sein).
 *
 * **Top-3 pro spalte, nicht alle**: Dashboards-vision §7.3 spec ist
 * "kanban-style übersicht", nicht "full backlog-view". Wer mehr will
 * geht zu /bookings (full list). Top-3 passt in einen lesbaren card-
 * stack ohne dass die spalte zur scrollbox wird.
 *
 * **3 parallel queries (eine pro state)**: Alternativ wäre groupBy by
 * state+take-pro-gruppe via raw-SQL window-function. groupBy in Prisma
 * gibt nur counts, keine items. 3 separate findMany ist die einfachste
 * korrekte form. Bei airline-scale (max ~100 active bookings) trivial-
 * cheap. _count operations laufen auf den indexen.
 *
 * **State-labels eingedeutscht**: Pipeline-headers heißen "Geplant",
 * "Dispatched", "Abgeschlossen" — pilot-perspektive, nicht engine-state-
 * names. Die rohe BookingState-enum bleibt für admin/debug-views.
 *
 * **Keine progress-numbers** (z.B. "5/12"): Pipeline ist visualisierung,
 * kein KPI-overlay. Wer die summen will, kann auf KPI-cards oben gucken.
 */

interface RecentBookingsPipelineProps {
  airlineId: string;
}

// Booking-state mapping zu pipeline-spalten. Cancelled+Expired bewusst
// excluded — siehe doc-comment oben. Reihenfolge folgt dem flow.
const PIPELINE_STATES = [
  { state: 'Created', label: 'Geplant', icon: '📋' },
  { state: 'SimBriefDispatched', label: 'Dispatched', icon: '✈️' },
  { state: 'Completed', label: 'Abgeschlossen', icon: '✅' },
] as const;

export async function RecentBookingsPipeline({ airlineId }: RecentBookingsPipelineProps) {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  // 3 parallele queries — eine pro pipeline-state. Promise.all damit
  // wir nicht 3x request-roundtrip seriell warten. Pro query: count +
  // top-3 recent.
  const [created, dispatched, completed] = await Promise.all(
    PIPELINE_STATES.map(async ({ state }) => {
      const [count, items] = await Promise.all([
        prisma.booking.count({
          where: {
            airlineId,
            state: state as 'Created' | 'SimBriefDispatched' | 'Completed',
            createdAt: { gte: fourteenDaysAgo },
          },
        }),
        prisma.booking.findMany({
          where: {
            airlineId,
            state: state as 'Created' | 'SimBriefDispatched' | 'Completed',
            createdAt: { gte: fourteenDaysAgo },
          },
          select: {
            id: true,
            createdAt: true,
            scheduledDeparture: true,
            user: { select: { name: true } },
            route: {
              select: {
                flightNumber: true,
                departure: { select: { icao: true } },
                arrival: { select: { icao: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 3,
        }),
      ]);
      return { count, items };
    }),
  );

  // Empty-state: wenn alle 3 spalten total leer (= keine bookings im
  // 14d-fenster), widget ausblenden. Identisch zu pirep-flow-timeline-
  // pattern. Eine spalte allein leer ist OK — das ist eine echte
  // operational-info ("keine pending dispatches, alles läuft").
  const totalCount = created.count + dispatched.count + completed.count;
  if (totalCount === 0) return null;

  const columns = PIPELINE_STATES.map((cfg, idx) => ({
    ...cfg,
    ...[created, dispatched, completed][idx],
  }));

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Booking-Pipeline</h2>
        <Link
          href="/bookings"
          className="text-xs text-primary hover:underline"
        >
          Alle anzeigen →
        </Link>
      </div>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        {columns.map((col) => (
          <Card key={col.state}>
            <CardContent className="p-4">
              <header className="flex items-center justify-between mb-3 pb-3 border-b border-gray-200 dark:border-gray-800">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <span aria-hidden="true">{col.icon}</span>
                  <span>{col.label}</span>
                </h3>
                <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
                  {col.count}
                </span>
              </header>
              {col.items.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                  keine bookings
                </p>
              ) : (
                <ul className="space-y-2">
                  {col.items.map((booking) => (
                    <li key={booking.id}>
                      <Link
                        href={`/bookings/${booking.id}`}
                        className="block p-2 rounded border border-gray-200 dark:border-gray-800 hover:border-primary hover:bg-gray-50 dark:hover:bg-gray-800/30 transition"
                      >
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <span className="font-mono text-xs font-medium text-gray-900 dark:text-white">
                            {booking.route.flightNumber}
                          </span>
                          <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                            {booking.route.departure.icao} → {booking.route.arrival.icao}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                          <span className="truncate">
                            {booking.user.name ?? '—'}
                          </span>
                          <span className="whitespace-nowrap ml-2 flex-shrink-0">
                            {formatRelativeTime(booking.createdAt)}
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {col.count > col.items.length && (
                <p className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400 text-center">
                  + {col.count - col.items.length} weitere
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

/**
 * Selbe relative-time-formatter wie pirep-flow-timeline. Bewusst
 * dupliziert statt extrahiert — bei 2 widgets gleicher pattern noch
 * nicht library-würdig. Bei 3+ widgets sollte das nach lib/time.ts.
 */
function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `vor ${days}T`;
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
