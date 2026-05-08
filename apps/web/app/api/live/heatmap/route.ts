/**
 * Track 1 #4 — PIREP-Heatmap (9.2.6) API-route.
 *
 * Returnt die geo-punkte der eigenen-airline-PIREPs als GeoJSON
 * FeatureCollection für die mapbox-heatmap-layer auf der live-map.
 * Member-only auth analog zu /api/live/sessions.
 *
 * Output-shape (GeoJSON FeatureCollection):
 *   {
 *     type: "FeatureCollection",
 *     features: [
 *       {
 *         type: "Feature",
 *         geometry: { type: "Point", coordinates: [lng, lat] },
 *         properties: { weight: number }
 *       },
 *       ...
 *     ]
 *   }
 *
 * Mapbox heatmap-source kann das direkt als data-prop nehmen, ohne
 * client-side transformation. Die `weight`-property wird im Layer
 * via heatmap-weight expression auf die heat-intensität gemappt.
 *
 * # Track 4 #19 (Section C polish) — Timeframe-filter via ?timeframe param
 *
 * Akzeptiert `?timeframe=7d|30d|90d|all`. Default = "all" (vollständige
 * historie, das alte verhalten). Andere werte mappen auf relativen
 * sinceSubmittedAt-cutoff (now - N tage). Unbekannte werte → "all"
 * (defensiv). Validation hier statt im DB-helper damit der helper
 * agnostisch bleibt — er nimmt einen Date, das mapping ist API-policy.
 *
 * Caching: Heatmap-content ändert sich nur wenn neue PIREPs approved
 * werden (typisch sub-täglich). Ein in-memory cache + ETag wäre eine
 * spätere optimierung; für MVP fragen wir live ab, der query ist
 * günstig genug (zwei groupBys + ein findMany IN-list).
 */

import { auth } from "@/auth";
import { getPirepHeatmapPoints, prisma } from "@vam/db";
import { NextResponse } from "next/server";

/**
 * Erlaubte timeframe-werte. "all" = kein cutoff. Andere werte sind
 * tag-basierte windows (heatmap ist eine "wo wird geflogen"-langzeit-
 * sicht; sub-tag-windows wären zu noisy).
 */
type TimeframeValue = '7d' | '30d' | '90d' | 'all';
const TIMEFRAME_DAYS: Record<Exclude<TimeframeValue, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

function parseTimeframe(raw: string | null): TimeframeValue {
  if (raw === '7d' || raw === '30d' || raw === '90d' || raw === 'all') {
    return raw;
  }
  return 'all';
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true },
  });
  if (!currentUser?.airlineId) {
    // Kein airline-link = leere heatmap. Konsistent mit /api/live/sessions.
    return NextResponse.json({
      type: "FeatureCollection",
      features: [],
    });
  }

  const url = new URL(request.url);
  const timeframe = parseTimeframe(url.searchParams.get('timeframe'));

  // Map timeframe → optional sinceSubmittedAt. "all" lässt das feld
  // weg, der DB-helper interpretiert das als "no cutoff".
  let sinceSubmittedAt: Date | undefined;
  if (timeframe !== 'all') {
    const days = TIMEFRAME_DAYS[timeframe];
    sinceSubmittedAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  const points = await getPirepHeatmapPoints({
    airlineId: currentUser.airlineId,
    sinceSubmittedAt,
  });

  return NextResponse.json({
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [p.lng, p.lat],
      },
      properties: {
        weight: p.weight,
      },
    })),
  });
}
