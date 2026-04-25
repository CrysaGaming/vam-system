'use client';

import {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import Map, {
  Marker,
  NavigationControl,
  ScaleControl,
  Source,
  Layer,
  type MapRef,
} from 'react-map-gl/mapbox';
import type {
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

type LiveSession = {
  id: string;
  network: 'VATSIM' | 'IVAO';
  callsign: string;
  pilot: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
    rank: string | null;
  };
  aircraft: {
    type: string | null;
    registration: string | null;
  };
  flightPlan: {
    departure: string | null;
    arrival: string | null;
    alternate: string | null;
    cruiseAltitude: number | null;
    flightRules: string | null;
    route: string | null;
    remarks: string | null;
  };
  position: {
    latitude: number;
    longitude: number;
    altitude: number;
    groundSpeed: number;
    heading: number;
    transponder: string | null;
    onGround: boolean;
  };
  connectedAt: string;
  lastUpdatedAt: string;
};

type PublicPilot = {
  cid: number;
  callsign: string;
  latitude: number;
  longitude: number;
  altitude: number;
  groundSpeed: number;
  heading: number;
  onGround: boolean;
  aircraftType: string | null;
  departureIcao: string | null;
  arrivalIcao: string | null;
};

type EveryoneResponse = {
  vatsim: { count: number; updatedAt: string | null; pilots: PublicPilot[] };
  ivao: { count: number; updatedAt: string | null; pilots: PublicPilot[] };
};

type DecodedMetar = {
  station: string;
  observedAt: string | null;
  wind: {
    direction: number | null;
    speed: number;
    gust: number | null;
    variableFrom: number | null;
    variableTo: number | null;
  } | null;
  visibility: string | null;
  weather: string[];
  clouds: Array<{ coverage: string; base: number; type: string | null }>;
  temperature: number | null;
  dewpoint: number | null;
  pressure: { qnhHpa: number | null; altimeterInHg: number | null };
  flightCategory: 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | null;
};

type AirportWithMetar = {
  airport: {
    icao: string;
    iata: string | null;
    name: string;
    city: string | null;
    country: string;
    latitude: number;
    longitude: number;
  };
  metar: {
    raw: string;
    decoded: DecodedMetar | null;
    fetchedAt: string;
  };
};

type MetarsResponse = {
  count: number;
  airports: AirportWithMetar[];
};

type TrailPoint = {
  lat: number;
  lon: number;
  alt: number;
  gs: number;
  hdg: number;
  onGround: boolean;
  at: string;
};

const SIDEBAR_WIDTH = 360;

export function LiveMap({ mapboxToken }: { mapboxToken: string }) {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trails, setTrails] = useState<Record<string, TrailPoint[]>>({});
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [publicPilots, setPublicPilots] = useState<{
    vatsim: PublicPilot[];
    ivao: PublicPilot[];
  }>({ vatsim: [], ivao: [] });
  const mapRef = useRef<MapRef | null>(null);
  const [planeImagesLoaded, setPlaneImagesLoaded] = useState(false);
  
  const [filters, setFilters] = useState({
    memberOnly: false,
    showVatsim: true,
    showIvao: true,
    showAirports: true,
    cockpitRain: false,
    cockpitSnow: false,
  });

  const [airports, setAirports] = useState<AirportWithMetar[]>([]);
  const [selectedAirportIcao, setSelectedAirportIcao] = useState<string | null>(null);

  const selected = useMemo(
    () => sessions.find((s) => s.id === selectedId) ?? null,
    [sessions, selectedId],
  );

  // Member sessions polling
  useEffect(() => {
    let cancelled = false;

    async function fetchSessions() {
      try {
        const res = await fetch('/api/live/sessions');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setSessions(data.sessions ?? []);
          setLastFetch(new Date());
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to fetch live sessions:', err);
        if (!cancelled) setLoading(false);
      }
    }

    fetchSessions();
    const interval = setInterval(fetchSessions, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // METAR Polling (alle 5min)
  useEffect(() => {
    let cancelled = false;

    async function fetchMetars() {
      try {
        const res = await fetch('/api/live/metars');
        if (!res.ok) return;
        const data: MetarsResponse = await res.json();
        if (!cancelled) {
          setAirports(data.airports ?? []);
        }
      } catch (err) {
        console.error('Failed to fetch metars:', err);
      }
    }

    fetchMetars();
    const interval = setInterval(fetchMetars, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Cockpit Rain Effect (Mapbox native v3.9+)
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (filters.cockpitRain) {
      // setRain ist erst verfügbar nach Style-Load — fallback wenn nicht da
      if (typeof (map as unknown as { setRain?: (opts: unknown) => void }).setRain === 'function') {
        (map as unknown as { setRain: (opts: unknown) => void }).setRain({
          density: [
            'interpolate',
            ['linear'],
            ['zoom'],
            11, 0,
            13, 0.5,
          ],
          intensity: 1.0,
          color: '#a8c5e8',
          opacity: 0.7,
          vignette: [
            'interpolate',
            ['linear'],
            ['zoom'],
            11, 0,
            13, 1.0,
          ],
          'vignette-color': '#1e3a5f',
          'center-thinning': 0,
          direction: [0, 80],
          'droplet-size': [2.6, 18.2],
          'distortion-strength': 0.7,
        });
      }
    } else {
      if (typeof (map as unknown as { setRain?: (opts: unknown) => void }).setRain === 'function') {
        (map as unknown as { setRain: (opts: null) => void }).setRain(null);
      }
    }
  }, [filters.cockpitRain]);

  // Cockpit Snow Effect (Mapbox native v3.9+)
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (filters.cockpitSnow) {
      if (typeof (map as unknown as { setSnow?: (opts: unknown) => void }).setSnow === 'function') {
        (map as unknown as { setSnow: (opts: unknown) => void }).setSnow({
          density: [
            'interpolate',
            ['linear'],
            ['zoom'],
            11, 0,
            13, 0.85,
          ],
          intensity: 1.0,
          color: '#ffffff',
          opacity: 1.0,
          vignette: [
            'interpolate',
            ['linear'],
            ['zoom'],
            11, 0,
            13, 0.3,
          ],
          'vignette-color': '#ffffff',
          'center-thinning': 0.4,
          direction: [0, 50],
          'flake-size': 0.71,
        });
      }
    } else {
      if (typeof (map as unknown as { setSnow?: (opts: unknown) => void }).setSnow === 'function') {
        (map as unknown as { setSnow: (opts: null) => void }).setSnow(null);
      }
    }
  }, [filters.cockpitSnow]);

  // Public pilots polling (alle VATSIM + IVAO)
  useEffect(() => {
    let cancelled = false;

    async function fetchEveryone() {
      try {
        const res = await fetch('/api/live/everyone');
        if (!res.ok) return;
        const data: EveryoneResponse = await res.json();
        if (!cancelled) {
          setPublicPilots({
            vatsim: data.vatsim?.pilots ?? [],
            ivao: data.ivao?.pilots ?? [],
          });
        }
      } catch (err) {
        console.error('Failed to fetch everyone:', err);
      }
    }

    fetchEveryone();
    const interval = setInterval(fetchEveryone, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Trail-Loading bei Session-Click
  const loadTrail = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/live/sessions/${sessionId}/positions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTrails((prev) => ({
        ...prev,
        [sessionId]: data.positions ?? [],
      }));
    } catch (err) {
      console.error('Failed to fetch trail:', err);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    if (trails[selectedId]) return;
    void loadTrail(selectedId);
  }, [selectedId, trails, loadTrail]);

  // Trail GeoJSON
  const trailGeoJson = useMemo(() => {
    if (!selected) {
      return { type: 'FeatureCollection' as const, features: [] };
    }
    const points = trails[selected.id];
    if (!points || points.length < 2) {
      return { type: 'FeatureCollection' as const, features: [] };
    }

    const coords: [number, number][] = points.map((p) => [p.lon, p.lat]);
    coords.push([selected.position.longitude, selected.position.latitude]);

    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: { network: selected.network },
          geometry: {
            type: 'LineString' as const,
            coordinates: coords,
          },
        },
      ],
    };
  }, [selected, trails]);

  const trailColor = selected?.network === 'VATSIM' ? '#3b82f6' : '#10b981';

  const trailLayer: LineLayerSpecification = useMemo(
    () => ({
      id: 'trail-line',
      type: 'line',
      source: 'trail-source',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': trailColor,
        'line-width': 3,
        'line-opacity': 0.8,
      },
    }),
    [trailColor],
  );

  const trailGlowLayer: LineLayerSpecification = useMemo(
    () => ({
      id: 'trail-glow',
      type: 'line',
      source: 'trail-source',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': trailColor,
        'line-width': 12,
        'line-opacity': 0.25,
        'line-blur': 6,
      },
    }),
    [trailColor],
  );

  // Public-Pilot GeoJSON für Symbol-Layer
  const publicGeoJson = useMemo(() => {
    const features: GeoJSON.Feature[] = [];

    // Skip alle Public Pilots wenn "Member only" aktiv
    if (filters.memberOnly) {
      return { type: 'FeatureCollection' as const, features };
    }

    if (filters.showVatsim) {
      for (const p of publicPilots.vatsim) {
        const isMember = sessions.some(
          (s) => s.network === 'VATSIM' && s.callsign === p.callsign,
        );
        if (isMember) continue;
        features.push({
        type: 'Feature',
        properties: {
          cid: p.cid,
          callsign: p.callsign,
          network: 'VATSIM',
          heading: p.heading,
          altitude: p.altitude,
          onGround: p.onGround,
        },
        geometry: {
          type: 'Point',
          coordinates: [p.longitude, p.latitude],
        },
      });
    }

    // Schließe VATSIM-Loop
    }

    if (filters.showIvao) {
      for (const p of publicPilots.ivao) {
        const isMember = sessions.some(
          (s) => s.network === 'IVAO' && s.callsign === p.callsign,
        );
        if (isMember) continue;
        features.push({
          type: 'Feature',
          properties: {
            cid: p.cid,
            callsign: p.callsign,
            network: 'IVAO',
            heading: p.heading,
            altitude: p.altitude,
            onGround: p.onGround,
          },
          geometry: {
            type: 'Point',
            coordinates: [p.longitude, p.latitude],
          },
        });
      }
    }

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [publicPilots, sessions, filters]);

  // Airport GeoJSON
  const airportGeoJson = useMemo(() => {
    if (!filters.showAirports) {
      return { type: 'FeatureCollection' as const, features: [] };
    }
    return {
      type: 'FeatureCollection' as const,
      features: airports.map((a) => ({
        type: 'Feature' as const,
        properties: {
          icao: a.airport.icao,
          flightCategory: a.metar.decoded?.flightCategory ?? 'unknown',
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [a.airport.longitude, a.airport.latitude],
        },
      })),
    };
  }, [airports, filters.showAirports]);

  const airportSymbolLayer: SymbolLayerSpecification = useMemo(
    () => ({
      id: 'airports',
      type: 'symbol',
      source: 'airports-source',
      layout: {
        'icon-image': [
          'match',
          ['get', 'flightCategory'],
          'VFR', 'airport-vfr',
          'MVFR', 'airport-mvfr',
          'IFR', 'airport-ifr',
          'LIFR', 'airport-lifr',
          'airport-unknown',
        ],
        'icon-size': 1,
        'icon-allow-overlap': true,
        'text-field': ['get', 'icao'],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': 10,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#000000',
        'text-halo-width': 1,
      },
    }),
    [],
  );

  const publicSymbolLayer: SymbolLayerSpecification = useMemo(
    () => ({
      id: 'public-pilots',
      type: 'symbol',
      source: 'public-pilots-source',
      layout: {
        'icon-image': [
          'match',
          ['get', 'network'],
          'VATSIM',
          'plane-vatsim',
          'IVAO',
          'plane-ivao',
          'plane-vatsim',
        ],
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-size': 0.7,
      },
      paint: {
        'icon-opacity': [
          'case',
          ['==', ['get', 'onGround'], true],
          0.4,
          0.85,
        ],
      },
    }),
    [],
  );

  const initialView = useMemo(
    () => ({ longitude: 10, latitude: 50, zoom: 4 }),
    [],
  );

  const isOpen = selected !== null;

  return (
    <div
      style={{
        height: 'calc(100vh - 73px)',
        width: '100%',
        position: 'relative',
        display: 'flex',
        overflow: 'hidden',
      }}
    >
      {/* Sidebar */}
      <aside
        style={{
          width: isOpen || selectedAirportIcao ? SIDEBAR_WIDTH : 0,
          flexShrink: 0,
          transition: 'width 220ms ease',
          backgroundColor: 'rgb(17, 24, 39)',
          borderRight: isOpen || selectedAirportIcao ? '1px solid rgb(31, 41, 55)' : 'none',
          overflow: 'hidden',
        }}
      >
        {selected && (
          <SessionSidebar
            session={selected}
            trail={trails[selected.id] ?? []}
            onClose={() => setSelectedId(null)}
          />
        )}
        {selectedAirportIcao && !selected && (
          <AirportSidebar
            airportData={airports.find((a) => a.airport.icao === selectedAirportIcao) ?? null}
            onClose={() => setSelectedAirportIcao(null)}
          />
        )}
      </aside>

      {/* Map */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Map
          ref={mapRef}
          mapboxAccessToken={mapboxToken}
          initialViewState={initialView}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          onLoad={() => {
          const map = mapRef.current?.getMap();
          if (!map) return;

          // 3D Terrain via Mapbox DEM tiles
          if (!map.getSource('mapbox-dem')) {
            map.addSource('mapbox-dem', {
              type: 'raster-dem',
              url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
              tileSize: 512,
              maxzoom: 14,
            });
          }
          map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });

          // Hillshade-Layer: Berge bekommen Licht und Schatten
          if (!map.getLayer('hillshade')) {
            map.addLayer({
              id: 'hillshade',
              source: 'mapbox-dem',
              type: 'hillshade',
              paint: {
                'hillshade-exaggeration': 0.6,
                'hillshade-shadow-color': '#0a0a14',
                'hillshade-highlight-color': '#94a3b8',
                'hillshade-accent-color': '#475569',
                'hillshade-illumination-direction': 335,
                'hillshade-illumination-anchor': 'viewport',
              },
            });
          }

          // Light-Source: simulierte Sonne von Nordwesten
          map.setLight({
            anchor: 'viewport',
            color: '#fef3c7',
            intensity: 0.4,
            position: [1.15, 210, 30],
          });

          // Aviation-Atmosphäre: Horizon-Blur + Sky-Fade + Sterne im Weltraum
          map.setFog({
            range: [0.5, 10],
            color: '#0a0e1a',
            'high-color': '#1e3a5f',
            'space-color': '#000814',
            'horizon-blend': 0.05,
            'star-intensity': 0.4,
          });

          // Plane-Icons als Mapbox-Images registrieren
          const colors = {
            'plane-vatsim': '#60a5fa',
            'plane-ivao': '#34d399',
          };

         for (const [name, color] of Object.entries(colors)) {
            if (map.hasImage(name)) continue;
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M16 2 L17.5 4 L17.5 12 L29 19 L29 21.5 L17.5 18.5 L17.5 25 L20 27 L20 28.5 L16 27.2 L12 28.5 L12 27 L14.5 25 L14.5 18.5 L3 21.5 L3 19 L14.5 12 L14.5 4 Z" fill="${color}"/></svg>`;
            const img = new Image(32, 32);
            img.onload = () => {
              if (!map.hasImage(name)) {
                map.addImage(name, img);
              }
            };
            img.src = 'data:image/svg+xml;base64,' + btoa(svg);
          }

          // Airport-Icons (rund, nach Flight-Category gefärbt)
          const airportColors = {
            'airport-vfr': '#10b981',   // grün
            'airport-mvfr': '#3b82f6',  // blau
            'airport-ifr': '#f59e0b',   // orange
            'airport-lifr': '#ef4444',  // rot
            'airport-unknown': '#6b7280', // grau
          };

          for (const [name, color] of Object.entries(airportColors)) {
            if (map.hasImage(name)) continue;
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6" fill="${color}" stroke="white" stroke-width="1.5"/></svg>`;
            const img = new Image(20, 20);
            img.onload = () => {
              if (!map.hasImage(name)) {
                map.addImage(name, img);
              }
            };
            img.src = 'data:image/svg+xml;base64,' + btoa(svg);
          }

          // Click-Handler für Airport-Layer
          map.on('click', 'airports', (e) => {
            const feature = e.features?.[0];
            if (!feature) return;
            const icao = feature.properties?.icao as string;
            if (icao) {
              setSelectedAirportIcao(icao);
              setSelectedId(null); // Pilot-Sidebar schließen falls offen
            }
          });

          // Cursor-Hover über Airport
          map.on('mouseenter', 'airports', () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', 'airports', () => {
            map.getCanvas().style.cursor = '';
          });

          setPlaneImagesLoaded(true);
        }}
        >
          <NavigationControl position="top-right" visualizePitch={true} />
          <ScaleControl position="bottom-right" />

          {/* Public Pilots Layer (alle Fremde, GPU-rendered) */}
          {planeImagesLoaded && publicGeoJson.features.length > 0 && (
            <Source
              id="public-pilots-source"
              type="geojson"
              data={publicGeoJson}
            >
              <Layer {...publicSymbolLayer} />
            </Source>
          )}

          {/* Airport Layer */}
          {planeImagesLoaded && airportGeoJson.features.length > 0 && (
            <Source id="airports-source" type="geojson" data={airportGeoJson}>
              <Layer {...airportSymbolLayer} />
            </Source>
          )}

          {/* Trail Layer */}
          {trailGeoJson.features.length > 0 && (
            <Source id="trail-source" type="geojson" data={trailGeoJson}>
              <Layer {...trailGlowLayer} />
              <Layer {...trailLayer} />
            </Source>
          )}

          {/* Member Markers (DOM-basiert, klickbar) */}
          {sessions
          .filter((s) => {
            if (s.network === 'VATSIM' && !filters.showVatsim) return false;
            if (s.network === 'IVAO' && !filters.showIvao) return false;
            return true;
          })
          .map((session) => (
          <Marker
            key={session.id}
              longitude={session.position.longitude}
              latitude={session.position.latitude}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setSelectedId(
                  selectedId === session.id ? null : session.id,
                );
              }}
            >
              <PlaneIcon
                network={session.network}
                heading={session.position.heading}
                onGround={session.position.onGround}
                isSelected={selectedId === session.id}
              />
            </Marker>
          ))}
        </Map>

        {/* Filter-Toolbar (top-right unter NavigationControl) */}
        <div
          style={{
            position: 'absolute',
            top: '8rem',
            right: '0.5rem',
            padding: '0.5rem',
            backgroundColor: 'rgba(17, 24, 39, 0.92)',
            borderRadius: '0.375rem',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
            minWidth: '160px',
          }}
        >
          <div
            style={{
              fontSize: '0.65rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'rgb(107, 114, 128)',
              padding: '0 0.25rem',
            }}
          >
            Filter
          </div>

          <FilterToggle
            label="Member only"
            checked={filters.memberOnly}
            onChange={(v) =>
              setFilters((prev) => ({ ...prev, memberOnly: v }))
            }
            color="#f97316"
          />
          <FilterToggle
            label="VATSIM"
            checked={filters.showVatsim}
            onChange={(v) =>
              setFilters((prev) => ({ ...prev, showVatsim: v }))
            }
            color="#60a5fa"
          />
          <FilterToggle
            label="IVAO"
            checked={filters.showIvao}
            onChange={(v) =>
              setFilters((prev) => ({ ...prev, showIvao: v }))
            }
            color="#34d399"
          />
          <FilterToggle
            label="Airports"
            checked={filters.showAirports}
            onChange={(v) =>
              setFilters((prev) => ({ ...prev, showAirports: v }))
            }
            color="#fbbf24"
          />
          <FilterToggle
            label="Cockpit Rain"
            checked={filters.cockpitRain}
            onChange={(v) =>
              setFilters((prev) => ({ ...prev, cockpitRain: v }))
            }
            color="#60a5fa"
          />
          <FilterToggle
            label="Cockpit Snow"
            checked={filters.cockpitSnow}
            onChange={(v) =>
              setFilters((prev) => ({ ...prev, cockpitSnow: v }))
            }
            color="#e0e7ff"
          />
          <div
            style={{
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              marginTop: '0.25rem',
              paddingTop: '0.5rem',
            }}
          >
            <button
              onClick={() => {
                const map = mapRef.current?.getMap();
                if (!map) return;
                const currentPitch = map.getPitch();
                if (currentPitch < 5) {
                  map.easeTo({ pitch: 60, duration: 1000 });
                } else {
                  map.easeTo({ pitch: 0, duration: 1000 });
                }
              }}
              style={{
                width: '100%',
                padding: '0.4rem 0.5rem',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                color: 'rgb(165, 180, 252)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                borderRadius: '0.25rem',
                fontSize: '0.7rem',
                fontWeight: 600,
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                transition: 'background-color 120ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.1)';
              }}
            >
              Toggle 3D View
            </button>
          </div>
        </div>  

        {/* Status-Overlay */}
        <div
          style={{
            position: 'absolute',
            top: '1rem',
            left: '1rem',
            padding: '0.5rem 0.75rem',
            backgroundColor: 'rgba(17, 24, 39, 0.85)',
            color: 'white',
            borderRadius: '0.375rem',
            fontSize: '0.75rem',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          {loading ? (
            <span>Lade Sessions...</span>
          ) : (
            <span>
              <strong style={{ color: '#f97316' }}>{sessions.length}</strong>{' '}
              Member ·{' '}
              <span style={{ color: 'rgb(156, 163, 175)' }}>
                {publicPilots.vatsim.length} VATSIM ·{' '}
                {publicPilots.ivao.length} IVAO weltweit
              </span>
              {lastFetch && (
                <span
                  style={{ marginLeft: '0.5rem', color: 'rgb(107, 114, 128)' }}
                >
                  · {lastFetch.toLocaleTimeString('de-DE')}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function PlaneIcon({
  network,
  heading,
  onGround,
  isSelected,
}: {
  network: 'VATSIM' | 'IVAO';
  heading: number;
  onGround: boolean;
  isSelected: boolean;
}) {
  // Member: ORANGE highlight statt blau/grün
  const color = '#f97316';
  const opacity = onGround ? 0.55 : 1;
  const size = isSelected ? 36 : 30;

  return (
    <div
      style={{
        cursor: 'pointer',
        width: size,
        height: size,
        transform: `rotate(${heading}deg)`,
        transformOrigin: 'center',
        transition: 'transform 0.5s linear, width 0.2s, height 0.2s',
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill={color}
        opacity={opacity}
        style={{
          filter: isSelected
            ? `drop-shadow(0 0 10px ${color}) drop-shadow(0 0 4px ${color})`
            : `drop-shadow(0 0 4px ${color}) drop-shadow(0 0 2px rgba(0,0,0,0.7))`,
          transition: 'filter 0.2s ease',
        }}
      >
        <path d="M16 2 L17.5 4 L17.5 12 L29 19 L29 21.5 L17.5 18.5 L17.5 25 L20 27 L20 28.5 L16 27.2 L12 28.5 L12 27 L14.5 25 L14.5 18.5 L3 21.5 L3 19 L14.5 12 L14.5 4 Z" />
      </svg>
    </div>
  );
}

function SessionSidebar({
  session,
  trail,
  onClose,
}: {
  session: LiveSession;
  trail: TrailPoint[];
  onClose: () => void;
}) {
  const minutesOnline = Math.floor(
    (Date.now() - new Date(session.connectedAt).getTime()) / 60000,
  );

  return (
    <div
      style={{
        width: SIDEBAR_WIDTH,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        color: 'white',
      }}
    >
      <div
        style={{
          padding: '1rem',
          borderBottom: '1px solid rgb(31, 41, 55)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '0.5rem',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '0.25rem',
            }}
          >
            <h2
              style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                margin: 0,
                fontFamily: 'monospace',
              }}
            >
              {session.callsign}
            </h2>
            <span
              style={{
                fontSize: '0.7rem',
                padding: '0.15rem 0.5rem',
                borderRadius: '0.25rem',
                backgroundColor:
                  session.network === 'VATSIM'
                    ? 'rgba(59, 130, 246, 0.2)'
                    : 'rgba(16, 185, 129, 0.2)',
                color: session.network === 'VATSIM' ? '#93c5fd' : '#6ee7b7',
                border:
                  session.network === 'VATSIM'
                    ? '1px solid rgba(59, 130, 246, 0.4)'
                    : '1px solid rgba(16, 185, 129, 0.4)',
              }}
            >
              {session.network}
            </span>
          </div>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'rgb(156, 163, 175)',
              margin: 0,
            }}
          >
            {session.pilot.name}
            {session.pilot.rank && ` · ${session.pilot.rank}`}
          </p>
        </div>
        <button
          onClick={onClose}
          style={{
            width: '2rem',
            height: '2rem',
            borderRadius: '0.375rem',
            backgroundColor: 'rgb(31, 41, 55)',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            fontSize: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            padding: 0,
            lineHeight: 1,
          }}
          aria-label="Schließen"
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
        {(session.flightPlan.departure || session.flightPlan.arrival) && (
          <section style={{ marginBottom: '1.25rem' }}>
            <h3
              style={{
                fontSize: '0.7rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'rgb(107, 114, 128)',
                marginBottom: '0.5rem',
              }}
            >
              Flight Plan
            </h3>
            <div
              style={{
                padding: '0.75rem',
                backgroundColor: 'rgb(31, 41, 55)',
                borderRadius: '0.375rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  fontFamily: 'monospace',
                  fontSize: '1.125rem',
                  fontWeight: 600,
                }}
              >
                <span>{session.flightPlan.departure ?? '???'}</span>
                <span style={{ color: 'rgb(107, 114, 128)' }}>→</span>
                <span>{session.flightPlan.arrival ?? '???'}</span>
              </div>
              {session.flightPlan.alternate && (
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: 'rgb(156, 163, 175)',
                    marginTop: '0.25rem',
                  }}
                >
                  Alt: {session.flightPlan.alternate}
                </div>
              )}
              <div
                style={{
                  marginTop: '0.5rem',
                  display: 'flex',
                  gap: '1rem',
                  fontSize: '0.75rem',
                  color: 'rgb(156, 163, 175)',
                }}
              >
                {session.aircraft.type && (
                  <span>{session.aircraft.type}</span>
                )}
                {session.flightPlan.cruiseAltitude && (
                  <span>
                    FL{(session.flightPlan.cruiseAltitude / 100).toFixed(0)}
                  </span>
                )}
                {session.flightPlan.flightRules && (
                  <span>{session.flightPlan.flightRules}</span>
                )}
              </div>
            </div>
          </section>
        )}

        <section style={{ marginBottom: '1.25rem' }}>
          <h3
            style={{
              fontSize: '0.7rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'rgb(107, 114, 128)',
              marginBottom: '0.5rem',
            }}
          >
            Live Position
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.5rem',
            }}
          >
            <Stat
              label="Altitude"
              value={`${session.position.altitude.toLocaleString()} ft`}
            />
            <Stat
              label="Ground Speed"
              value={`${session.position.groundSpeed} kt`}
            />
            <Stat label="Heading" value={`${session.position.heading}°`} />
            <Stat
              label="Status"
              value={session.position.onGround ? 'On Ground' : 'Airborne'}
              valueColor={
                session.position.onGround ? '#fbbf24' : '#34d399'
              }
            />
            {session.position.transponder && (
              <Stat label="Transponder" value={session.position.transponder} />
            )}
            <Stat label="Online" value={`${minutesOnline} min`} />
          </div>
        </section>

        <section style={{ marginBottom: '1.25rem' }}>
          <h3
            style={{
              fontSize: '0.7rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'rgb(107, 114, 128)',
              marginBottom: '0.5rem',
            }}
          >
            Coordinates
          </h3>
          <div
            style={{
              padding: '0.5rem 0.75rem',
              backgroundColor: 'rgb(31, 41, 55)',
              borderRadius: '0.375rem',
              fontSize: '0.75rem',
              fontFamily: 'monospace',
              color: 'rgb(209, 213, 219)',
            }}
          >
            {session.position.latitude.toFixed(4)}°,{' '}
            {session.position.longitude.toFixed(4)}°
          </div>
        </section>

        {session.flightPlan.route && (
          <section style={{ marginBottom: '1.25rem' }}>
            <h3
              style={{
                fontSize: '0.7rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'rgb(107, 114, 128)',
                marginBottom: '0.5rem',
              }}
            >
              Route
            </h3>
            <div
              style={{
                padding: '0.5rem 0.75rem',
                backgroundColor: 'rgb(31, 41, 55)',
                borderRadius: '0.375rem',
                fontSize: '0.7rem',
                fontFamily: 'monospace',
                color: 'rgb(209, 213, 219)',
                wordBreak: 'break-all',
              }}
            >
              {session.flightPlan.route}
            </div>
          </section>
        )}

        {trail.length > 0 && (
          <section>
            <h3
              style={{
                fontSize: '0.7rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'rgb(107, 114, 128)',
                marginBottom: '0.5rem',
              }}
            >
              Trail
            </h3>
            <div style={{ fontSize: '0.75rem', color: 'rgb(156, 163, 175)' }}>
              {trail.length} Punkte aufgezeichnet
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function AirportSidebar({
  airportData,
  onClose,
}: {
  airportData: AirportWithMetar | null;
  onClose: () => void;
}) {
  if (!airportData) {
    return (
      <div style={{ width: SIDEBAR_WIDTH, padding: '1rem', color: 'white' }}>
        <p>Lade METAR...</p>
      </div>
    );
  }

  const { airport, metar } = airportData;
  const decoded = metar.decoded;

  const categoryColor = {
    VFR: '#10b981',
    MVFR: '#3b82f6',
    IFR: '#f59e0b',
    LIFR: '#ef4444',
  }[decoded?.flightCategory ?? 'VFR'] ?? '#6b7280';

  return (
    <div
      style={{
        width: SIDEBAR_WIDTH,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        color: 'white',
      }}
    >
      <div
        style={{
          padding: '1rem',
          borderBottom: '1px solid rgb(31, 41, 55)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '0.5rem',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, fontFamily: 'monospace' }}>
              {airport.icao}
            </h2>
            {airport.iata && (
              <span style={{ fontSize: '0.75rem', color: 'rgb(156, 163, 175)' }}>
                {airport.iata}
              </span>
            )}
            {decoded?.flightCategory && (
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '0.25rem',
                  backgroundColor: `${categoryColor}33`,
                  color: categoryColor,
                  border: `1px solid ${categoryColor}66`,
                  fontWeight: 700,
                }}
              >
                {decoded.flightCategory}
              </span>
            )}
          </div>
          <p style={{ fontSize: '0.875rem', color: 'rgb(156, 163, 175)', margin: 0 }}>
            {airport.name}
            {airport.city && airport.city !== airport.name && ` · ${airport.city}`}
            {' · '}
            {airport.country}
          </p>
        </div>
        <button
          onClick={onClose}
          style={{
            width: '2rem',
            height: '2rem',
            borderRadius: '0.375rem',
            backgroundColor: 'rgb(31, 41, 55)',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            fontSize: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            padding: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
        {/* Raw METAR */}
        <section style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgb(107, 114, 128)', marginBottom: '0.5rem' }}>
            METAR
          </h3>
          <div
            style={{
              padding: '0.75rem',
              backgroundColor: 'rgb(31, 41, 55)',
              borderRadius: '0.375rem',
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              wordBreak: 'break-all',
              lineHeight: 1.4,
              color: 'rgb(229, 231, 235)',
            }}
          >
            {metar.raw}
          </div>
        </section>

        {decoded && (
          <>
            {/* Wind & Visibility */}
            <section style={{ marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgb(107, 114, 128)', marginBottom: '0.5rem' }}>
                Wind & Visibility
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <Stat
                  label="Wind"
                  value={
                    decoded.wind
                      ? `${decoded.wind.direction !== null ? `${decoded.wind.direction.toString().padStart(3, '0')}°` : 'VRB'} @ ${decoded.wind.speed}kt${decoded.wind.gust ? ` G${decoded.wind.gust}` : ''}`
                      : 'Calm'
                  }
                />
                <Stat label="Visibility" value={decoded.visibility ?? '—'} />
              </div>
            </section>

            {/* Temperature & Pressure */}
            <section style={{ marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgb(107, 114, 128)', marginBottom: '0.5rem' }}>
                Conditions
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <Stat
                  label="Temperature"
                  value={decoded.temperature !== null ? `${decoded.temperature}°C` : '—'}
                />
                <Stat
                  label="Dewpoint"
                  value={decoded.dewpoint !== null ? `${decoded.dewpoint}°C` : '—'}
                />
                <Stat
                  label="QNH"
                  value={
                    decoded.pressure.qnhHpa
                      ? `${decoded.pressure.qnhHpa} hPa`
                      : decoded.pressure.altimeterInHg
                        ? `${decoded.pressure.altimeterInHg.toFixed(2)}"Hg`
                        : '—'
                  }
                />
                <Stat
                  label="Cloud Base"
                  value={
                    decoded.clouds.length > 0
                      ? `${decoded.clouds[0].coverage} ${decoded.clouds[0].base}ft`
                      : 'Clear'
                  }
                />
              </div>
            </section>

            {/* Weather Phenomena */}
            {decoded.weather.length > 0 && (
              <section style={{ marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgb(107, 114, 128)', marginBottom: '0.5rem' }}>
                  Weather
                </h3>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {decoded.weather.map((w) => (
                    <span
                      key={w}
                      style={{
                        padding: '0.25rem 0.5rem',
                        backgroundColor: 'rgba(245, 158, 11, 0.15)',
                        color: '#fbbf24',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontFamily: 'monospace',
                        fontWeight: 600,
                      }}
                    >
                      {w}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Cloud-Layers */}
            {decoded.clouds.length > 0 && (
              <section style={{ marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgb(107, 114, 128)', marginBottom: '0.5rem' }}>
                  Clouds
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {decoded.clouds.map((c, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '0.5rem 0.75rem',
                        backgroundColor: 'rgb(31, 41, 55)',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>
                        <strong>{c.coverage}</strong>
                        {c.type && (
                          <span style={{ marginLeft: '0.5rem', color: '#fbbf24' }}>{c.type}</span>
                        )}
                      </span>
                      <span style={{ color: 'rgb(156, 163, 175)' }}>{c.base.toLocaleString()} ft</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* Coordinates */}
        <section>
          <h3 style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgb(107, 114, 128)', marginBottom: '0.5rem' }}>
            Position
          </h3>
          <div
            style={{
              padding: '0.5rem 0.75rem',
              backgroundColor: 'rgb(31, 41, 55)',
              borderRadius: '0.375rem',
              fontSize: '0.75rem',
              fontFamily: 'monospace',
              color: 'rgb(209, 213, 219)',
            }}
          >
            {airport.latitude.toFixed(4)}°, {airport.longitude.toFixed(4)}°
          </div>
        </section>
      </div>
    </div>
  );
}

function FilterToggle({
  label,
  checked,
  onChange,
  color,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  color: string;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.35rem 0.5rem',
        backgroundColor: checked
          ? 'rgba(255, 255, 255, 0.05)'
          : 'transparent',
        border: '1px solid transparent',
        borderRadius: '0.25rem',
        color: 'white',
        cursor: 'pointer',
        fontSize: '0.75rem',
        textAlign: 'left',
        transition: 'background-color 120ms',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = checked
          ? 'rgba(255, 255, 255, 0.05)'
          : 'transparent';
      }}
    >
      <span
        style={{
          width: '0.875rem',
          height: '0.875rem',
          borderRadius: '0.2rem',
          backgroundColor: checked ? color : 'transparent',
          border: `1.5px solid ${checked ? color : 'rgb(75, 85, 99)'}`,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.6rem',
          fontWeight: 700,
          color: 'white',
        }}
      >
        {checked && '✓'}
      </span>
      <span>{label}</span>
    </button>
  );
}

function Stat({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        padding: '0.5rem 0.75rem',
        backgroundColor: 'rgb(31, 41, 55)',
        borderRadius: '0.375rem',
      }}
    >
      <div
        style={{
          fontSize: '0.65rem',
          textTransform: 'uppercase',
          color: 'rgb(107, 114, 128)',
          letterSpacing: '0.03em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontWeight: 600,
          fontSize: '0.875rem',
          marginTop: '0.15rem',
          color: valueColor ?? 'white',
        }}
      >
        {value}
      </div>
    </div>
  );
}