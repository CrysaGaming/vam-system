'use client';

/**
 * Track 5 #6 — Monthly-trend chart for the pilot career-stats page.
 *
 * Client-component (recharts braucht den browser für SVG-measurements).
 * Bekommt die 12-month-buckets vom server geliefert — keine fetch hier,
 * pure visualisierung.
 *
 * Composition: Bars für flights (linke y-achse, blau), Linie für hours
 * (rechte y-achse, indigo). Dual-axis weil flights und hours different
 * scales haben (z.B. 5 flights + 12 hours pro monat).
 *
 * X-axis labels: short month name ("Mär", "Apr", ...). Bei jahres-übergang
 * wird auch das jahr angezeigt — sonst sieht "Jan 2025" und "Jan 2026"
 * identisch aus.
 */

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';

type Bucket = { monthKey: string; flights: number; hours: number };

const MONTH_LABELS_DE = [
  'Jan',
  'Feb',
  'Mär',
  'Apr',
  'Mai',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Okt',
  'Nov',
  'Dez',
];

function formatMonthLabel(key: string, idx: number, all: Bucket[]): string {
  // key = "2026-05" → "Mai" oder "Mai '26" wenn jahr-übergang
  const [y, m] = key.split('-').map(Number);
  const mLabel = MONTH_LABELS_DE[m - 1] ?? key;
  // Wenn der vorherige bucket in einem anderen jahr ist → jahr mit anzeigen
  if (idx > 0) {
    const prevYear = parseInt(all[idx - 1].monthKey.split('-')[0], 10);
    if (prevYear !== y) return `${mLabel} '${String(y).slice(2)}`;
  } else {
    // first bucket always shows year
    return `${mLabel} '${String(y).slice(2)}`;
  }
  return mLabel;
}

export function MonthlyTrendChart({ buckets }: { buckets: Bucket[] }) {
  const data = buckets.map((b, i) => ({
    ...b,
    label: formatMonthLabel(b.monthKey, i, buckets),
  }));

  return (
    <div className="w-full" style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#6b7280" />
          <YAxis
            yAxisId="flights"
            tick={{ fontSize: 11 }}
            stroke="#3b82f6"
            allowDecimals={false}
          />
          <YAxis
            yAxisId="hours"
            orientation="right"
            tick={{ fontSize: 11 }}
            stroke="#6366f1"
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid #d1d5db',
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
          <Bar
            yAxisId="flights"
            dataKey="flights"
            name="Flüge"
            fill="#3b82f6"
            radius={[4, 4, 0, 0]}
          />
          <Line
            yAxisId="hours"
            type="monotone"
            dataKey="hours"
            name="Stunden"
            stroke="#6366f1"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
