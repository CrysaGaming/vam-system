'use client';

import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';

/**
 * Track 4 #4 — Aircraft-Performance-Chart (IAS + VSI vs. time).
 *
 * Dual-axis line-chart: indicated airspeed (left, knots) und vertical
 * speed (right, fpm) gemeinsam über die zeit. Beide metrics stammen
 * aus LiveSessionPosition — ACARS-fields die per-frame befüllt sind
 * (Welle 9 schema-extension).
 *
 * # Naming-disclaimer
 *
 * Im roadmap-vision war das ursprünglich "Engine-Performance" mit N1,
 * N2, fuelFlow — aber LiveSessionPosition speichert KEINE per-position
 * engine-data, das sind nur session-level-aggregates auf LiveSession.
 * Ohne schema-erweiterung (würde ACARS-client-update brauchen) können
 * wir keine engine-time-series rendern. Daher rename → "Aircraft-
 * Performance" mit IAS + VSI, was tatsächlich verfügbar ist und auch
 * eine sinnvolle performance-narrative liefert (climb-rate vs speed,
 * approach-deceleration etc.).
 *
 * # Dual-axis-rationale
 *
 * IAS und VSI haben sehr unterschiedliche scales:
 *   IAS: 0 .. 450 knots (positiv)
 *   VSI: -3000 .. +3000 fpm (vorzeichen-flip!)
 *
 * Single-axis würde VSI als horizontal-line near zero rendern weil
 * IAS-range den scale dominiert. Dual-axis lässt beide read-bar.
 *
 * # Architecture
 *
 * Selbe pattern wie VerticalProfileChart (#3): client-component, lazy-
 * fetch via /api/pireps/[id]/replay, MAX_POINTS=600 down-sampling.
 *
 * Möglicher refactor: shared `useReplayData(pirepId)` hook der von #3
 * + #4 (+ später #5 Approach-Analysis) konsumiert wird. Für v1 inline
 * weil die fetch-logic noch klein ist und zwischen den components
 * leicht divergieren kann (z.B. wenn #5 eine andere shape braucht).
 */

type Position = {
  indicatedAirspeed: number | null;
  verticalSpeedFpm: number | null;
  recordedAt: string;
};

type ReplayApiResponse =
  | { available: true; positions: Position[] }
  | { available: false; reason: string };

interface Props {
  pirepId: string;
}

const MAX_POINTS = 600;

function formatMinute(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

export function AircraftPerformanceChart({ pirepId }: Props) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'empty' }
    | {
        kind: 'ready';
        data: {
          tMinutes: number;
          ias: number | null;
          vsi: number | null;
        }[];
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
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: ReplayApiResponse = await res.json();
        if (cancelled) return;

        if (!json.available || json.positions.length === 0) {
          setState({ kind: 'empty' });
          return;
        }

        // Filter out positions die WEDER ias NOCH vsi haben — VATSIM/IVAO
        // tracker schreiben diese fields gar nicht, dann wäre der ganze
        // chart leer. Wenn nach dem filter 0 points übrig sind → empty.
        const usable = json.positions.filter(
          (p) =>
            p.indicatedAirspeed !== null || p.verticalSpeedFpm !== null,
        );
        if (usable.length === 0) {
          setState({ kind: 'empty' });
          return;
        }

        const sorted = [...usable].sort(
          (a, b) =>
            new Date(a.recordedAt).getTime() -
            new Date(b.recordedAt).getTime(),
        );

        const startMs = new Date(sorted[0]!.recordedAt).getTime();
        const endMs = new Date(
          sorted[sorted.length - 1]!.recordedAt,
        ).getTime();
        const durationMin = (endMs - startMs) / 60_000;

        const stride = Math.max(
          1,
          Math.ceil(sorted.length / MAX_POINTS),
        );
        const sampled = sorted.filter((_, i) => i % stride === 0);
        if (sampled[sampled.length - 1] !== sorted[sorted.length - 1]) {
          sampled.push(sorted[sorted.length - 1]!);
        }

        const data = sampled.map((p) => ({
          tMinutes:
            (new Date(p.recordedAt).getTime() - startMs) / 60_000,
          ias: p.indicatedAirspeed,
          vsi: p.verticalSpeedFpm,
        }));

        setState({ kind: 'ready', data, durationMin });
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
        Performance-Chart konnte nicht geladen werden ({state.message})
      </div>
    );
  }
  if (state.kind === 'empty') {
    return (
      <div className="h-[250px] flex items-center justify-center text-xs text-gray-500">
        Keine Performance-Daten (IAS / VSI) für diesen Flug verfügbar
      </div>
    );
  }

  return (
    <div className="w-full h-[250px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={state.data}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <XAxis
            dataKey="tMinutes"
            type="number"
            domain={[0, state.durationMin]}
            tickFormatter={formatMinute}
            tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.6 }}
            stroke="currentColor"
            strokeOpacity={0.2}
          />
          {/* Left Y: IAS in knots. Range 0-500 covers narrowbody (typical
              VMO ~340kt), longhaul/wide (typical VMO ~360kt), und hat
              etwas headroom für edge-cases. */}
          <YAxis
            yAxisId="left"
            domain={[0, 500]}
            tick={{ fontSize: 11, fill: '#0ea5e9', opacity: 0.8 }}
            stroke="#0ea5e9"
            strokeOpacity={0.4}
            width={50}
            label={{
              value: 'IAS (kt)',
              angle: -90,
              position: 'insideLeft',
              fill: '#0ea5e9',
              fontSize: 11,
              opacity: 0.8,
            }}
          />
          {/* Right Y: VSI in fpm. Symmetric domain damit climb/descent
              visuell symmetrisch sind und 0-line in der mitte. ±4000
              covers normal-ops. */}
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[-4000, 4000]}
            tick={{ fontSize: 11, fill: '#f59e0b', opacity: 0.8 }}
            stroke="#f59e0b"
            strokeOpacity={0.4}
            width={50}
            label={{
              value: 'VSI (fpm)',
              angle: 90,
              position: 'insideRight',
              fill: '#f59e0b',
              fontSize: 11,
              opacity: 0.8,
            }}
          />
          {/* Reference-line bei VSI=0 als visueller anchor für climb-vs-
              descent. */}
          <ReferenceLine
            yAxisId="right"
            y={0}
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeDasharray="2 4"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(0,0,0,0.85)',
              border: 'none',
              borderRadius: '6px',
              fontSize: '12px',
            }}
            labelStyle={{ color: '#fff' }}
            labelFormatter={(value) =>
              `T+${formatMinute(Number(value))}`
            }
            formatter={(value, name) => {
              if (value === null || value === undefined)
                return ['—', String(name)];
              const v = Number(value);
              if (name === 'ias') return [`${v} kt`, 'IAS'];
              if (name === 'vsi') return [`${v} fpm`, 'VSI'];
              return [String(value), String(name)];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: '11px' }}
            formatter={(value) => {
              if (value === 'ias') return 'IAS (kt)';
              if (value === 'vsi') return 'VSI (fpm)';
              return value;
            }}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="ias"
            stroke="#0ea5e9"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="vsi"
            stroke="#f59e0b"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
