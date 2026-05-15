import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import WatchDisplay from './_watch-display';

/**
 * Welle N / N3 — Apple-Watch companion view (Path A: web-only PWA).
 *
 * Route: /m/watch
 *
 * Wrist-sized cousin of /m/cockpit. Designed for Apple-Watch Safari
 * (≈198×242 px viewport on Series 7+) but works on any small screen.
 *
 * # Why no native watchOS app
 *
 * Native watchOS requires Swift + provisioning + an Apple-Developer-
 * account + App-Store-Review — out of scope for v1. The web-only path
 * gets 80% of the value (glance-readable ALT/GS on wrist) at 5% of the
 * cost. Pilot opens vam.kevindrack.de/m/watch in Watch-Safari, adds
 * to home screen, done. Path B (native companion) tracked in
 * docs/vision/n3-apple-watch.md when there's signal.
 *
 * # What gets shown
 *
 *   ┌───────────┐
 *   │  ●  DLH   │   small header: heartbeat-dot + callsign
 *   │           │
 *   │  35000    │   massive ALT (this is the whole point)
 *   │   FT      │
 *   │           │
 *   │  GS 450   │   small GS line
 *   │  EDDF→KJFK│   tiny route
 *   └───────────┘
 *
 * Nothing else. No phase chips, no fuel, no wind. The pilot's wrist
 * has 3 cm² and a 1-second glance budget — anything beyond ALT+GS+
 * route is noise.
 *
 * # Polling
 *
 * 10s interval (vs /m/cockpit's 5s) to be kinder to the watch battery.
 * Watch-Safari does background-throttle aggressively anyway, so even
 * 10s in practice is closer to 30s when the wrist drops. That's fine
 * — the stale-detection (>30s without heartbeat) handles it.
 *
 * # Why duplicate the LiveSession-mapping vs share with /m/cockpit
 *
 * The cockpit page selects ~25 fields; watch needs ~6. Duplicating
 * the slim version here avoids over-fetching on the watch (where
 * every kB matters on cellular LTE Series). If/when we add `/m/glass`
 * or another small surface, extract a shared `getWatchSnapshot()`.
 */
export const dynamic = 'force-dynamic';

export type WatchSnapshot = {
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

export default async function MobileWatchPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  const userId = session.user.id;

  const live = await prisma.liveSession.findFirst({
    where: { userId, isActive: true },
    orderBy: { lastUpdatedAt: 'desc' },
    select: {
      callsign: true,
      altitude: true,
      groundSpeed: true,
      departureIcao: true,
      arrivalIcao: true,
      onGround: true,
      lastUpdatedAt: true,
      lastAcarsHeartbeat: true,
    },
  });

  const initial: WatchSnapshot = {
    serverTime: new Date().toISOString(),
    session: live
      ? {
          callsign: live.callsign,
          altitude: live.altitude,
          groundSpeed: live.groundSpeed,
          departureIcao: live.departureIcao,
          arrivalIcao: live.arrivalIcao,
          onGround: live.onGround,
          lastUpdatedAt: live.lastUpdatedAt.toISOString(),
          lastAcarsHeartbeat: live.lastAcarsHeartbeat?.toISOString() ?? null,
        }
      : null,
  };

  return <WatchDisplay initial={initial} />;
}
