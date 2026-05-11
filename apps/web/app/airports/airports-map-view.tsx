'use client';

/**
 * Track 4 #72 (Section N) — Airports Map-View
 *
 * Inline-SVG world-map (equirectangular projection) das die airports
 * aus dem aktuellen filter-set als klickbare dots darstellt. Komplement
 * zur tabellen-ansicht — wird via view-toggle im AirportBrowser
 * gewechselt.
 *
 * # Projektion
 *
 * Plate-carrée (equirectangular): lat/lon → linear y/x. Einfach genug
 * um ohne library auszukommen, distorsion an den polen ist akzeptabel
 * weil dort wenig airports liegen. viewBox 0 0 1000 500 = 2:1 ratio
 * (-180..180 deg lon → 0..1000 px, 85..-85 deg lat → 0..500 px). Wir
 * clampen lat auf ±85 weil polnahe airports (z.B. McMurdo) sonst die
 * map vertikal stretchen würden — 85° deckt > 99.9% der commercial
 * airports ab.
 *
 * # Keine landmassen
 *
 * Bewusst KEIN landmass-overlay (kein GeoJSON, kein TopoJSON, keine CDN-
 * dependency). Die airport-dots zeichnen die kontinente von selbst ein —
 * Europa, US-east, asien-küste sind klar erkennbar. Gridlines alle 30°
 * geben spatial-context. Pro: keine 100kb+ map-bibliothek bundling-cost,
 * kein cookie-consent für tile-server, konsistent mit #65 Route-Preview-
 * Map approach. Contra: leere ozeane sind nicht offensichtlich als ozeane
 * erkennbar — wir akzeptieren das weil's eine OVERVIEW-map ist, nicht
 * eine navigations-hilfe.
 *
 * # Dot-design
 *
 * Radius proportional zum airport-type (large/medium/small/heliport).
 * Color-coding spiegelt scheduledService — gelbe outline wenn die airport
 * keinen scheduled-service hat (raras, training-felder). Hover-tooltip
 * über <title>-element (native browser-tooltip, kein extra JS-state).
 * Klick öffnet /airports/[icao].
 *
 * Z-order: kleinere airports werden zuerst gerendert damit large/medium
 * darüber liegen — sonst würden 50 small-airports auf einem cluster die
 * darunter-liegenden hubs verstecken.
 */

interface MapAirport {
  id: string;
  icao: string;
  name: string;
  city: string | null;
  country: string;
  latitude: number;
  longitude: number;
  type: string | null;
  scheduledService: boolean;
}

interface AirportsMapViewProps {
  airports: MapAirport[];
}

const VIEWBOX_W = 1000;
const VIEWBOX_H = 500;
const LAT_CLAMP = 85; // Polnahe airports werden auf ±85 geclampt.

/** Equirectangular projection. Returns NaN für ungültige inputs. */
function project(lat: number, lon: number): { x: number; y: number } {
  const clampedLat = Math.max(-LAT_CLAMP, Math.min(LAT_CLAMP, lat));
  const x = ((lon + 180) / 360) * VIEWBOX_W;
  const y = ((LAT_CLAMP - clampedLat) / (2 * LAT_CLAMP)) * VIEWBOX_H;
  return { x, y };
}

/**
 * Radius pro airport-type. Small konstanten (1.5-3.5 px in viewBox-units)
 * damit auch eng-clustering europa-airports nicht zu einer einzigen
 * blob werden.
 */
function radiusForType(type: string | null): number {
  switch (type) {
    case 'large_airport':
      return 3;
    case 'medium_airport':
      return 2.2;
    case 'small_airport':
      return 1.5;
    case 'heliport':
    case 'seaplane_base':
    case 'balloonport':
      return 1.2;
    default:
      return 1.5;
  }
}

/** Z-order priority — höhere zahlen werden zuletzt gerendert (oben). */
function zOrderForType(type: string | null): number {
  switch (type) {
    case 'large_airport':
      return 4;
    case 'medium_airport':
      return 3;
    case 'small_airport':
      return 2;
    default:
      return 1;
  }
}

export function AirportsMapView({ airports }: AirportsMapViewProps) {
  // Sort by z-order (ascending) damit größere airports zuletzt
  // gerendert werden und auf clusters obenauf liegen.
  const sorted = [...airports].sort(
    (a, b) => zOrderForType(a.type) - zOrderForType(b.type),
  );

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {airports.length === 0
            ? 'Keine airports im aktuellen filter — passe die filter an um airports auf der map zu sehen.'
            : `${airports.length} airports auf der map · Klick auf einen dot öffnet die details.`}
        </p>
      </div>
      <div className="bg-gray-50 dark:bg-gray-950 p-2">
        <svg
          viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
          className="w-full h-auto"
          role="img"
          aria-label={`Weltkarte mit ${airports.length} airports`}
        >
          {/* Background: subtle ocean tint. Dark mode bekommt einen
              dunkleren ton damit die dots besser kontrastieren. */}
          <rect
            x={0}
            y={0}
            width={VIEWBOX_W}
            height={VIEWBOX_H}
            className="fill-blue-50 dark:fill-slate-900"
          />

          {/* Gridlines alle 30°. Sehr dezent damit die airport-dots
              die headline bleiben. Equator + greenwich-meridian etwas
              kräftiger als reference-lines. */}
          {[60, 30, -30, -60].map((lat) => {
            const { y } = project(lat, 0);
            return (
              <line
                key={`lat-${lat}`}
                x1={0}
                y1={y}
                x2={VIEWBOX_W}
                y2={y}
                strokeWidth={0.3}
                className="stroke-gray-300 dark:stroke-gray-700"
              />
            );
          })}
          {[-150, -120, -90, -60, -30, 30, 60, 90, 120, 150].map((lon) => {
            const { x } = project(0, lon);
            return (
              <line
                key={`lon-${lon}`}
                x1={x}
                y1={0}
                x2={x}
                y2={VIEWBOX_H}
                strokeWidth={0.3}
                className="stroke-gray-300 dark:stroke-gray-700"
              />
            );
          })}
          {/* Equator + greenwich slightly kräftiger */}
          <line
            x1={0}
            y1={VIEWBOX_H / 2}
            x2={VIEWBOX_W}
            y2={VIEWBOX_H / 2}
            strokeWidth={0.5}
            className="stroke-gray-400 dark:stroke-gray-600"
          />
          <line
            x1={VIEWBOX_W / 2}
            y1={0}
            x2={VIEWBOX_W / 2}
            y2={VIEWBOX_H}
            strokeWidth={0.5}
            className="stroke-gray-400 dark:stroke-gray-600"
          />

          {/* Airport-dots. Wrapped in <a> für native click-navigation
              (Next.js Link würde innerhalb <svg> nicht garantiert
              funktionieren). aria-label + <title> für a11y + browser-
              tooltip. */}
          {sorted.map((a) => {
            const { x, y } = project(a.latitude, a.longitude);
            // Defensive: skip airports mit ungültigen koordinaten
            // (sollte vom backend gefiltert sein, aber safety-net).
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

            const r = radiusForType(a.type);
            // Color-coding: scheduled = indigo, non-scheduled = amber.
            // Damit sieht man auf einen blick wo regular service ist.
            const fillClass = a.scheduledService
              ? 'fill-indigo-600 dark:fill-indigo-400'
              : 'fill-amber-500 dark:fill-amber-400';
            const label = `${a.icao} — ${a.name}${a.city ? `, ${a.city}` : ''} (${a.country})`;
            return (
              <a
                key={a.id}
                href={`/airports/${a.icao}`}
                className="hover:opacity-80 transition cursor-pointer"
                aria-label={label}
              >
                <title>{label}</title>
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  className={`${fillClass} stroke-white dark:stroke-gray-900`}
                  strokeWidth={0.4}
                />
              </a>
            );
          })}
        </svg>
      </div>

      {/* Legende. Drei lines: scheduled vs. non-scheduled, type-size-
          legende. Klein damit sie unter der map nicht dominiert. */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-800 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400"
          />
          Scheduled
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400"
          />
          Non-scheduled
        </span>
        <span>Größe = airport-type (Large &gt; Medium &gt; Small)</span>
      </div>

      {/* "View all matching"-link: aktuell zeigt die map nur die page
          des filter-sets (die airports-prop ist paginated). Wenn der
          user "alle 500 matching airports auf einer map" sehen will,
          müsste das backend die pagination skippen — out of scope für
          v1. Hint im footer macht das transparent. */}
      <div className="px-3 pb-3 text-xs text-gray-400 dark:text-gray-600">
        Zeigt die aktuelle seite. Filter anpassen oder mehr airports pro
        seite laden um die karte zu erweitern.
      </div>
    </div>
  );
}
