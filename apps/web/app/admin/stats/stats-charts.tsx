'use client';

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Admin stats dashboard charts.
 *
 * Track 3 #11.2.2 Phase 3: Migrated from removed Tremor BarChart/DonutChart
 * components to direct recharts usage. Theme-aware via globals.css chart-
 * tokens (`--chart-1` … `--chart-5`) which auto-switch on dark/light.
 *
 * Three charts:
 *   1. Flights per month (vertical bar) — uses --chart-1
 *   2. Top 5 routes (horizontal bar) — uses --chart-2
 *   3. PIREPs by status (donut) — emerald/amber/pink for ok/warn/error
 *
 * Tooltip is a small shadcn-style card (bg-popover, border, shadow) that
 * matches the rest of the app's surfaces. Recharts' default tooltip uses
 * a hardcoded white background which would clash in dark mode.
 */

type FlightsPerMonth = { month: string; flights: number };
type TopRoute = { route: string; flights: number };
type StatusData = { status: string; count: number };

// Custom tooltip — theme-aware (uses popover-tokens). Recharts passes
// `active`/`payload`/`label` automatically. Type kept loose because
// Recharts 3.x's TooltipProps generic doesn't include payload/label
// directly on the content-component prop type — those come through
// the runtime cloneElement injection.
type ChartTooltipPayload = {
  color?: string;
  name?: string | number;
  dataKey?: string | number;
  value?: number | string;
};

function ChartTooltip(props: {
  active?: boolean;
  payload?: ChartTooltipPayload[];
  label?: string | number;
}) {
  const { active, payload, label } = props;
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      {label !== undefined && label !== '' && (
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {label}
        </div>
      )}
      {payload.map((p, idx) => (
        <div
          key={idx}
          className="flex items-center gap-2 text-sm font-medium"
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-muted-foreground">
            {p.name ?? p.dataKey}:
          </span>
          <span className="font-mono tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// Donut center label — total count.
function DonutCenter({ total }: { total: number }) {
  return (
    <text
      x="50%"
      y="50%"
      textAnchor="middle"
      dominantBaseline="middle"
      className="fill-foreground"
    >
      <tspan x="50%" dy="-0.4em" className="text-2xl font-bold">
        {total}
      </tspan>
      <tspan
        x="50%"
        dy="1.4em"
        className="fill-muted-foreground text-xs"
      >
        Total
      </tspan>
    </text>
  );
}

export function StatsCharts({
  flightsPerMonth,
  topRoutes,
  statusData,
}: {
  flightsPerMonth: FlightsPerMonth[];
  topRoutes: TopRoute[];
  statusData: StatusData[];
}) {
  const totalPireps = statusData.reduce((sum, s) => sum + s.count, 0);

  // Status-donut color mapping: ok=emerald, warn=amber, error=pink (siehe
  // Tremor-original-mapping). Reihenfolge folgt der data-array-order.
  const donutColors = [
    'var(--chart-2)', // emerald-ish
    'var(--chart-4)', // amber-ish
    'var(--chart-5)', // pink/red-ish
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* ─── Flüge pro Monat ─── */}
      <section className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h2 className="mb-4 text-sm uppercase tracking-wider text-muted-foreground">
          Flüge pro Monat
        </h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={flightsPerMonth}
            margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <XAxis
              dataKey="month"
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              width={48}
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
            />
            <Bar
              dataKey="flights"
              fill="var(--chart-1)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* ─── Top 5 Routen + Status-Donut nebeneinander ─── */}
      <div
        className="grid gap-6"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' }}
      >
        <section className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
          <h2 className="mb-4 text-sm uppercase tracking-wider text-muted-foreground">
            Top 5 Routen
          </h2>
          {topRoutes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Routen geflogen.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, topRoutes.length * 48)}>
              <BarChart
                data={topRoutes}
                layout="vertical"
                margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
              >
                <XAxis
                  type="number"
                  stroke="var(--muted-foreground)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="route"
                  width={120}
                  stroke="var(--muted-foreground)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                />
                <Bar
                  dataKey="flights"
                  fill="var(--chart-2)"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
          <h2 className="mb-4 text-sm uppercase tracking-wider text-muted-foreground">
            PIREPs nach Status
          </h2>
          {statusData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Daten.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Tooltip content={<ChartTooltip />} />
                <Pie
                  data={statusData}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={110}
                  paddingAngle={2}
                  strokeWidth={2}
                  stroke="var(--background)"
                >
                  {statusData.map((_, idx) => (
                    <Cell
                      key={idx}
                      fill={donutColors[idx % donutColors.length]}
                    />
                  ))}
                </Pie>
                <DonutCenter total={totalPireps} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </section>
      </div>
    </div>
  );
}
