'use client';

/**
 * Welle N / N1 — Cockpit-glance client component.
 *
 * Polls /api/mobile/state every 5s, renders huge-number readouts
 * optimized for glance use during a flight. Layout:
 *
 *   ┌────────────────────────────────────────┐
 *   │  CALLSIGN     phase-chip   DLH→EDDF   │  ← header strip
 *   │                                        │
 *   │       4 5 0 0 0                        │  ← ALT (huge)
 *   │       ALT  ft                          │
 *   │                                        │
 *   │   GS 350    IAS 280   MACH .82         │  ← row 2
 *   │                                        │
 *   │       HDG 270°       V/S +1500         │  ← row 3
 *   │                                        │
 *   │  Fuel 18.5t   Wind 270°/35   OAT -55  │  ← bottom strip
 *   └────────────────────────────────────────┘
 *
 * Bewusst minimalistisch: keine card-borders, kein chrome, schwarzer
 * hintergrund, große amber-on-black zahlen. Pilot sieht das vom
 * desk-mount und braucht keine "UI"-elemente — nur die zahlen.
 *
 * # Stale-detection
 *
 * Wenn lastAcarsHeartbeat älter als 30s ist, kriegen die zahlen
 * einen dimmer + ein roter "STALE"-banner erscheint. Pilot weiß
 * sofort dass die anzeige nicht aktuell ist.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { MobileState } from '../mobile-client';

const POLL_INTERVAL_MS = 5000;
const STALE_HEARTBEAT_THRESHOLD_S = 30;

export default function CockpitDisplay({
  initialState,
}: {
  initialState: MobileState;
}) {
  const [state, setState] = useState<MobileState>(initialState);
  const [now, setNow] = useState(() => new Date());
  const inFlight = useRef(false);

  // Poll /api/mobile/state. setTimeout-recursion (not setInterval) so
  // we never have two requests in flight concurrently.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      if (cancelled) return;
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch('/api/mobile/state', {
          cache: 'no-store',
        });
        if (res.ok) {
          const data = (await res.json()) as MobileState;
          if (!cancelled) setState(data);
        }
      } catch {
        // Silent swallow — keep showing last good state.
      } finally {
        inFlight.current = false;
        if (!cancelled) setTimeout(tick, POLL_INTERVAL_MS);
      }
    }
    const id = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, []);

  // 1Hz tick for "X seconds ago" smoothness.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const session = state.session;

  // ────────────────── Empty state ──────────────────
  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black px-6 text-center text-white">
        <p className="mb-2 text-2xl font-bold uppercase tracking-wider text-amber-400">
          Keine Session
        </p>
        <p className="text-sm text-zinc-500">
          Verbinde ACARS oder fliege auf VATSIM/IVAO.
        </p>
        <Link
          href="/m"
          className="mt-8 rounded border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500"
        >
          ← Zurück zu /m
        </Link>
      </div>
    );
  }

  // ────────────────── Staleness ──────────────────
  const heartbeatStr = session.lastAcarsHeartbeat ?? session.lastUpdatedAt;
  const ageS = Math.floor(
    (now.getTime() - new Date(heartbeatStr).getTime()) / 1000,
  );
  const stale = ageS > STALE_HEARTBEAT_THRESHOLD_S;

  const valueClass = stale
    ? 'text-amber-200/40 tabular-nums font-bold'
    : 'text-amber-300 tabular-nums font-bold';

  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      {/* ─── Header strip ─── */}
      <header className="flex items-center justify-between border-b border-zinc-900 px-4 py-2 text-xs uppercase tracking-wider">
        <div className="flex items-center gap-2">
          <Link href="/m" className="text-zinc-500 hover:text-zinc-300">
            ← /m
          </Link>
          <span className="font-mono text-base font-bold text-white">
            {session.callsign}
          </span>
          <span className="rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {session.network}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {session.currentPhase && (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-400">
              {session.currentPhase}
            </span>
          )}
          {session.departureIcao && session.arrivalIcao && (
            <span className="font-mono text-zinc-400">
              {session.departureIcao} → {session.arrivalIcao}
            </span>
          )}
        </div>
      </header>

      {/* ─── Stale banner ─── */}
      {stale && (
        <div className="bg-red-900/50 px-4 py-1 text-center text-xs font-bold uppercase tracking-wider text-red-300">
          ⚠ Stale · last data {ageS}s ago
        </div>
      )}

      {/* ─── Hero: ALT ─── */}
      <section className="flex flex-col items-center justify-center py-6">
        <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
          Altitude
        </p>
        <p
          className={`${valueClass} text-7xl leading-none sm:text-8xl`}
          aria-label="altitude in feet"
        >
          {session.altitude.toLocaleString('en-US')}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          ft{' '}
          {session.altitudeAglFt !== null &&
            ` · ${session.altitudeAglFt.toLocaleString('en-US')} AGL`}
        </p>
      </section>

      {/* ─── Row 2: GS / IAS / Mach ─── */}
      <section className="grid grid-cols-3 gap-2 border-y border-zinc-900 py-4 text-center">
        <ReadoutBig
          label="GS"
          value={session.groundSpeed.toString()}
          unit="kt"
          stale={stale}
        />
        <ReadoutBig
          label="IAS"
          value={session.indicatedAirspeed?.toString() ?? '—'}
          unit="kt"
          stale={stale}
        />
        <ReadoutBig
          label="Mach"
          value={
            session.mach !== null
              ? session.mach.toFixed(2).replace(/^0/, '')
              : '—'
          }
          unit=""
          stale={stale}
        />
      </section>

      {/* ─── Row 3: HDG / V/S ─── */}
      <section className="grid grid-cols-2 gap-2 border-b border-zinc-900 py-4 text-center">
        <ReadoutBig
          label="HDG"
          value={session.heading.toString().padStart(3, '0')}
          unit="°"
          stale={stale}
        />
        <ReadoutBig
          label="V/S"
          value={
            session.verticalSpeedFpm !== null
              ? (session.verticalSpeedFpm > 0 ? '+' : '') +
                session.verticalSpeedFpm.toString()
              : '—'
          }
          unit="fpm"
          stale={stale}
          colorize={session.verticalSpeedFpm ?? 0}
        />
      </section>

      {/* ─── Bottom strip: Fuel / Wind / OAT / flap-gear ─── */}
      <section className="grid grid-cols-2 gap-2 py-4 text-center sm:grid-cols-4">
        <ReadoutSmall
          label="Fuel"
          value={
            session.fuelTotalKg !== null
              ? `${(session.fuelTotalKg / 1000).toFixed(1)}t`
              : '—'
          }
        />
        <ReadoutSmall
          label="Wind"
          value={
            session.windDirection !== null && session.windSpeedKts !== null
              ? `${session.windDirection.toString().padStart(3, '0')}°/${session.windSpeedKts}`
              : '—'
          }
        />
        <ReadoutSmall
          label="OAT"
          value={
            session.oatCelsius !== null ? `${session.oatCelsius}°C` : '—'
          }
        />
        <ReadoutSmall
          label="N1"
          value={
            session.engineN1Avg !== null
              ? `${Math.round(session.engineN1Avg)}%`
              : '—'
          }
        />
      </section>

      {/* ─── Status flags row ─── */}
      <section className="mt-auto border-t border-zinc-900 px-4 py-3">
        <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] uppercase tracking-wider">
          <Flag on={session.onGround} label="ON GND" color="zinc" />
          <Flag on={session.parkingBrake ?? false} label="P-BRK" color="red" />
          <Flag on={session.gearDown ?? false} label="GEAR" color="green" />
          <Flag
            on={session.spoilersDeployed ?? false}
            label="SPOIL"
            color="amber"
          />
          <Flag
            on={session.autopilotMaster ?? false}
            label="AP"
            color="cyan"
          />
          {session.flapsPercent !== null && session.flapsPercent > 0 && (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-300">
              FLAPS {session.flapsPercent}%
            </span>
          )}
        </div>
        <p className="mt-2 text-center text-[10px] text-zinc-600">
          Last update {ageS}s ago · poll 5s
        </p>
      </section>
    </div>
  );
}

function ReadoutBig({
  label,
  value,
  unit,
  stale,
  colorize,
}: {
  label: string;
  value: string;
  unit: string;
  stale: boolean;
  /** Optional signed number to colorize V/S green=climb red=descent. */
  colorize?: number;
}) {
  let cls = stale ? 'text-amber-200/40' : 'text-amber-300';
  if (colorize !== undefined && !stale) {
    if (colorize > 100) cls = 'text-green-400';
    else if (colorize < -100) cls = 'text-red-400';
  }
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className={`${cls} text-4xl font-bold tabular-nums sm:text-5xl`}>
        {value}
      </p>
      {unit && <p className="text-[10px] text-zinc-600">{unit}</p>}
    </div>
  );
}

function ReadoutSmall({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className="text-lg font-bold tabular-nums text-zinc-300">{value}</p>
    </div>
  );
}

function Flag({
  on,
  label,
  color,
}: {
  on: boolean;
  label: string;
  color: 'zinc' | 'red' | 'green' | 'amber' | 'cyan';
}) {
  if (!on) {
    return (
      <span className="rounded border border-zinc-800 px-1.5 py-0.5 text-zinc-700">
        {label}
      </span>
    );
  }
  const classes: Record<typeof color, string> = {
    zinc: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300',
    red: 'border-red-500/40 bg-red-500/10 text-red-300',
    green: 'border-green-500/40 bg-green-500/10 text-green-300',
    amber: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    cyan: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  };
  return (
    <span className={`rounded border px-1.5 py-0.5 font-semibold ${classes[color]}`}>
      {label}
    </span>
  );
}
