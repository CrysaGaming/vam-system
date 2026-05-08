'use client';

import { useEffect, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

/**
 * Track 4 #3 — Vertical-Profile-Chart (altitude vs. time).
 *
 * Client-component das den replay-data fetch on-mount macht statt
 * server-side. Reasoning:
 *
 *   - 1h ACARS-flight @ 1Hz = ~3600 positions × 200B JSON = 720KB
 *     server-payload pro PIREP-detail-page-render. Würde den initial
 *     RSC-bundle bloaten obwohl die meisten visitors nur kurz die
 *     KPI/Phase-Breakdown sehen wollen.
 *   - Stattdessen: page rendert minimal (status=hasReplay), client
 *     fetcht die positions on-mount via existing /api/pireps/[id]/
 *     replay-route (gleicher endpoint den der replay-page nutzt).
 *   - Bei skipped chart (user scrollt nicht runter) → kein fetch
 *     verschwendet. Bei geladenem chart → cached vom browser bei
 *     re-views.
 *
 * # Down-sampling
 *
 * Bei 3600 datenpunkten ist recharts träge (jeder point wird ein
 * SVG-element). Wir samplen down auf max 600 punkte indem wir nur
 * jeden N-ten nehmen. Bei kürzeren flügen (<10min, <600 points)
 * passiert nichts. Side-effect: kurze altitude-spikes (z.B. 5sec
 * climb-burst) können ge-aliased werden — für visual-overview ok,
 * für audit nicht. Audit-detail kommt später via replay-page.
 *
 * # Y-axis-formatting
 *
 *   - <10,000 ft → "X,XXX ft"
 *   - >=10,000 ft → "FL XXX" (transition altitude convention)
 *
 * # Loading-states
 *
 *   - initial: skeleton-bar (animate-pulse)
 *   - loading: same skeleton
 *   - error: muted "konnte nicht geladen werden" (chart hidden)
 *   - no-data: muted "keine altitude-daten vorhanden"
 *   - success: rendered chart
 */

type Position = {
  altitude: number;
  recordedAt: string; // ISO date from JSON serialization
};

type ReplayApiResponse =
  | {
      available: true;
      positions: Position[];
    }
  | {
      available: false;
      reason: string;
    };

interface Props {
  pirepId: string;
}

const MAX_POINTS = 600;

/** Format altitude für Y-axis-ticks. */
function formatAltitude(ft: number): string {
  if (ft >= 10000) {
    return `FL${Math.round(ft / 100)
      .toString()
      .padStart(3, '0')}`;
  }
  return `${ft.toLocaleString('de-DE')} ft`;
}

/** Format minute-offset für X-axis. */
function formatMinute(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

export function VerticalProfileChart({ pirepId }: Props) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'empty' }
    | {
        kind: 'ready';
        data: { tMinutes: number; altitude: number }[];
        maxAlt: number;
        durationMin: number;
      }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/pireps/${pirepId}/replay`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json: ReplayApiResponse = await res.json();
        if (cancelled) return;

        if (!json.available || json.positions.length === 0) {
          setState({ kind: 'empty' });
          return;
        }

        // Sort by recordedAt to be defensive (API returns sorted asc
        // already, but if a future change breaks that the chart would
        // zigzag visually). Cheap O(n log n).
        const sorted = [...json.positions].sort(
          (a, b) =>
            new Date(a.recordedAt).getTime() -
            new Date(b.recordedAt).getTime(),
        );

        const startMs = new Date(sorted[0]!.recordedAt).getTime();
        const endMs = new Date(
          sorted[sorted.length - 1]!.recordedAt,
        ).getTime();
        const durationMin = (endMs - startMs) / 60_000;

        // Down-sampling: max MAX_POINTS samples. Take every Nth.
        const stride = Math.max(
          1,
          Math.ceil(sorted.length / MAX_POINTS),
        );
        const sampled = sorted.filter((_, i) => i % stride === 0);
        // Ensure last point is always included so the chart ends at
        // the actual final altitude, not at sample-truncated.
        if (sampled[sampled.length - 1] !== sorted[sorted.length - 1]) {
          sampled.push(sorted[sorted.length - 1]!);
        }

        const data = sampled.map((p) => ({
          tMinutes:
            (new Date(p.recordedAt).getTime() - startMs) / 60_000,
          altitude: p.altitude,
        }));

        const maxAlt = Math.max(...data.map((d) => d.altitude));

        setState({ kind: 'ready', data, maxAlt, durationMin });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'fetch failed',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pirepId]);

  if (state.kind === 'loading') {
    return (
      <div className="h-[250px] bg-gray-100 dark:bg-gray-800/50 rounded animate-pulse" />
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="h-[250px] flex items-center justify-center text-xs text-gray-500">
        Vertical-Profile konnte nicht geladen werden ({state.message})
      </div>
    );
  }
  if (state.kind === 'empty') {
    return (
      <div className="h-[250px] flex items-center justify-center text-xs text-gray-500">
        Keine altitude-daten für diesen flug verfügbar
      </div>
    );
  }

  // Y-axis-domain: 0 to slightly above maxAlt für etwas headroom.
  // Tailwind theme-tokens werden in recharts via inline-color konsumiert
  // — direkter access auf CSS-vars ist im SVG-context unzuverlässig,
  // daher hardcoded indigo-500 (#6366f1) das auch der --primary token
  // ist (siehe globals.css).
  const yMax = Math.ceil((state.maxAlt + 1000) / 1000) * 1000;

  return (
    <div className="w-full h-[250px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={state.data}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient
              id="altitudeGradient"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="tMinutes"
            type="number"
            domain={[0, state.durationMin]}
            tickFormatter={formatMinute}
            tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.6 }}
            stroke="currentColor"
            strokeOpacity={0.2}
          />
          <YAxis
            domain={[0, yMax]}
            tickFormatter={formatAltitude}
            tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.6 }}
            stroke="currentColor"
            strokeOpacity={0.2}
            width={70}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(0,0,0,0.85)',
              border: 'none',
              borderRadius: '6px',
              fontSize: '12px',
            }}
            labelStyle={{ color: '#fff' }}
            itemStyle={{ color: '#a5b4fc' }}
            // recharts widened formatter-types in v3 to ReactNode/ValueType
            // | undefined. Wir wissen aber dass dataKey="altitude" + numeric
            // tMinutes immer numbers liefern, also defensive cast statt
            // runtime-checks die nie triggern.
            labelFormatter={(value) =>
              `T+${formatMinute(Number(value))}`
            }
            formatter={(value) => [
              formatAltitude(Number(value)),
              'Altitude',
            ]}
          />
          {/* FL100 reference-line — transition-level für viele euro-FIRs.
              Nicht für alle regions korrekt aber gibt visual-anchor. */}
          {state.maxAlt >= 10000 && (
            <ReferenceLine
              y={10000}
              stroke="currentColor"
              strokeOpacity={0.15}
              strokeDasharray="3 3"
              label={{
                value: 'FL100',
                position: 'right',
                fontSize: 10,
                fill: 'currentColor',
                opacity: 0.5,
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="altitude"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#altitudeGradient)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
