import { prisma } from '@vam/db';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

/**
 * FleetUtilization — Track 3 #11.2.5 Phase-B Op-Widget #3.
 *
 * Per-aircraft utilization-übersicht: registration, type, total-block-
 * hours der letzten 30 tage, idle/active-status. Sortiert nach hours
 * descending damit die hardest-working-jets ganz oben stehen und
 * idle-aircraft (=0h) am unteren ende sichtbar werden.
 *
 * # Design-Entscheidungen
 *
 * **Block-hours statt PIREP-count**: 100 short-flights ≠ 100 long-flights
 * für utilization-bewertung. Hours sind die echte fleet-asset-metrik
 * (hours-til-maintenance, lease-cost-per-hour, etc.). PIREP-count zeigen
 * wir trotzdem als sekundäre info, weil's lesehilfe ist ("3 langflüge"
 * vs "30 kurzflüge").
 *
 * **30-tage-fenster**: synchron zu top-routes für konsistente reading-
 * comparison. Wer das dashboard scrollt sieht "letzte 30 tage" überall —
 * mental-model bleibt stabil.
 *
 * **Idle-detection = 0 PIREPs in 30d**: Konservative definition. Ein
 * aircraft mit 1 PIREP in 30d ist NICHT idle, sondern under-utilized.
 * Idle bedeutet hier "stand 30 tage rum". Border-color (orange) signalisiert
 * dass airline-admin sich das angucken sollte — könnte legitim sein
 * (maintenance, ferry incoming, type-rating-lücke), könnte aber auch
 * forgotten-asset sein.
 *
 * **Status-conditional rendering**: Nur ACTIVE-aircraft in der
 * utilization-tabelle. RETIRED/STORED/MAINTENANCE haben eigene gründe
 * für 0h-utilization die nichts mit operations zu tun haben — die
 * würden das idle-signal zu noisy machen. Maintenance-counts könnten
 * später als separater "Fleet-Health"-widget kommen.
 *
 * **Take 15**: Etwas mehr als pirep-flow/top-routes weil flotten typisch
 * 5-30 airframes haben — bei 10 würden mid-size-flotten abgeschnitten
 * gerade dort wo idle-aircraft auftauchen. 15 deckt 80% der vAM-typischen
 * flottengrößen vollständig ab; größere flotten sehen "+ X weitere".
 *
 * **Two-query-pattern**: Aircraft.findMany um die master-liste zu
 * kriegen, dann pirep.groupBy um die nutzungs-daten dazu zu joinen.
 * Aircraft mit 0 PIREPs müssen in der liste erscheinen — ein einzelner
 * aircraft.findMany mit pirep-include würde Aircraft mit 0 PIREPs
 * inkludieren, aber wir brauchen sum/count über die 30d aggregation
 * was prisma include nicht macht.
 */

interface FleetUtilizationProps {
  airlineId: string;
}

export async function FleetUtilization({ airlineId }: FleetUtilizationProps) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [aircraft, utilization] = await Promise.all([
    prisma.aircraft.findMany({
      where: {
        airlineId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        registration: true,
        type: true,
        homeIcao: true,
        currentLocationIcao: true,
        aircraftType: { select: { manufacturer: true, name: true } },
      },
      orderBy: { registration: 'asc' },
    }),
    prisma.pirep.groupBy({
      by: ['aircraftId'],
      where: {
        airlineId,
        status: { not: 'Rejected' },
        submittedAt: { gte: thirtyDaysAgo },
        aircraftId: { not: null },
      },
      _count: { _all: true },
      _sum: { flightTimeMin: true },
    }),
  ]);

  // Empty-state: keine ACTIVE aircraft = leere flotte = widget aus.
  // Identisch zu pirep-flow-timeline/top-routes-pattern.
  if (aircraft.length === 0) return null;

  // Lookup-map für O(1) join. groupBy returnt mit aircraftId als key.
  // _count._all = anzahl PIREPs, _sum.flightTimeMin = total minuten.
  const utilByAircraftId = new Map(
    utilization
      .filter((u): u is typeof u & { aircraftId: string } => u.aircraftId !== null)
      .map((u) => [u.aircraftId, { count: u._count._all, totalMinutes: u._sum.flightTimeMin ?? 0 }]),
  );

  // Merge: pro aircraft entry mit utilization-daten oder defaults für
  // idle-airframes. Sortierung primary by minutes desc (working hardest
  // first), secondary by registration für stabile order bei gleichstand
  // (typischerweise alle 0h-idle-aircraft).
  const enriched = aircraft
    .map((ac) => {
      const util = utilByAircraftId.get(ac.id);
      return {
        ...ac,
        pirepCount: util?.count ?? 0,
        totalMinutes: util?.totalMinutes ?? 0,
        isIdle: !util || util.count === 0,
      };
    })
    .sort((a, b) => {
      if (a.totalMinutes !== b.totalMinutes) return b.totalMinutes - a.totalMinutes;
      return a.registration.localeCompare(b.registration);
    });

  const visible = enriched.slice(0, 15);
  const hiddenCount = enriched.length - visible.length;

  // Aggregierte stats für header. Idle-count als operational-flag.
  const totalHours = enriched.reduce((sum, ac) => sum + ac.totalMinutes / 60, 0);
  const idleCount = enriched.filter((ac) => ac.isIdle).length;

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Flotte-Auslastung</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {totalHours.toFixed(0)}h gesamt · {idleCount} idle / {enriched.length} aktiv
            {' '}· letzte 30 Tage
          </p>
        </div>
        <Link
          href="/airline/aircraft"
          className="text-xs text-primary hover:underline"
        >
          Alle anzeigen →
        </Link>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800">
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="px-4 py-3">Registrierung</th>
                <th className="px-4 py-3">Typ</th>
                <th className="px-4 py-3">Standort</th>
                <th className="px-4 py-3 text-right">Flüge (30d)</th>
                <th className="px-4 py-3 text-right">Stunden (30d)</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {visible.map((ac) => {
                const location = ac.currentLocationIcao ?? ac.homeIcao ?? '—';
                const typeLabel = ac.aircraftType
                  ? `${ac.aircraftType.manufacturer} ${ac.aircraftType.name}`
                  : ac.type;
                const hours = ac.totalMinutes / 60;
                return (
                  <tr
                    key={ac.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono font-medium">
                      <Link href={`/airline/aircraft/${ac.id}/edit`} className="block">
                        {ac.registration}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 text-xs">
                      <Link href={`/airline/aircraft/${ac.id}/edit`} className="block">
                        {typeLabel}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-400">
                      <Link href={`/airline/aircraft/${ac.id}/edit`} className="block">
                        {location}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      <Link href={`/airline/aircraft/${ac.id}/edit`} className="block">
                        {ac.pirepCount}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-900 dark:text-white font-medium">
                      <Link href={`/airline/aircraft/${ac.id}/edit`} className="block">
                        {hours > 0 ? hours.toFixed(1) : '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Link href={`/airline/aircraft/${ac.id}/edit`} className="block">
                        {ac.isIdle ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">
                            idle
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                            aktiv
                          </span>
                        )}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hiddenCount > 0 && (
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 text-center">
              <Link
                href="/airline/aircraft"
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary"
              >
                + {hiddenCount} weitere airframes →
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
