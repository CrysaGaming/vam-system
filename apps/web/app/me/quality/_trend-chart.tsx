'use client';

/**
 * Welle I / I2 — Quality-score trend chart (client component).
 *
 * Rendert die letzten N PIREP-scores als line-chart mit recharts.
 * Y-axis 0-100, X-axis = submission-order (rechts = neuester).
 * Eine reference-line bei 75 zeigt die "Gut"-schwelle.
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

type Props = {
  data: Array<{ index: number; score: number; date: string }>;
};

export default function QualityTrendChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Noch keine Flüge — der Chart erscheint nach deinem ersten approved PIREP.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 10, right: 16, bottom: 10, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="index"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          tickFormatter={(v) => `#${v}`}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          ticks={[0, 25, 50, 75, 100]}
        />
        <Tooltip
          contentStyle={{
            background: 'hsl(var(--background))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            fontSize: '13px',
          }}
          labelFormatter={(v) => `Flug #${v}`}
          formatter={(value, _name, item) => {
            const date =
              (item as { payload?: { date?: string } }).payload?.date ?? '';
            return [`${value} / 100`, date];
          }}
        />
        {/* Threshold-line bei 75 (= "Gut" lower-bound) */}
        <ReferenceLine
          y={75}
          stroke="#22c55e"
          strokeDasharray="4 4"
          strokeWidth={1}
        />
        <Line
          type="monotone"
          dataKey="score"
          stroke="#6366f1"
          strokeWidth={2}
          dot={{ r: 3, fill: '#6366f1' }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
