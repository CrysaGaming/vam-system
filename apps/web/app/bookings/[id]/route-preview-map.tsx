/**
 * Track 4 #65 (Section M): Booking Route-Preview-Map.
 *
 * Lightweight SVG-rendering einer great-circle-route zwischen DEP+ARR
 * für die booking-detail-page. Bewusst KEIN react-map-gl / mapbox /
 * leaflet hier weil:
 *   - Booking-preview ist ein "quick visual" — keine zoom/pan-interaktion nötig
 *   - Mapbox braucht API-key + bandwith für tiles, hier overkill
 *   - SVG-render ist sub-millisecond + ohne external deps
 *   - Funktioniert auch ohne internet (offline-PWA-foundation für #75-79)
 *
 * Rendering-strategie:
 *   1. Equirectangular-projection (lat/lon → x/y linear). Verzerrt polar-
 *      regionen, aber für routen <5000nm visuell akzeptabel und einfach.
 *   2. Viewport auto-zoomed: bounding-box um DEP+ARR mit margin.
 *   3. Great-circle approximation via slerp (spherical linear interpolation)
 *      mit ~32 segments — die kurve sieht "korrekt-bowed" aus statt einer
 *      geraden line die geografisch unrealistic wäre für lange flüge.
 *   4. DEP + ARR als bunte dots mit labels (ICAO + city-fallback).
 *   5. Optional: distance-label in der mitte der kurve.
 *
 * Server-component-safe (kein useState/useEffect) — rendert direkt im
 * server-payload. Wird im booking-detail-page-server-render mit den schon
 * geladenen lat/lon-werten gefüttert.
 *
 * Edge-cases:
 *   - Antimeridian-crossing (z.B. KSFO → RJAA via pazifik): wir wählen
 *     den kürzeren weg (großkreis), passe wenn nötig viewport an.
 *   - Same airport (z.B. circuit-pattern, dep == arr): single dot + hint.
 */

/**
 * Slerp zwischen zwei punkten auf einer einheitssphäre.
 * Beide inputs als (lat, lon) in degrees. Output als (lat, lon) in degrees.
 * t=0 → start, t=1 → end.
 *
 * Ref: https://en.wikipedia.org/wiki/Slerp + great-circle navigation.
 */
function greatCirclePoint(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  t: number,
): [number, number] {
  const φ1 = (lat1 * Math.PI) / 180;
  const λ1 = (lon1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const λ2 = (lon2 * Math.PI) / 180;

  // Angular distance via haversine.
  const Δφ = φ2 - φ1;
  const Δλ = λ2 - λ1;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const d = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  if (d === 0) return [lat1, lon1];

  // Slerp formula on the sphere.
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  const φ = Math.atan2(z, Math.sqrt(x * x + y * y));
  const λ = Math.atan2(y, x);
  return [(φ * 180) / Math.PI, (λ * 180) / Math.PI];
}

export interface RoutePreviewMapProps {
  departure: { icao: string; name?: string; lat: number; lon: number };
  arrival: { icao: string; name?: string; lat: number; lon: number };
  distanceNm?: number | null;
}

export function RoutePreviewMap({
  departure,
  arrival,
  distanceNm,
}: RoutePreviewMapProps) {
  // Same-airport edge-case (circuit-pattern, training etc.)
  const sameAirport =
    departure.icao === arrival.icao ||
    (Math.abs(departure.lat - arrival.lat) < 0.001 &&
      Math.abs(departure.lon - arrival.lon) < 0.001);

  // Generate great-circle points (32 segments = smooth curve).
  // For same-airport, we only render the single point.
  const segments = 32;
  const points: [number, number][] = sameAirport
    ? [[departure.lat, departure.lon]]
    : Array.from({ length: segments + 1 }, (_, i) =>
        greatCirclePoint(
          departure.lat,
          departure.lon,
          arrival.lat,
          arrival.lon,
          i / segments,
        ),
      );

  // Antimeridian-handling: wenn die line eine longitude-grenze > 180° crossed
  // (z.B. KSFO -122° → RJAA +140°), wäre der kürzeste großkreis OVER den
  // pazifik (durch lon=180°). Detection: max |Δlon| zwischen consecutive
  // points > 180° = wir crossen. In dem fall verschieben wir alle east-lons
  // unter min-original-lon um 360° nach unten, damit die curve continuous
  // bleibt im rendering.
  let lons = points.map(([, lon]) => lon);
  let crossesAntimeridian = false;
  for (let i = 1; i < lons.length; i++) {
    if (Math.abs(lons[i] - lons[i - 1]) > 180) {
      crossesAntimeridian = true;
      break;
    }
  }
  if (crossesAntimeridian) {
    // Shift all points with lon > 0 down by 360, so the polyline goes
    // smoothly through negative-extended-lon space.
    lons = lons.map((lon) => (lon > 0 ? lon - 360 : lon));
  }
  const projectedPoints: [number, number][] = points.map(([lat], i) => [
    lat,
    lons[i],
  ]);

  // Bounding-box mit margin (10% padding auf jeder seite, min 2°).
  const lats = projectedPoints.map(([lat]) => lat);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const latRange = Math.max(2, maxLat - minLat);
  const lonRange = Math.max(2, maxLon - minLon);
  const padLat = latRange * 0.15;
  const padLon = lonRange * 0.15;

  const viewLatMin = minLat - padLat;
  const viewLatMax = maxLat + padLat;
  const viewLonMin = minLon - padLon;
  const viewLonMax = maxLon + padLon;

  // SVG viewBox: 400 wide x 200 tall = 2:1 (typical world-map aspect).
  // We project bounds linearly into that frame. Aspect-ratio-correction
  // damit kurze nord-süd-flüge nicht horizontal gestretcht erscheinen:
  // wir nehmen die größere range als bestimmend für scale, zentrieren rest.
  const W = 400;
  const H = 200;
  const scaleX = W / (viewLonMax - viewLonMin);
  const scaleY = H / (viewLatMax - viewLatMin);
  const scale = Math.min(scaleX, scaleY);
  const offsetX = (W - (viewLonMax - viewLonMin) * scale) / 2;
  const offsetY = (H - (viewLatMax - viewLatMin) * scale) / 2;

  function project(lat: number, lon: number): [number, number] {
    const x = (lon - viewLonMin) * scale + offsetX;
    // Y inverted: lat=maxLat → y=0 (top), lat=minLat → y=H (bottom)
    const y = (viewLatMax - lat) * scale + offsetY;
    return [x, y];
  }

  const polylinePoints = projectedPoints
    .map(([lat, lon]) => {
      const [x, y] = project(lat, lon);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const [depX, depY] = project(departure.lat, projectedPoints[0][1]);
  const lastIdx = projectedPoints.length - 1;
  const [arrX, arrY] = project(arrival.lat, projectedPoints[lastIdx][1]);

  // Midpoint für distance-label
  const midIdx = Math.floor(projectedPoints.length / 2);
  const [midX, midY] = project(
    projectedPoints[midIdx][0],
    projectedPoints[midIdx][1],
  );

  return (
    <div className="relative bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 rounded-md border border-gray-200 dark:border-gray-800 overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto"
        role="img"
        aria-label={`Route ${departure.icao} nach ${arrival.icao}`}
      >
        {/* Subtle grid für orientation. 30°-spacing in projizierten coords
            (also nicht echte grad-linien, sondern visuell hilfreich). */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={`h-${frac}`}
            x1="0"
            y1={H * frac}
            x2={W}
            y2={H * frac}
            stroke="currentColor"
            strokeOpacity="0.06"
            strokeWidth="0.5"
            className="text-gray-500"
          />
        ))}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={`v-${frac}`}
            x1={W * frac}
            y1="0"
            x2={W * frac}
            y2={H}
            stroke="currentColor"
            strokeOpacity="0.06"
            strokeWidth="0.5"
            className="text-gray-500"
          />
        ))}

        {!sameAirport && (
          <>
            {/* Great-circle route — dashed indigo */}
            <polyline
              points={polylinePoints}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="4 3"
              strokeLinecap="round"
              className="text-indigo-500 dark:text-indigo-400"
            />
            {/* Distance-label mit subtle background damit text auf line lesbar bleibt */}
            {distanceNm && (
              <g transform={`translate(${midX},${midY - 6})`}>
                <rect
                  x="-22"
                  y="-7"
                  width="44"
                  height="13"
                  rx="2"
                  className="fill-white dark:fill-gray-900"
                  fillOpacity="0.85"
                />
                <text
                  textAnchor="middle"
                  fontSize="9"
                  fontFamily="ui-monospace, monospace"
                  className="fill-gray-700 dark:fill-gray-300"
                  y="3"
                >
                  {distanceNm} nm
                </text>
              </g>
            )}
          </>
        )}

        {/* DEP marker */}
        <g transform={`translate(${depX},${depY})`}>
          <circle
            r="5"
            className="fill-emerald-500 dark:fill-emerald-400"
            stroke="white"
            strokeWidth="1.5"
          />
          <text
            x="8"
            y="3"
            fontSize="10"
            fontFamily="ui-monospace, monospace"
            fontWeight="700"
            className="fill-gray-900 dark:fill-white"
            style={{ paintOrder: 'stroke' }}
            stroke="white"
            strokeWidth="3"
            strokeOpacity="0.85"
          >
            {departure.icao}
          </text>
          <text
            x="8"
            y="3"
            fontSize="10"
            fontFamily="ui-monospace, monospace"
            fontWeight="700"
            className="fill-gray-900 dark:fill-white"
          >
            {departure.icao}
          </text>
        </g>

        {/* ARR marker (nur wenn !sameAirport) */}
        {!sameAirport && (
          <g transform={`translate(${arrX},${arrY})`}>
            <circle
              r="5"
              className="fill-rose-500 dark:fill-rose-400"
              stroke="white"
              strokeWidth="1.5"
            />
            <text
              x="8"
              y="3"
              fontSize="10"
              fontFamily="ui-monospace, monospace"
              fontWeight="700"
              className="fill-gray-900 dark:fill-white"
              style={{ paintOrder: 'stroke' }}
              stroke="white"
              strokeWidth="3"
              strokeOpacity="0.85"
            >
              {arrival.icao}
            </text>
            <text
              x="8"
              y="3"
              fontSize="10"
              fontFamily="ui-monospace, monospace"
              fontWeight="700"
              className="fill-gray-900 dark:fill-white"
            >
              {arrival.icao}
            </text>
          </g>
        )}
      </svg>

      {sameAirport && (
        <p className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-gray-600 dark:text-gray-400 bg-white/80 dark:bg-gray-900/80 px-2 py-0.5 rounded">
          Circuit-pattern · same airport
        </p>
      )}
    </div>
  );
}
