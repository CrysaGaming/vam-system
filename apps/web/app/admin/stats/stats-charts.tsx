'use client';

import { BarChart } from '@/components/BarChart';
import { DonutChart } from '@/components/DonutChart';

type FlightsPerMonth = { month: string; flights: number };
type TopRoute = { route: string; flights: number };
type StatusData = { status: string; count: number };

export function StatsCharts({
  flightsPerMonth,
  topRoutes,
  statusData,
}: {
  flightsPerMonth: FlightsPerMonth[];
  topRoutes: TopRoute[];
  statusData: StatusData[];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Flüge pro Monat */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
        <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
          Flüge pro Monat
        </h2>
        <BarChart
          data={flightsPerMonth}
          index="month"
          categories={['flights']}
          colors={['blue']}
          yAxisWidth={48}
          showLegend={false}
        />
      </section>

      {/* Top 5 Routen + Status-Donut nebeneinander */}
      <div
        className="grid gap-6"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' }}
      >
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
            Top 5 Routen
          </h2>
          {topRoutes.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm">Noch keine Routen geflogen.</p>
          ) : (
            <BarChart
              data={topRoutes}
              index="route"
              categories={['flights']}
              colors={['emerald']}
              yAxisWidth={120}
              layout="vertical"
              showLegend={false}
            />
          )}
        </section>

        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
            PIREPs nach Status
          </h2>
          {statusData.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm">Keine Daten.</p>
          ) : (
            <div className="flex items-center justify-center">
              <DonutChart
                data={statusData}
                category="status"
                value="count"
                colors={['emerald', 'amber', 'pink']}
                showLabel={true}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}