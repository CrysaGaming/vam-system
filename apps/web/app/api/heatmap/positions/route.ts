import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@vam/db';
import {
  getPositionsHeatmap,
  type PositionsHeatmapTimeframe,
} from '@/lib/heatmap/aggregation';

/**
 * GET /api/heatmap/positions — Welle E / E5.
 *
 * Returns the position-density heatmap for the calling user's airline
 * as a GeoJSON FeatureCollection. Pairs with the existing PIREP-DEP/ARR
 * heatmap (/api/live/heatmap) as a complementary view: the PIREP layer
 * shows endpoint clusters, this one shows full flight-track density
 * including en-route corridors.
 *
 * # Auth + scoping
 *
 * Session-cookie via auth(). Cross-airline snooping disabled — the
 * heatmap reveals operational patterns competing virtual airlines
 * shouldn't see. Same convention as /api/live/heatmap (PIREP) and
 * /api/live/sessions.
 *
 * # Query params
 *
 *   ?timeframe=24h|7d|30d|all   (default: 7d)
 *
 * Note this is a different default than the PIREP-heatmap endpoint
 * (which defaults to 'all'). Position rows are far denser than PIREP
 * rows, so showing 'all' by default would be both slower-to-compute
 * AND visually noisier than a recent-window view. 7d is the sweet
 * spot for "what are we flying lately".
 *
 * Unknown values fall back to '7d'.
 *
 * # Response
 *
 * GeoJSON FeatureCollection matching the wire format that the Mapbox
 * heatmap Source already consumes for the PIREP layer — keeps the
 * client-side wiring symmetric:
 *
 *   {
 *     "type": "FeatureCollection",
 *     "features": [
 *       {
 *         "type": "Feature",
 *         "geometry": { "type": "Point", "coordinates": [lng, lat] },
 *         "properties": { "weight": <number> }
 *       },
 *       ...
 *     ]
 *   }
 *
 * Users without an airline get an empty FeatureCollection. Consistent
 * with the PIREP-heatmap behavior for the same case.
 *
 * # Caching
 *
 * The aggregator caches per (airlineId, timeframe) for 1h in-process.
 * We set Cache-Control: private, max-age=300 (5min) at the response
 * level too so a browser refresh doesn't hammer the server within
 * the cache window. Private because the data is airline-scoped — a
 * shared CDN cache would leak cross-airline.
 */

function parseTimeframe(raw: string | null): PositionsHeatmapTimeframe {
  if (raw === '24h' || raw === '7d' || raw === '30d' || raw === 'all') {
    return raw;
  }
  return '7d';
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true },
  });
  if (!currentUser?.airlineId) {
    return NextResponse.json({
      type: 'FeatureCollection',
      features: [],
    });
  }

  const url = new URL(request.url);
  const timeframe = parseTimeframe(url.searchParams.get('timeframe'));

  const cells = await getPositionsHeatmap(currentUser.airlineId, timeframe);

  return NextResponse.json(
    {
      type: 'FeatureCollection',
      features: cells.map((c) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [c.lng, c.lat],
        },
        properties: {
          weight: c.weight,
        },
      })),
    },
    {
      headers: {
        // 5min browser cache — covers a normal user-refresh cycle
        // without re-running the aggregation. The in-process cache
        // covers longer windows. 'private' so no CDN-level sharing.
        'Cache-Control': 'private, max-age=300',
      },
    },
  );
}
