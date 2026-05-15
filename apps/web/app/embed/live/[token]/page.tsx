import { prisma } from '@vam/db';
import { resolveEmbedToken } from '@/lib/embed/token';
import { notFound } from 'next/navigation';
import LiveEmbed from './_client';

/**
 * Welle N / N5 — Public live-status embed page.
 *
 * Route: /embed/live/[token]
 *
 * No auth. The token IS the credential. Renders a small card with the
 * pilot's current ALT/GS/route/callsign, polls every 8s. Designed to
 * be embedded as iframe in OBS, Twitch panel, Discord channel
 * description, etc.
 *
 * # Server-render-then-poll
 *
 * We fetch the initial state server-side so the first paint has real
 * data (not a "loading…" flash). Subsequent updates come from the
 * client polling /api/embed/state/[token].
 *
 * # 404 on invalid token
 *
 * notFound() rather than rendering an empty card — if the token is
 * bogus or revoked, the embed should clearly fail rather than show
 * a permanent "NO FLT" that could be mistaken for "pilot not flying".
 */
export const dynamic = 'force-dynamic';

export type EmbedSnapshot = {
  t: string;
  session: {
    callsign: string;
    alt: number;
    gs: number;
    hdg: number;
    dep: string | null;
    arr: string | null;
    onGnd: boolean;
    hbAge: number | null;
  } | null;
};

export default async function EmbedLivePage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const resolved = await resolveEmbedToken(token);
  if (!resolved) notFound();

  const live = await prisma.liveSession.findFirst({
    where: { userId: resolved.userId, isActive: true },
    orderBy: { lastUpdatedAt: 'desc' },
    select: {
      callsign: true,
      altitude: true,
      groundSpeed: true,
      heading: true,
      departureIcao: true,
      arrivalIcao: true,
      onGround: true,
      lastAcarsHeartbeat: true,
    },
  });

  const initial: EmbedSnapshot = {
    t: new Date().toISOString(),
    session: live
      ? {
          callsign: live.callsign,
          alt: Math.round(live.altitude),
          gs: Math.round(live.groundSpeed),
          hdg: Math.round(live.heading),
          dep: live.departureIcao,
          arr: live.arrivalIcao,
          onGnd: live.onGround,
          hbAge: live.lastAcarsHeartbeat
            ? Math.round(
                (Date.now() - live.lastAcarsHeartbeat.getTime()) / 1000,
              )
            : null,
        }
      : null,
  };

  return <LiveEmbed token={token} initial={initial} />;
}
