'use client';

/**
 * Welle I / I5 — Comparison grouped-bar chart (client component).
 *
 * Rendert 4 grouped bars (eine pro metrik) × 3 series (user / airline /
 * platform). User-color = indigo, airline = cyan, platform = slate.
 *
 * Recharts BarChart mit categorical X-axis (metrik-namen).
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LabelList,
} from 'recharts';

type Datum = {
  metric: string;
  user: number;
  airline: number;
  platform: number;
};

type Props = {
  data: Datum[];
  airlineLabel: string | null;
  hasAirline: boolean;
};

export default function ComparisonChart({ data, airlineLabel, hasAirline }: Props) {
  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={data} margin={{ top: 20, right: 16, bottom: 10, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="metric"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
        />
        <YAxis
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
        />
        <Tooltip
          contentStyle={{
            background: 'hsl(var(--background))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            fontSize: '13px',
          }}
        />
        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
        <Bar dataKey="user" name="Du" fill="#6366f1" radius={[4, 4, 0, 0]}>
          <LabelList dataKey="user" position="top" style={{ fontSize: 10, fill: '#6366f1' }} />
        </Bar>
        {hasAirline && (
          <Bar
            dataKey="airline"
            name={airlineLabel ?? 'Airline'}
            fill="#06b6d4"
            radius={[4, 4, 0, 0]}
          >
            <LabelList dataKey="airline" position="top" style={{ fontSize: 10, fill: '#06b6d4' }} />
          </Bar>
        )}
        <Bar dataKey="platform" name="Platform" fill="#64748b" radius={[4, 4, 0, 0]}>
          <LabelList dataKey="platform" position="top" style={{ fontSize: 10, fill: '#64748b' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
