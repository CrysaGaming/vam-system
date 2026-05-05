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
 * Caching: Heatmap-content ändert sich nur wenn neue PIREPs approved
 * werden (typisch sub-täglich). Ein in-memory cache + ETag wäre eine
 * spätere optimierung; für MVP fragen wir live ab, der query ist
 * günstig genug (zwei groupBys + ein findMany IN-list).
 */

import { auth } from "@/auth";
import { getPirepHeatmapPoints, prisma } from "@vam/db";
import { NextResponse } from "next/server";

export async function GET() {
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

  const points = await getPirepHeatmapPoints({
    airlineId: currentUser.airlineId,
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
