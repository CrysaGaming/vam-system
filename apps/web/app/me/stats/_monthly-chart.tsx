'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

import type { MonthlyBucket } from '@/lib/stats/personal';

interface Props {
  data: MonthlyBucket[];
}

/**
 * Welle I / I1 — Monthly-flights bar-chart.
 *
 * Recharts-basierter bar-chart für die 12-monats rolling-window. Pro
 * bucket eine bar mit höhe = flight-count. Tooltip zeigt month + year
 * + flights + total-hours.
 *
 * Client-component weil recharts ResponsiveContainer + SVG-mount-side
 * runtime nötig haben — server-rendering würde nur einen empty
 * container shippen.
 */
export function MonthlyChart({ data }: Props) {
  const maxFlights = Math.max(1, ...data.map((d) => d.flights));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            opacity={0.4}
          />
          <XAxis
            dataKey="label"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            stroke="hsl(var(--border))"
          />
          <YAxis
            allowDecimals={false}
            domain={[0, Math.ceil(maxFlights * 1.1)]}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            stroke="hsl(var(--border))"
          />
          <Tooltip
            cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }}
            contentStyle={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 6,
              fontSize: 13,
            }}
            labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
            formatter={(value, _name, entry) => {
              // Recharts Tooltip typing is generic & permissive — we narrow
              // at runtime. entry.payload is the original MonthlyBucket
              // row when our data is shaped like one. Fall through to a
              // sane default if anything's off.
              const p = (entry as { payload?: MonthlyBucket } | undefined)
                ?.payload;
              if (!p) return [String(value ?? 0), 'Flüge'];
              const hours = Math.round((p.minutes / 60) * 10) / 10;
              return [
                `${value ?? 0} Flüge · ${hours}h`,
                `${p.label} ${p.year}`,
              ];
            }}
            labelFormatter={() => ''}
          />
          <Bar
            dataKey="flights"
            fill="#6366f1"
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
