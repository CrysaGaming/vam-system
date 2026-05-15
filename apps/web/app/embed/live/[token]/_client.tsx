'use client';

/**
 * Welle N / N5 — Public embed client component.
 *
 * Renders a compact horizontal-card layout designed to look good at
 * 400×120 px (the recommended OBS browser-source size) but scales up
 * cleanly. Polls /api/embed/state/[token] every 8s.
 *
 * # Visual style
 *
 *   ┌────────────────────────────────────────────┐
 *   │ ●  DLH400           FL350 ↑   GS 450 kt    │
 *   │    EDDF → KJFK      HDG 285                │
 *   └────────────────────────────────────────────┘
 *
 * Dark-card backdrop with rounded corners + subtle border. Heartbeat
 * dot left, callsign + route below it, big readouts right. The card
 * itself paints a solid background so embedders don't have to deal
 * with transparency — but the layout's wrapper stays transparent, so
 * OBS chroma-keying still works if they want to remove the card.
 *
 * # Stale-detection
 *
 * Same threshold as /m/cockpit and /m/watch (30s). Opacity dim + red
 * STALE chip. On a streamer's overlay this matters — viewers shouldn't
 * see a "live flight" that's actually offline.
 */

import { useEffect, useRef, useState } from 'react';
import type { EmbedSnapshot } from './page';

const POLL_INTERVAL_MS = 8_000;
const STALE_HEARTBEAT_THRESHOLD_S = 30;

export default function LiveEmbed({
  token,
  initial,
}: {
  token: string;
  initial: EmbedSnapshot;
}) {
  const [snapshot, setSnapshot] = useState<EmbedSnapshot>(initial);
  const [now, setNow] = useState(() => new Date());
  const inFlight = useRef(false);

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
        const res = await fetch(`/api/embed/state/${token}`, {
          cache: 'no-store',
        });
        if (res.ok) {
          const json = (await res.json()) as EmbedSnapshot;
          if (!cancelled) setSnapshot(json);
        }
        // 401 (revoked mid-stream): we keep the last good snapshot
        // visible but the stale-detection will kick in within 30s as
        // hbAge advances. Better than abruptly blanking the overlay.
      } catch {
        // network blip — try again next tick
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
  }, [token]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const s = snapshot.session;
  // hbAge from server is at the moment of fetch; we add local elapsed
  // time since last poll so the stale-state advances smoothly between
  // polls instead of jumping in 8s increments.
  const lastFetchAgeS =
    (now.getTime() - new Date(snapshot.t).getTime()) / 1000;
  const effectiveHbAge =
    s?.hbAge !== null && s?.hbAge !== undefined
      ? s.hbAge + lastFetchAgeS
      : null;
  const isStale =
    !s ||
    effectiveHbAge === null ||
    effectiveHbAge > STALE_HEARTBEAT_THRESHOLD_S;

  if (!s) {
    return (
      <div className="mx-auto max-w-md p-3">
        <div className="flex items-center gap-3 rounded-lg border border-gray-700 bg-gray-900/95 p-4 text-gray-100 shadow-lg">
          <span className="inline-block h-2 w-2 rounded-full bg-gray-500" />
          <div>
            <p className="text-sm font-semibold tracking-wide">NO FLIGHT</p>
            <p className="text-xs text-gray-400">ACARS not connected</p>
          </div>
        </div>
      </div>
    );
  }

  const altLabel = s.alt >= 18000 ? `FL${Math.round(s.alt / 100)}` : `${s.alt}`;
  const altUnit = s.alt >= 18000 ? '' : ' ft';
  const route =
    s.dep && s.arr ? `${s.dep} → ${s.arr}` : s.dep ?? s.arr ?? '—';

  return (
    <div className="mx-auto max-w-md p-3">
      <div
        className={`rounded-lg border border-gray-700 bg-gray-900/95 p-4 text-gray-100 shadow-lg transition-opacity ${
          isStale ? 'opacity-50' : ''
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isStale ? 'bg-red-500' : 'bg-emerald-400'
            }`}
            aria-label={isStale ? 'stale' : 'live'}
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <p className="truncate font-mono text-base font-semibold tracking-wide">
                {s.callsign}
              </p>
              {isStale && (
                <span className="rounded-sm bg-red-600/30 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-300">
                  Stale
                </span>
              )}
              {s.onGnd && !isStale && (
                <span className="rounded-sm bg-amber-500/20 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                  On Gnd
                </span>
              )}
            </div>
            <p className="truncate font-mono text-xs text-gray-400">{route}</p>
          </div>

          <div className="text-right">
            <p className="font-mono text-xl font-bold tabular-nums leading-tight">
              {altLabel}
              {altUnit && (
                <span className="ml-0.5 text-xs font-normal text-gray-400">
                  {altUnit}
                </span>
              )}
            </p>
            <p className="font-mono text-xs tabular-nums text-gray-300">
              GS {s.gs}
              <span className="ml-2 text-gray-500">HDG {s.hdg}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
