'use client';

/**
 * Welle N / N3 — Apple-Watch watch-display client component.
 *
 * Polls /api/mobile/state every 10s (vs 5s in /m/cockpit) and renders
 * a wrist-sized ALT/GS/route readout. The full MobileState is fetched
 * but only 5 fields are read — the API surface stays single, no need
 * for a dedicated /api/mobile/watch endpoint.
 *
 * # Layout
 *
 * Single centered column inside a 100vh dark surface. All type sizes
 * chosen to fit a ~198×242 Watch viewport without horizontal scroll;
 * also looks correct on a phone (the viewport is just larger).
 *
 * # Stale detection
 *
 * Identical to /m/cockpit: if lastAcarsHeartbeat is more than 30s old
 * or null, dim the numbers + show a small red STALE chip. On the
 * watch this matters more — pilot might not look at it for minutes,
 * needs to know at-a-glance if it's still live.
 *
 * # No session
 *
 * If there's no active LiveSession, show "NO FLT" instead of zeros.
 * Anything else (a 0 ft altitude on the ground) would be confusing.
 */

import { useEffect, useRef, useState } from 'react';
import type { WatchSnapshot } from './page';

const POLL_INTERVAL_MS = 10_000;
const STALE_HEARTBEAT_THRESHOLD_S = 30;

type MobileApiResponse = {
  serverTime: string;
  session: {
    callsign: string;
    altitude: number;
    groundSpeed: number;
    departureIcao: string | null;
    arrivalIcao: string | null;
    onGround: boolean;
    lastUpdatedAt: string;
    lastAcarsHeartbeat: string | null;
  } | null;
};

export default function WatchDisplay({
  initial,
}: {
  initial: WatchSnapshot;
}) {
  const [snapshot, setSnapshot] = useState<WatchSnapshot>(initial);
  const [now, setNow] = useState(() => new Date());
  const inFlight = useRef(false);

  // Poll loop: setTimeout-recursion with in-flight guard so we never
  // queue two requests if the watch is throttled. /api/mobile/state
  // returns the full MobileState; we discard everything but the 6
  // fields we render.
  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled) return;
      if (inFlight.current) {
        timeout = setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }
      inFlight.current = true;
      try {
        const res = await fetch('/api/mobile/state', {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (res.ok) {
          const json = (await res.json()) as MobileApiResponse;
          if (!cancelled) {
            // The API returns the full MobileState shape; we re-pick
            // only what the watch renders. This keeps the WatchSnapshot
            // contract tight even if /api/mobile/state grows fields.
            setSnapshot({
              serverTime: json.serverTime,
              session: json.session
                ? {
                    callsign: json.session.callsign,
                    altitude: json.session.altitude,
                    groundSpeed: json.session.groundSpeed,
                    departureIcao: json.session.departureIcao,
                    arrivalIcao: json.session.arrivalIcao,
                    onGround: json.session.onGround,
                    lastUpdatedAt: json.session.lastUpdatedAt,
                    lastAcarsHeartbeat: json.session.lastAcarsHeartbeat,
                  }
                : null,
            });
          }
        }
      } catch {
        // Network blip — let the next tick try. The "now" interval
        // below keeps the stale-indicator updating regardless.
      } finally {
        inFlight.current = false;
        if (!cancelled) timeout = setTimeout(tick, POLL_INTERVAL_MS);
      }
    }

    timeout = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  // Local clock tick — keeps the stale-detection live even if polling
  // is paused/throttled by Watch-Safari. 1s is fine; the only thing it
  // drives is the dim/STALE state, which the eye doesn't need ms-
  // precision on.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const s = snapshot.session;
  const heartbeatAgeS = s?.lastAcarsHeartbeat
    ? (now.getTime() - new Date(s.lastAcarsHeartbeat).getTime()) / 1000
    : null;
  const isStale =
    !s ||
    heartbeatAgeS === null ||
    heartbeatAgeS > STALE_HEARTBEAT_THRESHOLD_S;

  // No active session — keep the chrome but show "NO FLT". Pilots who
  // open the watch app before connecting MSFS shouldn't see a blank.
  if (!s) {
    return (
      <main className="flex h-screen flex-col items-center justify-center bg-black p-2 text-amber-300">
        <p className="text-3xl font-bold tracking-tight">NO FLT</p>
        <p className="mt-1 text-[10px] uppercase tracking-widest text-amber-300/40">
          start ACARS
        </p>
      </main>
    );
  }

  const altFt = Math.max(0, Math.round(s.altitude));
  // Below FL180, show raw ft; at/above, show FLxxx. Same convention
  // as the cockpit display so pilots get consistent reads across
  // surfaces.
  const altLabel = altFt >= 18000 ? `FL${Math.round(altFt / 100)}` : `${altFt}`;
  const altUnit = altFt >= 18000 ? '' : 'FT';

  const gs = Math.max(0, Math.round(s.groundSpeed));
  const route =
    s.departureIcao && s.arrivalIcao
      ? `${s.departureIcao}→${s.arrivalIcao}`
      : s.departureIcao ?? s.arrivalIcao ?? '—';

  return (
    <main
      className={`flex h-screen flex-col items-center justify-between bg-black px-2 py-2 text-amber-300 ${
        isStale ? 'opacity-50' : ''
      }`}
    >
      {/* Header strip: heartbeat dot + callsign + optional STALE chip. */}
      <header className="flex w-full items-center justify-between text-[10px] uppercase tracking-widest">
        <span className="flex items-center gap-1">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isStale ? 'bg-red-500' : 'bg-emerald-400'
            }`}
            aria-label={isStale ? 'stale' : 'live'}
          />
          <span className="font-mono text-amber-300/70">{s.callsign}</span>
        </span>
        {isStale && (
          <span className="rounded-sm bg-red-600/30 px-1 font-bold text-red-300">
            STALE
          </span>
        )}
      </header>

      {/* ALT — the whole point. Massive. */}
      <div className="flex flex-col items-center leading-none">
        <span className="font-mono text-5xl font-black tracking-tight tabular-nums sm:text-6xl">
          {altLabel}
        </span>
        {altUnit && (
          <span className="mt-0.5 text-[10px] uppercase tracking-[0.2em] text-amber-300/50">
            {altUnit}
          </span>
        )}
      </div>

      {/* GS + route. Small. */}
      <footer className="flex w-full flex-col items-center gap-0.5">
        <span className="font-mono text-base tabular-nums">
          <span className="text-amber-300/50">GS </span>
          {gs}
        </span>
        <span className="font-mono text-[10px] text-amber-300/60">
          {route}
        </span>
        {s.onGround && (
          <span className="rounded-sm bg-amber-300/10 px-1 text-[9px] uppercase tracking-widest text-amber-300/70">
            on gnd
          </span>
        )}
      </footer>
    </main>
  );
}
