import { prisma } from '@vam/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Innovation-Item #3 (Track 3 #11.2.5 v1-Full Widget) — PIREP-Heatmaps.
 * vision-doc §9.1.1.
 *
 * # Was zeigt das?
 *
 * Welt-map mit dots an den airports wo PIREPs am häufigsten landen oder
 * starten. Dot-größe ist log-skaliert nach PIREP-count, dot-color ist
 * eine warm-heat-gradient (yellow → orange → red für mehr aktivität).
 * Zeigt sofort: wo passiert was auf der plattform.
 *
 * # Implementation
 *
 * Pure SVG, server-component, NO client-JS. Equirectangular-projection
 * (lineares lat/lng-mapping, gut genug für hot-spot-übersicht ohne dass
 * wir mapbox-gl + GeoJSON dependency reinziehen müssen). Background ist
 * ein dark canvas mit subtilem grid (lat/lng-lines alle 30°).
 *
 * Aggregation: top 80 airports nach total-PIREP-count (departure +
 * arrival). 80 weil mehr dots überlappen visuell (welt-zonen wie europa
 * werden zu blob), weniger gibt zu sparse view.
 *
 * # Performance
 *
 * Single GROUP BY-query auf Pirep × Airport. Bei 10k PIREPs trivial,
 * bei 1M+ würde ein materialized-view sinn machen. Für jetzt direct
 * query ohne caching — `revalidate=30` auf der page reicht für freshness.
 *
 * # Caveats
 *
 * - Atlantic-pacific-split: dots auf longitudes nahe ±180 erscheinen am
 *   linken/rechten rand. Equirectangular hat keine smooth-wrap. Kein
 *   problem für die meiste activity (zentrum-europa+nordamerika+asien).
 *
 * - Polar-distortion: dots am pol sind weit auseinander auch wenn sie
 *   geografisch nah sind. Kein issue weil airports am pol sind
 *   praktisch nie (paar antarktis-stationen).
 *
 * - Aerodrome-cluster: zwei airports am selben airport-komplex (z.B.
 *   EDDF + EDFH) liegen auf der map fast übereinander. Dots overlap
 *   sichtbar — bei v2 könnte man cluster-jitter addieren.
 */

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 500;
const TOP_N_AIRPORTS = 80;

interface AirportHotspot {
  icao: string;
  name: string;
  latitude: number;
  longitude: number;
  count: number;
}

function projectToSvg(latitude: number, longitude: number): { x: number; y: number } {
  const x = ((longitude + 180) / 360) * VIEWBOX_WIDTH;
  const y = ((90 - latitude) / 180) * VIEWBOX_HEIGHT;
  return { x, y };
}

/**
 * Heat-color basierend auf relativem rang (0..1, wobei 0 = coldest, 1 =
 * hottest). Yellow → Orange → Red gradient.
 */
function heatColor(t: number): string {
  // t in [0, 1]. Interpoliere yellow #fde047 → orange #fb923c → red #ef4444
  if (t < 0.5) {
    const k = t * 2; // 0..1
    const r = Math.round(0xfd + (0xfb - 0xfd) * k);
    const g = Math.round(0xe0 + (0x92 - 0xe0) * k);
    const b = Math.round(0x47 + (0x3c - 0x47) * k);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const k = (t - 0.5) * 2; // 0..1
    const r = Math.round(0xfb + (0xef - 0xfb) * k);
    const g = Math.round(0x92 + (0x44 - 0x92) * k);
    const b = Math.round(0x3c + (0x44 - 0x3c) * k);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

async function getHotspots(): Promise<AirportHotspot[]> {
  // Departure + arrival counts in einem query — wir brauchen die summe.
  // Prisma hat kein native UNION, also zwei groupBy + merge in app-code.
  const [depCounts, arrCounts] = await Promise.all([
    prisma.pirep.groupBy({
      by: ['departureId'],
      _count: true,
    }),
    prisma.pirep.groupBy({
      by: ['arrivalId'],
      _count: true,
    }),
  ]);

  const totals = new Map<string, number>();
  for (const row of depCounts) {
    totals.set(row.departureId, (totals.get(row.departureId) ?? 0) + row._count);
  }
  for (const row of arrCounts) {
    totals.set(row.arrivalId, (totals.get(row.arrivalId) ?? 0) + row._count);
  }

  if (totals.size === 0) return [];

  // Top-N airport-IDs by total
  const topIds = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N_AIRPORTS)
    .map(([id]) => id);

  // Resolve airport-data
  const airports = await prisma.airport.findMany({
    where: { id: { in: topIds } },
    select: { id: true, icao: true, name: true, latitude: true, longitude: true },
  });

  return airports
    .map((a) => ({
      icao: a.icao,
      name: a.name,
      latitude: a.latitude,
      longitude: a.longitude,
      count: totals.get(a.id) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export async function PirepHeatmap() {
  const hotspots = await getHotspots();
  const maxCount = hotspots.length > 0 ? hotspots[0].count : 1;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span aria-hidden="true">🌍</span>
          <span>PIREP-Heatmap</span>
        </CardTitle>
        <CardDescription>
          Top {TOP_N_AIRPORTS} Airports nach PIREP-Aktivität (Departure + Arrival summiert).
          {hotspots.length > 0 && (
            <span className="ml-2">
              Heißester Punkt: <strong>{hotspots[0].icao}</strong> mit{' '}
              {hotspots[0].count.toLocaleString('de-DE')} PIREPs.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hotspots.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
            Noch keine PIREPs in der Datenbank.
          </p>
        ) : (
          <div className="relative w-full bg-gray-900 dark:bg-black rounded overflow-hidden">
            <svg
              viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
              className="w-full h-auto"
              role="img"
              aria-label="PIREP-Aktivität als Punkte auf einer Welt-Map"
            >
              {/* Grid: longitude every 30°, latitude every 30° */}
              <g stroke="rgb(55, 65, 81)" strokeWidth="0.5" opacity="0.5">
                {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((lng) => {
                  const x = ((lng + 180) / 360) * VIEWBOX_WIDTH;
                  return <line key={`lng-${lng}`} x1={x} y1={0} x2={x} y2={VIEWBOX_HEIGHT} />;
                })}
                {[-60, -30, 0, 30, 60].map((lat) => {
                  const y = ((90 - lat) / 180) * VIEWBOX_HEIGHT;
                  return <line key={`lat-${lat}`} x1={0} y1={y} x2={VIEWBOX_WIDTH} y2={y} />;
                })}
              </g>

              {/* Equator emphasized */}
              <line
                x1={0}
                y1={VIEWBOX_HEIGHT / 2}
                x2={VIEWBOX_WIDTH}
                y2={VIEWBOX_HEIGHT / 2}
                stroke="rgb(75, 85, 99)"
                strokeWidth="0.8"
                opacity="0.7"
              />

              {/* Hotspot dots */}
              {hotspots.map((h) => {
                const { x, y } = projectToSvg(h.latitude, h.longitude);
                const t = h.count / maxCount; // 0..1 relative
                const radius = 3 + Math.log10(h.count + 1) * 4; // log scaling
                const color = heatColor(t);

                return (
                  <g key={h.icao}>
                    {/* Glow halo */}
                    <circle cx={x} cy={y} r={radius * 1.8} fill={color} opacity="0.15" />
                    <circle cx={x} cy={y} r={radius} fill={color} opacity="0.85">
                      <title>
                        {h.icao} — {h.name}: {h.count.toLocaleString('de-DE')} PIREPs
                      </title>
                    </circle>
                  </g>
                );
              })}
            </svg>

            {/* Legende rechts unten */}
            <div className="absolute bottom-2 right-2 bg-gray-800/80 dark:bg-black/80 text-xs text-gray-300 px-2 py-1 rounded flex items-center gap-2 backdrop-blur">
              <span>kalt</span>
              <span
                className="inline-block w-12 h-1 rounded"
                style={{
                  background:
                    'linear-gradient(to right, rgb(253, 224, 71), rgb(251, 146, 60), rgb(239, 68, 68))',
                }}
              />
              <span>heiß</span>
            </div>
          </div>
        )}

        {/* Top-5 sidebar als textuelle abfrage-bestätigung */}
        {hotspots.length > 0 && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
            {hotspots.slice(0, 5).map((h, i) => (
              <div
                key={h.icao}
                className="text-center p-2 rounded bg-gray-50 dark:bg-gray-800/50"
              >
                <div className="text-xs text-gray-500 dark:text-gray-400">#{i + 1}</div>
                <div className="font-mono text-sm font-semibold">{h.icao}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {h.count.toLocaleString('de-DE')}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
