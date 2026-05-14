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
import { useLiveMapStore, DEFAULT_FILTERS } from '@/lib/stores/live-map-store';

type LiveSession = {
  id: string;
  network: 'VATSIM' | 'IVAO' | 'Offline';
  // Welle 9 commit 9E: telemetry source. Independent of `network` —
  // a pilot can be on VATSIM (network) AND have ACARS_CLIENT (dataSource)
  // feeding 1-2s telemetry. The sidebar renders a quality-tier badge
  // based on this so streamers/observers can tell at a glance whether
  // a track is high-fidelity (ACARS) or 30s-polled (VATSIM_API/IVAO_API).
  dataSource: 'VATSIM_API' | 'IVAO_API' | 'ACARS_CLIENT' | 'MANUAL' | 'REPLAY';
  callsign: string;
  pilot: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
    rank: string | null;
    // Welle 14C: Twitch-live-status. Wenn der pilot grade auf twitch
    // streamt, zeigt der SessionSidebar einen "🔴 LIVE"-badge neben
    // dem namen mit link zu twitch.tv/{username}. Beide felder kommen
    // vom /api/live/sessions endpoint (User.twitchIsLive/twitchUsername
    // durchgereicht).
    twitchIsLive: boolean;
    twitchUsername: string | null;
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

/**
 * Berechnet Distanz und ETA von der aktuellen Position
 * zum Arrival-Airport, falls bekannt.
 */
function computeProgress(
  session: LiveSession,
  airports: AirportWithMetar[],
): { distanceKm: number | null; etaMinutes: number | null } {
  if (!session.flightPlan.arrival) {
    return { distanceKm: null, etaMinutes: null };
  }
  const arrival = airports.find(
    (a) => a.airport.icao === session.flightPlan.arrival,
  );
  if (!arrival) {
    return { distanceKm: null, etaMinutes: null };
  }

  // Haversine
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = session.position.latitude;
  const lng1 = session.position.longitude;
  const lat2 = arrival.airport.latitude;
  const lng2 = arrival.airport.longitude;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  const distanceKm = 2 * R * Math.asin(Math.sqrt(a));

  // ETA: distanceKm / groundSpeed
  // groundSpeed in knots → km/h: 1kt = 1.852 km/h
  const groundSpeedKmh = session.position.groundSpeed * 1.852;
  let etaMinutes: number | null = null;
  if (groundSpeedKmh > 30) {
    // Ignore taxi/parked: nur ETA wenn airborne mit sinnvoller Speed
    etaMinutes = (distanceKm / groundSpeedKmh) * 60;
  }

  return { distanceKm, etaMinutes };
}

/**
 * Track 4 #32: Distanz/ETA für Public-Pilots (VATSIM/IVAO).
 *
 * Mirror von computeProgress, aber für PublicPilot — flache fields
 * statt nested flightPlan/position. Erwartet einen ICAO-airport-array
 * (kann der live-map airports[]-state sein) damit wir target-coords
 * lookup'en können. ETA-gate identisch (>30 kt ground-speed) damit
 * geparkte/taxi'ende pilots keine sinnlose ETA produzieren.
 */
function computePublicProgress(
  pilot: PublicPilot,
  airports: AirportWithMetar[],
): { distanceKm: number | null; etaMinutes: number | null } {
  if (!pilot.arrivalIcao) {
    return { distanceKm: null, etaMinutes: null };
  }
  const arrival = airports.find((a) => a.airport.icao === pilot.arrivalIcao);
  if (!arrival) {
    return { distanceKm: null, etaMinutes: null };
  }

  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = pilot.latitude;
  const lng1 = pilot.longitude;
  const lat2 = arrival.airport.latitude;
  const lng2 = arrival.airport.longitude;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const distanceKm = 2 * R * Math.asin(Math.sqrt(a));

  const groundSpeedKmh = pilot.groundSpeed * 1.852;
  let etaMinutes: number | null = null;
  if (groundSpeedKmh > 30) {
    etaMinutes = (distanceKm / groundSpeedKmh) * 60;
  }

  return { distanceKm, etaMinutes };
}

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
  
  // Track 3 #11.2.3: filter-state migrated zu zustand-store. Single
  // setFilter (key, value) für individual toggles, applyFilters (partial)
  // für multi-field updates (autoWeather-tick z.B.). Alle filters via
  // persist-middleware in localStorage gespeichert — beim page-reload
  // sind die settings noch da.
  const {
    setFilter,
    setFilters: applyFilters,
    resetFilters,
    ...filters
  } = useLiveMapStore();

  // Track 4 #33 (Section F): Counter wie viele Filter abweichen vom default.
  // Iteriert über DEFAULT_FILTERS und vergleicht mit dem aktuellen state.
  // Display: "Filter (N aktiv)" wenn N>0, sonst nur "Filter". Reset-button
  // unten in der toolbar nutzt resetFilters() aus dem store.
  //
  // Subtilität: filters ist nach destructure ein REST-objekt — keine
  // referential stability garantiert. useMemo[filters] re-running on jeder
  // store-update ist fine, der computation ist O(10) lookups.
  const activeFilterCount = useMemo(() => {
    let count = 0;
    for (const key of Object.keys(DEFAULT_FILTERS) as Array<keyof typeof DEFAULT_FILTERS>) {
      if (filters[key] !== DEFAULT_FILTERS[key]) count++;
    }
    return count;
  }, [filters]);

  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);

  const [mapZoom, setMapZoom] = useState(2);

  const [radarTileUrl, setRadarTileUrl] = useState<string | null>(null);
  
  const [airports, setAirports] = useState<AirportWithMetar[]>([]);
  const [selectedAirportIcao, setSelectedAirportIcao] = useState<string | null>(null);

  // Track 1 #2 (Live-Map Search-Bar + Click-Public-Pilots, 9.2.5):
  // Identification eines public pilots (non-member auf VATSIM/IVAO) ist
  // (network, cid) — callsign allein nicht eindeutig (mehrere networks
  // können denselben callsign nutzen, z.B. wenn wer parallel
  // verbunden ist). cid ist pro-network unique.
  const [selectedPublicPilot, setSelectedPublicPilot] = useState<{
    network: 'VATSIM' | 'IVAO';
    cid: number;
  } | null>(null);

  // Track 1 #2: Search-bar query + dropdown-open state. Query trim+upper
  // beim filtering (callsigns sind upper-case in beiden networks).
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // Track 4 #31 (Section F): Follow-Mode. Wenn gesetzt, fliegt die map
  // automatisch mit dem getrackten pilot mit, wenn neue position-updates
  // kommen (alle 30s für member sessions, alle 30s für public pilots).
  // Discriminated union: kind unterscheidet die quelle (member-session
  // via id, public-pilot via network+cid). Beim toggle-click in der
  // jeweiligen sidebar wird der state gesetzt; beim wechsel auf einen
  // anderen pilot oder beim close der sidebar wird er auf null geclearred
  // (kein "ghost-follow" wenn man eigentlich nicht mehr auf den pilot
  // schaut). Polling-tick triggered den fly-effekt unten via useEffect
  // mit [followedTarget, sessions, publicPilots] als deps.
  const [followedTarget, setFollowedTarget] = useState<
    | { kind: 'session'; id: string }
    | { kind: 'public'; network: 'VATSIM' | 'IVAO'; cid: number }
    | null
  >(null);

  // Track 4 #34 (Section F): Search-history. localStorage-backed liste
  // der zuletzt erfolgreich angeklickten search-queries (max 8, unique).
  // Lazy-init aus localStorage damit der erste render keinen layout-shift
  // zeigt. Wird beim search-result-click via pushSearchHistory ergänzt.
  // Anzeige: wenn search-bar offen UND query leer UND history nicht leer,
  // rendern wir history-chips statt der "kein result"-leeren-section.
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem('vam:live-map-search-history');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Defensive: filter auf strings (falls user manuell die storage
      // editiert hat) und cap auf 8.
      return parsed.filter((x) => typeof x === 'string').slice(0, 8);
    } catch {
      return [];
    }
  });

  // Track 4 #34: Helper zum recorden eines erfolgreich genutzten search-
  // queries. Trim+upper für consistency mit dem search-matching, dedupe
  // (entferne existing entry vor unshift), cap auf 8. Synchron localStorage-
  // write damit beim refresh der state da ist. Stille-failure bei storage-
  // errors (private-mode etc.) — die UI degraded gracefully, history-row
  // ist dann einfach leer.
  const pushSearchHistory = useCallback((rawQuery: string) => {
    const q = rawQuery.trim().toUpperCase();
    if (q.length < 2) return; // nicht recorden wenn unsinnig kurz
    setSearchHistory((prev) => {
      const without = prev.filter((entry) => entry !== q);
      const next = [q, ...without].slice(0, 8);
      try {
        window.localStorage.setItem(
          'vam:live-map-search-history',
          JSON.stringify(next),
        );
      } catch {
        // storage write failed — kein retry, history bleibt in-memory.
      }
      return next;
    });
  }, []);

  const clearSearchHistory = useCallback(() => {
    setSearchHistory([]);
    try {
      window.localStorage.removeItem('vam:live-map-search-history');
    } catch {
      // ditto
    }
  }, []);

  // Track 1 #4 (PIREP-Heatmap, 9.2.6): GeoJSON-feature-collection von
  // approved-PIREP-departure+arrival-counts. Lazy-loaded — nur beim
  // ersten enable des heatmap-toggles, dann gecached für die gesamte
  // session-dauer. Heatmap-content ändert sich nur bei neuen approvals
  // (typisch sub-täglich), refresh-rate ist nicht kritisch.
  //
  // Track 4 #19 (Section C polish): Timeframe-selector. Beim wechsel
  // zwischen 7d/30d/90d/all wird die heatmap re-fetched (state →
  // dependency vom useEffect, der heatmapData wieder auf null cleart
  // wenn der timeframe wechselt). Filter passiert server-seitig in
  // /api/live/heatmap?timeframe=...
  const [heatmapData, setHeatmapData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapTimeframe, setHeatmapTimeframe] = useState<'7d' | '30d' | '90d' | 'all'>('all');

  // Welle E / E5 — Position-track-heatmap state. Mirror-pattern of the
  // PIREP-heatmap above: lazy-loaded GeoJSON, re-fetched on timeframe
  // change. Default-timeframe '7d' rather than 'all' because the
  // position-row volume is orders of magnitude higher than PIREP
  // count — 'all' on day 1 of a busy airline can already top 5M rows,
  // and the visual is noisier when over-bucketed. 24h/7d/30d/all keep
  // the same UI affordance as the PIREP timeframe segment.
  const [tracksHeatmapData, setTracksHeatmapData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [tracksHeatmapLoading, setTracksHeatmapLoading] = useState(false);
  const [tracksHeatmapTimeframe, setTracksHeatmapTimeframe] = useState<'24h' | '7d' | '30d' | 'all'>('7d');

  const selected = useMemo(
    () => sessions.find((s) => s.id === selectedId) ?? null,
    [sessions, selectedId],
  );

  // Track 1 #2: Resolved public pilot from selectedPublicPilot lookup-key.
  // Gibt null zurück wenn der pilot zwischen click und render verschwunden
  // ist (VATSIM/IVAO datafeed-update zwischen poll-cycles), oder wenn
  // selectedPublicPilot null ist.
  const selectedPublic = useMemo(() => {
    if (!selectedPublicPilot) return null;
    const list =
      selectedPublicPilot.network === 'VATSIM'
        ? publicPilots.vatsim
        : publicPilots.ivao;
    return list.find((p) => p.cid === selectedPublicPilot.cid) ?? null;
  }, [selectedPublicPilot, publicPilots]);

  // Track 1 #2: Map-navigation helper. Animiert zur ziel-position mit
  // sinnvollem zoom (8 ist airport-region — sieht den pilot + umgebung
  // ohne den globus zu stark zu zoomen). 1.5s duration ist langsam genug
  // dass der user die fly-bewegung als orientierung wahrnimmt.
  const flyToCoords = useCallback(
    (longitude: number, latitude: number) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      map.flyTo({
        center: [longitude, latitude],
        zoom: 8,
        duration: 1500,
        essential: true,
      });
    },
    [],
  );

  // Track 1 #2: Mutual-exclusion-helpers für die drei sidebar-quellen
  // (member session, public pilot, airport). Selektieren von einem
  // schließt die anderen beiden — sonst gäbe es ein chaotisches "alle
  // drei sidebars wären offen aber überlappen sich"-rendering. Wir
  // wählen welche per zustand: ein zustand öffnet, die anderen werden
  // geclearred.
  const selectMemberSession = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedPublicPilot(null);
    setSelectedAirportIcao(null);
    // Track 4 #31: target-wechsel → follow-mode aus. Anders wäre verwirrend
    // (man klickt auf einen anderen pilot, die map fliegt zum vorherigen
    // weiter). Re-enable explizit per follow-toggle in der neuen sidebar.
    setFollowedTarget(null);
  }, []);

  const selectPublicPilot = useCallback(
    (network: 'VATSIM' | 'IVAO', cid: number) => {
      setSelectedPublicPilot({ network, cid });
      setSelectedId(null);
      setSelectedAirportIcao(null);
      setFollowedTarget(null);
    },
    [],
  );

  // Track 4 #31: Toggle-helper für Follow-Mode in den sidebars. Nimmt das
  // target und togglet — wenn schon dasselbe target gefolgt wird, off;
  // sonst on. Kommt als prop runter zu Session/PublicPilotSidebar.
  const toggleFollow = useCallback(
    (
      target:
        | { kind: 'session'; id: string }
        | { kind: 'public'; network: 'VATSIM' | 'IVAO'; cid: number },
    ) => {
      setFollowedTarget((prev) => {
        if (!prev) return target;
        // Same-target check → off
        if (target.kind === 'session' && prev.kind === 'session' && prev.id === target.id) {
          return null;
        }
        if (
          target.kind === 'public' &&
          prev.kind === 'public' &&
          prev.network === target.network &&
          prev.cid === target.cid
        ) {
          return null;
        }
        // Different target → switch
        return target;
      });
    },
    [],
  );

  // Track 4 #31: Auto-fly bei position-updates wenn follow-mode aktiv.
  // Liest die aktuelle position aus sessions/publicPilots (deps re-fire
  // beim 30s-poll-tick) und easeTo-t map dorthin. easeTo statt flyTo:
  // kürzere/sanftere animation passt besser zum periodischen update —
  // flyTo's 1.5s zoom-out/zoom-in würde bei jedem 30s-tick zu motion-
  // sickness führen.
  //
  // Zoom wird NICHT geändert (dritter param weggelassen) damit der user
  // selbst zoomen kann — wir zentrieren nur. Wenn das target verschwindet
  // (pilot disconnected zwischen polls), passiert nichts; beim nächsten
  // poll wo's wieder da ist, fliegt die map weiter mit.
  useEffect(() => {
    if (!followedTarget) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    let coords: [number, number] | null = null;
    if (followedTarget.kind === 'session') {
      const s = sessions.find((x) => x.id === followedTarget.id);
      if (s) coords = [s.position.longitude, s.position.latitude];
    } else {
      const list =
        followedTarget.network === 'VATSIM'
          ? publicPilots.vatsim
          : publicPilots.ivao;
      const p = list.find((x) => x.cid === followedTarget.cid);
      if (p) coords = [p.longitude, p.latitude];
    }

    if (!coords) return;
    map.easeTo({
      center: coords,
      duration: 1200,
      essential: true,
    });
  }, [followedTarget, sessions, publicPilots]);

  // Track 1 #2 (extended in track4 #18): Search-results across alle drei
  // pilot-quellen (member sessions, public VATSIM, public IVAO). Match-
  // priorität: callsign → departure → arrival → aircraft-type → pilot-
  // name. Erste matchende field gewinnt; matchedField wird ans result
  // angehängt damit die UI den match-reason zeigen kann ("via EDDF" wenn
  // der match per departure war, "A320" wenn per aircraft).
  //
  // Limit 8 für übersichtlichkeit (über 8 results ist die query zu
  // unspezifisch). Member sessions kommen zuerst — ein admin/streamer
  // der nach einem member-callsign sucht erwartet den als top-result.
  //
  // Performance: O(n) over ~3500 public pilots × 5 fields = ~17k str-
  // includes. Bleibt unter 5ms in Chrome dev-tools messung; kein
  // debounce nötig. Wenn das mal langsam wird, wäre ein simple-index
  // (Map<callsign, pilot> + Map<icao, pilot[]>) die nächste optimierung.
  type MatchedField =
    | 'callsign'
    | 'departure'
    | 'arrival'
    | 'aircraft'
    | 'name';

  type SearchResult =
    | { kind: 'session'; session: LiveSession; matchedField: MatchedField }
    | {
        kind: 'public';
        network: 'VATSIM' | 'IVAO';
        pilot: PublicPilot;
        matchedField: MatchedField;
      };

  const searchResults = useMemo<SearchResult[]>(() => {
    const q = searchQuery.trim().toUpperCase();
    if (q.length < 2) return [];
    const out: SearchResult[] = [];
    const MAX = 8;

    /**
     * Helper für public-pilot fields. Returnt das erste matchende field
     * oder null. Priorität callsign → dep → arr → aircraft (kein name
     * für public-pilots — die public-API liefert nur die CID).
     */
    const matchPublic = (p: PublicPilot): MatchedField | null => {
      if (p.callsign.toUpperCase().includes(q)) return 'callsign';
      if (p.departureIcao && p.departureIcao.toUpperCase().includes(q))
        return 'departure';
      if (p.arrivalIcao && p.arrivalIcao.toUpperCase().includes(q))
        return 'arrival';
      if (p.aircraftType && p.aircraftType.toUpperCase().includes(q))
        return 'aircraft';
      return null;
    };

    /**
     * Helper für member-session fields. Plus pilot-name (nicht in
     * public verfügbar) — sucht case-insensitive, nutzt aber den
     * upper-cased q für konsistente vergleiche. Matching geschieht
     * upper-case da q schon upper ist und die session-felder
     * upper-cased werden.
     */
    const matchSession = (s: LiveSession): MatchedField | null => {
      if (s.callsign.toUpperCase().includes(q)) return 'callsign';
      if (s.flightPlan.departure && s.flightPlan.departure.toUpperCase().includes(q))
        return 'departure';
      if (s.flightPlan.arrival && s.flightPlan.arrival.toUpperCase().includes(q))
        return 'arrival';
      if (s.aircraft.type && s.aircraft.type.toUpperCase().includes(q))
        return 'aircraft';
      if (s.pilot.name && s.pilot.name.toUpperCase().includes(q))
        return 'name';
      return null;
    };

    // Member sessions zuerst (höhere relevanz für VAM-eingeloggte user).
    for (const s of sessions) {
      if (out.length >= MAX) break;
      const matchedField = matchSession(s);
      if (matchedField) {
        out.push({ kind: 'session', session: s, matchedField });
      }
    }
    if (out.length >= MAX) return out;

    // Public pilots — skip welche schon als member sessions auftauchen
    // (vermeidet duplicate-results für member die parallel auf VATSIM
    // sind). Set-lookup via callsign+network composite-key.
    const memberKeys = new Set(sessions.map((s) => `${s.network}:${s.callsign}`));

    for (const p of publicPilots.vatsim) {
      if (out.length >= MAX) break;
      if (memberKeys.has(`VATSIM:${p.callsign}`)) continue;
      const matchedField = matchPublic(p);
      if (matchedField) {
        out.push({ kind: 'public', network: 'VATSIM', pilot: p, matchedField });
      }
    }
    if (out.length >= MAX) return out;

    for (const p of publicPilots.ivao) {
      if (out.length >= MAX) break;
      if (memberKeys.has(`IVAO:${p.callsign}`)) continue;
      const matchedField = matchPublic(p);
      if (matchedField) {
        out.push({ kind: 'public', network: 'IVAO', pilot: p, matchedField });
      }
    }

    return out;
  }, [searchQuery, sessions, publicPilots]);

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

  // RainViewer Radar Tile-URL (alle 10 Min refresh)
  useEffect(() => {
    let cancelled = false;

    async function fetchRadarTiles() {
      try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        if (!res.ok) return;
        const data: {
          host: string;
          radar: {
            past: Array<{ time: number; path: string }>;
          };
        } = await res.json();

        const past = data.radar?.past;
        if (!past || past.length === 0) return;
        const latest = past[past.length - 1];

        // Tile-Format: {host}{path}/256/{z}/{x}/{y}/{color}/{options}.png
        // 256 = TileSize, 2 = Color-Scheme (Universal-Blue), 1_1 = Smooth+Snow
        const url = `${data.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
        if (!cancelled) {
          setRadarTileUrl(url);
        }
      } catch (err) {
        console.error('Failed to fetch radar tiles:', err);
      }
    }

    fetchRadarTiles();
    const interval = setInterval(fetchRadarTiles, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Auto-Center auf erste Member-Session bei initialem Load
  // Läuft nur einmal pro Page-Load (siehe Ref-Guard)
  const hasAutoCenteredRef = useRef(false);

  useEffect(() => {
    if (hasAutoCenteredRef.current) return;
    if (!planeImagesLoaded) return;
    if (sessions.length === 0) return;

    const map = mapRef.current?.getMap();
    if (!map) return;

    // Erste aktive Session in der Liste
    const first = sessions[0];
    map.flyTo({
      center: [first.position.longitude, first.position.latitude],
      zoom: 6,
      duration: 1500,
      essential: true,
    });

    hasAutoCenteredRef.current = true;
  }, [sessions, planeImagesLoaded]);

  // Smart Auto-Weather Coupling
  // Wenn aktiv: ermittelt nächsten Airport und setzt Cockpit-Effekte
  // basierend auf dessen METAR-Wetter
  useEffect(() => {
    if (!filters.autoWeather || !mapCenter || airports.length === 0) {
      return;
    }

    const RADIUS_KM = 5;

    // Haversine: Distanz zwischen 2 Punkten in km
    function haversineKm(
      lat1: number,
      lng1: number,
      lat2: number,
      lng2: number,
    ): number {
      const R = 6371;
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
          Math.cos(toRad(lat2)) *
          Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }

    // Finde nächsten Airport im Radius
    let nearest: AirportWithMetar | null = null;
    let nearestDist = Infinity;

    for (const a of airports) {
      const dist = haversineKm(
        mapCenter.lat,
        mapCenter.lng,
        a.airport.latitude,
        a.airport.longitude,
      );
      if (dist <= RADIUS_KM && dist < nearestDist) {
        nearest = a;
        nearestDist = dist;
      }
    }

    // Wenn kein Airport nahe: beide Effekte aus
    if (!nearest || !nearest.metar.decoded) {
      applyFilters({ cockpitRain: false, cockpitSnow: false });
      return;
    }

    // Klassifiziere METAR weather Codes
    const weather = nearest.metar.decoded.weather;
    const SNOW_CODES = ['SN', '+SN', '-SN', 'SHSN', 'GS', 'PL', 'IC'];
    const RAIN_CODES = [
      'RA', '+RA', '-RA', 'SHRA', 'DZ',
      'TS', 'TSRA', '+TSRA', '-TSRA', 'VCTS', 'VCSH',
    ];

    const hasSnow = weather.some((w) => SNOW_CODES.includes(w));
    const hasRain = weather.some((w) => RAIN_CODES.includes(w));

    // Schnee dominiert wenn beides (visuell auffälliger)
    if (hasSnow) {
      applyFilters({ cockpitRain: false, cockpitSnow: true });
    } else if (hasRain) {
      applyFilters({ cockpitRain: true, cockpitSnow: false });
    } else {
      applyFilters({ cockpitRain: false, cockpitSnow: false });
    }
  }, [filters.autoWeather, mapCenter, airports, applyFilters]);

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

  // Track 1 #4: Heatmap-data lazy-fetch. Nur wenn heatmap-toggle enabled
  // wird UND wir noch keine daten haben — danach gecached für die session.
  // Wenn der user den toggle off-on togglet, kein refetch (cached data
  // bleibt valid bis page-reload). Trade-off: minimal-staleness vs.
  // unnötige API-calls bei toggle-spam.
  //
  // Track 4 #19: Beim wechsel des heatmapTimeframe wird heatmapData auf
  // null gesetzt (separater useEffect unten) → dieser hier feuert dann
  // erneut mit dem neuen ?timeframe-param. Cache pro session, neu pro
  // timeframe-toggle. Server filtert via ?timeframe=7d|30d|90d|all.
  useEffect(() => {
    if (!filters.heatmap) return;
    if (heatmapData !== null) return; // schon geladen für aktuellen timeframe
    if (heatmapLoading) return; // race-guard

    let cancelled = false;
    setHeatmapLoading(true);

    (async () => {
      try {
        const res = await fetch(`/api/live/heatmap?timeframe=${heatmapTimeframe}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: GeoJSON.FeatureCollection = await res.json();
        if (!cancelled) {
          setHeatmapData(data);
        }
      } catch (err) {
        console.error('Failed to fetch PIREP heatmap:', err);
      } finally {
        if (!cancelled) {
          setHeatmapLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filters.heatmap, heatmapData, heatmapLoading, heatmapTimeframe]);

  // Track 4 #19: Cache-invalidation bei timeframe-wechsel. Cleart
  // heatmapData → der fetch-useEffect oben sieht heatmapData === null
  // und triggert refetch mit neuem timeframe. Separater effect statt
  // im fetch-useEffect, weil sonst bei timeframe-wechsel ohne aktiven
  // heatmap-toggle gar nichts passieren würde — und wir wollen, dass
  // beim nächsten enable des toggles direkt der korrekte timeframe
  // gefetched wird.
  useEffect(() => {
    setHeatmapData(null);
    // Bewusst nur heatmapTimeframe in deps — wir wollen NICHT bei
    // jedem heatmap-toggle reset, sondern nur wenn der timeframe selbst
    // sich ändert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatmapTimeframe]);

  // Welle E / E5 — Position-track-heatmap fetch. Symmetric to the PIREP
  // heatmap useEffects above: lazy fetch on first enable, cache-clear
  // on timeframe change → refetch. Different endpoint
  // (/api/heatmap/positions vs /api/live/heatmap) and different default
  // timeframe (7d vs all), but the same overall shape.
  useEffect(() => {
    if (!filters.tracksHeatmap) return;
    if (tracksHeatmapData !== null) return;
    if (tracksHeatmapLoading) return;

    let cancelled = false;
    setTracksHeatmapLoading(true);

    (async () => {
      try {
        const res = await fetch(
          `/api/heatmap/positions?timeframe=${tracksHeatmapTimeframe}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: GeoJSON.FeatureCollection = await res.json();
        if (!cancelled) {
          setTracksHeatmapData(data);
        }
      } catch (err) {
        console.error('Failed to fetch tracks heatmap:', err);
      } finally {
        if (!cancelled) {
          setTracksHeatmapLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filters.tracksHeatmap, tracksHeatmapData, tracksHeatmapLoading, tracksHeatmapTimeframe]);

  // Cache-invalidation on timeframe change. Same pattern as the PIREP
  // version above — separate effect so that switching timeframe while
  // the toggle is OFF still queues the next enable to fetch the right
  // window.
  useEffect(() => {
    setTracksHeatmapData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksHeatmapTimeframe]);

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

  // Route-GeoJSON: Linien Departure→Plane und Plane→Arrival
  const routeGeoJson = useMemo(() => {
    if (!selected) {
      return { type: 'FeatureCollection' as const, features: [] };
    }

    const departureIcao = selected.flightPlan.departure;
    const arrivalIcao = selected.flightPlan.arrival;
    const planeCoords: [number, number] = [
      selected.position.longitude,
      selected.position.latitude,
    ];

    const features: GeoJSON.Feature[] = [];

    if (departureIcao) {
      const departure = airports.find((a) => a.airport.icao === departureIcao);
      if (departure) {
        features.push({
          type: 'Feature',
          properties: { segment: 'past' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [departure.airport.longitude, departure.airport.latitude],
              planeCoords,
            ],
          },
        });
      }
    }

    if (arrivalIcao) {
      const arrival = airports.find((a) => a.airport.icao === arrivalIcao);
      if (arrival) {
        features.push({
          type: 'Feature',
          properties: { segment: 'future' },
          geometry: {
            type: 'LineString',
            coordinates: [
              planeCoords,
              [arrival.airport.longitude, arrival.airport.latitude],
            ],
          },
        });
      }
    }

    return { type: 'FeatureCollection' as const, features };
  }, [selected, airports]);

  const routeLineLayer: LineLayerSpecification = useMemo(
    () => ({
      id: 'route-line',
      type: 'line',
      source: 'route-source',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match',
          ['get', 'segment'],
          'past', '#f97316',     // orange für geflogenen Teil
          'future', '#22d3ee',   // cyan für noch zu fliegen
          '#ffffff',
        ],
        'line-width': 2,
        'line-opacity': 0.5,
        'line-dasharray': [3, 2],
      },
    }),
    [],
  );

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

    // Track 4 #44 (Section H): liveStreamOnly impliziert auch member-only.
    // Public pilots auf VATSIM/IVAO haben keinen Twitch-link (kein VAM-
    // account) — wenn der user gezielt nach streamern sucht, sind das
    // alles noise. Early-return mit empty features = layer rendert nichts.
    if (filters.liveStreamOnly) {
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

  // Track 1 #2: isOpen erweitert um selectedPublic. Sidebar öffnet sich
  // wenn IRGENDEINES der drei items ausgewählt ist.
  const anySidebarOpen = selected !== null || selectedPublic !== null || selectedAirportIcao !== null;

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
          width: anySidebarOpen ? SIDEBAR_WIDTH : 0,
          flexShrink: 0,
          transition: 'width 220ms ease',
          backgroundColor: 'rgb(17, 24, 39)',
          borderRight: anySidebarOpen ? '1px solid rgb(31, 41, 55)' : 'none',
          overflow: 'hidden',
        }}
      >
        {selected && (
          <SessionSidebar
            session={selected}
            trail={trails[selected.id] ?? []}
            onClose={() => setSelectedId(null)}
            airports={airports}
            isFollowed={
              followedTarget?.kind === 'session' &&
              followedTarget.id === selected.id
            }
            onToggleFollow={() =>
              toggleFollow({ kind: 'session', id: selected.id })
            }
          />
        )}
        {/* Track 1 #2: PublicPilotSidebar zeigt reduzierten content (kein
            real-name, kein avatar, keine stats) für non-member-pilots. Mutual
            exclusion via state-setter sorgt dafür dass nicht beide gleichzeitig
            rendern (selectedPublic && !selected wäre redundant — selectMember
            cleart selectedPublic — aber defensive guard für edge-cases). */}
        {selectedPublic && !selected && selectedPublicPilot && (
          <PublicPilotSidebar
            pilot={selectedPublic}
            network={selectedPublicPilot.network}
            onClose={() => setSelectedPublicPilot(null)}
            airports={airports}
            isFollowed={
              followedTarget?.kind === 'public' &&
              followedTarget.network === selectedPublicPilot.network &&
              followedTarget.cid === selectedPublicPilot.cid
            }
            onToggleFollow={() =>
              toggleFollow({
                kind: 'public',
                network: selectedPublicPilot.network,
                cid: selectedPublicPilot.cid,
              })
            }
          />
        )}
        {selectedAirportIcao && !selected && !selectedPublic && (
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
          onMoveEnd={(e) => {
            const center = e.target.getCenter();
            setMapCenter({ lat: center.lat, lng: center.lng });
            setMapZoom(e.target.getZoom());
          }}
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

          // Eigene DEM-Source für Hillshade (höhere Auflösung als die fürs Terrain)
          if (!map.getSource('mapbox-dem-hillshade')) {
            map.addSource('mapbox-dem-hillshade', {
              type: 'raster-dem',
              url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
              tileSize: 512,
              maxzoom: 14,
            });
          }

          // Hillshade-Layer mit eigener Source — schärfer + voll aufgelöst
          if (!map.getLayer('hillshade')) {
            map.addLayer({
              id: 'hillshade',
              source: 'mapbox-dem-hillshade',
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
          // (Mapbox 3.x: setLights() statt deprecated setLight())
          map.setLights([
            {
              id: 'sun',
              type: 'flat',
              properties: {
                anchor: 'viewport',
                color: '#fef3c7',
                intensity: 0.4,
                position: [1.15, 210, 30],
              },
            },
          ]);

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
              // Track 1 #2: mutual exclusion — andere sidebars schließen
              setSelectedAirportIcao(icao);
              setSelectedId(null);
              setSelectedPublicPilot(null);
            }
          });

          // Track 1 #2: Click-Handler für public-pilots layer (sowohl
          // clustered als auch unclustered mode). Beide layer-IDs werden
          // versucht — die nicht-existierende ID failt silent (mapbox
          // verträgt das). Click → selectPublicPilot via composite-key.
          //
          // Cluster-clicks: wenn der user auf einen cluster klickt
          // (point_count > 1), zoomen wir rein statt einen einzelnen
          // pilot zu wählen — das ist mapbox's standard-cluster-UX.
          const handlePublicPilotClick = (
            e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] },
          ) => {
            const feature = e.features?.[0];
            if (!feature) return;
            const props = feature.properties ?? {};
            // Cluster-feature hat point_count, individual hat cid
            if (props.point_count) {
              // Mapbox cluster-zoom-helper. Source.getClusterExpansionZoom
              // gibt den zoom zurück bei dem der cluster sich auflöst.
              const source = map.getSource('public-pilots-source') as mapboxgl.GeoJSONSource | undefined;
              if (!source || typeof source.getClusterExpansionZoom !== 'function') return;
              const clusterId = props.cluster_id;
              source.getClusterExpansionZoom(clusterId, (err: Error | null | undefined, zoom: number | null | undefined) => {
                if (err || zoom === undefined || zoom === null) return;
                if (feature.geometry.type === 'Point') {
                  const [lng, lat] = feature.geometry.coordinates as [number, number];
                  map.easeTo({ center: [lng, lat], zoom, duration: 800 });
                }
              });
              return;
            }
            const cid = typeof props.cid === 'number' ? props.cid : Number(props.cid);
            const network = props.network as 'VATSIM' | 'IVAO';
            if (!Number.isFinite(cid) || (network !== 'VATSIM' && network !== 'IVAO')) return;
            // Mutual exclusion via state-setter — wir können hier nicht
            // selectPublicPilot() aufrufen weil onLoad-callback hat den
            // ref-snapshot der initialen function. Direkt setState's.
            setSelectedPublicPilot({ network, cid });
            setSelectedId(null);
            setSelectedAirportIcao(null);
          };

          map.on('click', 'public-pilots', handlePublicPilotClick);
          map.on('click', 'public-pilots-unclustered', handlePublicPilotClick);
          map.on('click', 'public-clusters', handlePublicPilotClick);

          // Cursor-Hover über public-pilots
          for (const layer of ['public-pilots', 'public-pilots-unclustered', 'public-clusters']) {
            map.on('mouseenter', layer, () => {
              map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', layer, () => {
              map.getCanvas().style.cursor = '';
            });
          }

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

          {/* Track 1 #4 (PIREP-Heatmap, 9.2.6): Heatmap-layer unter allen
              anderen layers (mapbox-stack-order = render-reihenfolge). So
              werden plane-icons und airports nicht überdeckt — die heatmap
              ist nur der hintergrund-layer "wo wird viel geflogen".
              Heatmap fadet ab zoom 9 langsam aus + cluster-circles erscheinen
              ab da, damit nicht beides gleichzeitig die map dominiert.
              weight-property bestimmt die heat-intensität pro punkt. */}
          {filters.heatmap && heatmapData && heatmapData.features.length > 0 && (
            <Source id="pirep-heatmap-source" type="geojson" data={heatmapData}>
              <Layer
                id="pirep-heatmap-layer"
                type="heatmap"
                source="pirep-heatmap-source"
                maxzoom={9}
                paint={{
                  // Weight pro feature aus property — flightcounts werden
                  // auf 0..1 mapped via interpolate (clamped: max-flights ≈ 50
                  // sind voll-saturated, alles drunter linear interpoliert).
                  // Wenn die airline später deutlich mehr volume hat, kann
                  // 50 hochgesetzt werden — aktuell für MVP angenehm.
                  'heatmap-weight': [
                    'interpolate',
                    ['linear'],
                    ['get', 'weight'],
                    0, 0,
                    50, 1,
                  ],
                  // Intensität multipliziert die kombinierte heatmap-density.
                  // Ramp up bei zoom-out (mehr punkte überlappen) für sichtbar-
                  // keit; ramp down bei zoom-in damit individual-airports
                  // nicht alleine die ganze map gelb machen.
                  'heatmap-intensity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0, 1,
                    9, 3,
                  ],
                  // Farb-gradient von transparent (cold) → blau → cyan → grün
                  // → gelb → orange → rot (hot). Deckt sich farblich nicht mit
                  // den weather-radar-farben (cyan/blau dort) — heatmap nutzt
                  // den klassischen heat-spektrum.
                  'heatmap-color': [
                    'interpolate',
                    ['linear'],
                    ['heatmap-density'],
                    0, 'rgba(33, 102, 172, 0)',
                    0.2, 'rgb(103, 169, 207)',
                    0.4, 'rgb(209, 229, 240)',
                    0.6, 'rgb(253, 219, 199)',
                    0.8, 'rgb(239, 138, 98)',
                    1, 'rgb(178, 24, 43)',
                  ],
                  // Radius pro punkt — klein bei zoom-out (sonst riesige blobs),
                  // größer bei zoom-in damit hubs erkennbar bleiben.
                  'heatmap-radius': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0, 4,
                    9, 30,
                  ],
                  // Fade out bei höheren zooms (smooth übergang zu cluster-
                  // sicht). Bei zoom 7-9 langsam runter, ab 9 weg.
                  'heatmap-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    7, 0.85,
                    9, 0,
                  ],
                }}
              />
              {/* Heatmap → Circle-fallback bei höheren zooms. Mapbox-standard-
                  pattern: heatmap fadet aus ab zoom 9, circle-layer fadet ein
                  ab zoom 7 — overlap-zone gibt smoothen übergang. Circle radius
                  und color skalieren mit weight-property. */}
              <Layer
                id="pirep-heatmap-points"
                type="circle"
                source="pirep-heatmap-source"
                minzoom={7}
                paint={{
                  'circle-radius': [
                    'interpolate',
                    ['linear'],
                    ['get', 'weight'],
                    1, 4,
                    50, 20,
                  ],
                  'circle-color': [
                    'interpolate',
                    ['linear'],
                    ['get', 'weight'],
                    1, 'rgba(103, 169, 207, 0.7)',
                    10, 'rgba(253, 219, 199, 0.75)',
                    25, 'rgba(239, 138, 98, 0.8)',
                    50, 'rgba(178, 24, 43, 0.85)',
                  ],
                  'circle-stroke-color': 'white',
                  'circle-stroke-width': 1,
                  'circle-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    7, 0,
                    9, 1,
                  ],
                }}
              />
            </Source>
          )}

          {/* Welle E / E5 — Position-track-heatmap-layer. Symmetric to
              the PIREP-heatmap above but visually distinct:
                - Cool indigo/violet/cyan spectrum (vs. PIREP's blue→red
                  warm spectrum) so a user with both layers on can tell
                  them apart at a glance.
                - Higher weight-scale (5000 vs. 50): each grid-cell here
                  is a count of position-rows, not flights. En-route
                  corridors can easily have 5000+ rows per 1° cell.
                - No circle-fallback at high zoom: the tracks-heatmap
                  is conceptually a global density-view, individual
                  cells aren't meaningful at zoom 9+ where pilots are
                  inspecting specific aircraft. Just fades out and
                  leaves the live-traffic layer to dominate.
              maxzoom=9 matches the PIREP heatmap so both fade out
              together when the user zooms in to inspect individual
              traffic. */}
          {filters.tracksHeatmap && tracksHeatmapData && tracksHeatmapData.features.length > 0 && (
            <Source id="tracks-heatmap-source" type="geojson" data={tracksHeatmapData}>
              <Layer
                id="tracks-heatmap-layer"
                type="heatmap"
                source="tracks-heatmap-source"
                maxzoom={9}
                paint={{
                  // Weight ramp: 0 → 0, 5000 → 1. Position-row counts
                  // can range from 1 (single overflight) to 50000+
                  // (popular corridor over months). 5000 saturates at
                  // "very busy corridor" without compressing all the
                  // mid-range cells into the same hot color. If an
                  // airline's volume outgrows this, bump the upper bound.
                  'heatmap-weight': [
                    'interpolate',
                    ['linear'],
                    ['get', 'weight'],
                    0, 0,
                    5000, 1,
                  ],
                  // Intensity ramps up at zoom-out (more cells stack)
                  // and stays flat through mid-zoom. Same shape as the
                  // PIREP layer for visual consistency.
                  'heatmap-intensity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0, 1,
                    9, 3,
                  ],
                  // Cool spectrum: transparent → deep indigo → violet
                  // → bright cyan → near-white. Distinct from the
                  // PIREP heatmap's blue-to-red. The high-density
                  // tail goes to white (not yellow/red) so the eye
                  // reads "tracks" as cooler than "endpoints" — they
                  // describe different things (flow vs. clusters).
                  'heatmap-color': [
                    'interpolate',
                    ['linear'],
                    ['heatmap-density'],
                    0, 'rgba(49, 46, 129, 0)',
                    0.2, 'rgb(67, 56, 202)',
                    0.4, 'rgb(99, 102, 241)',
                    0.6, 'rgb(129, 140, 248)',
                    0.8, 'rgb(165, 180, 252)',
                    1, 'rgb(224, 231, 255)',
                  ],
                  // Radius scales with zoom — narrow at world-view so
                  // corridors stay visible, wider at regional zoom so
                  // SID/STAR fan-outs blend smoothly. Slightly wider
                  // than the PIREP layer because position-cells are
                  // larger (1° vs. airport-level point) and need a
                  // bigger draw-radius to feel connected.
                  'heatmap-radius': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0, 6,
                    9, 40,
                  ],
                  // Fade out from zoom 7 → 9, matching PIREP heatmap.
                  // Slightly higher peak opacity (0.7 vs PIREP's 0.85)
                  // because the cool spectrum is dimmer-feeling — keeps
                  // the visual weight roughly balanced when both layers
                  // are on simultaneously.
                  'heatmap-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    7, 0.7,
                    9, 0,
                  ],
                }}
              />
            </Source>
          )}

          {/* Public Pilots Layer (alle Fremde, GPU-rendered, optional geclustert) */}
          {planeImagesLoaded && publicGeoJson.features.length > 0 && (
            <Source
              key={filters.clustering ? 'public-clustered' : 'public-flat'}
              id="public-pilots-source"
              type="geojson"
              data={publicGeoJson}
              cluster={filters.clustering}
              clusterMaxZoom={5}
              clusterRadius={50}
            >
              {filters.clustering ? [
                <Layer
                  key="public-clusters"
                  id="public-clusters"
                  type="circle"
                  source="public-pilots-source"
                  filter={['has', 'point_count']}
                  paint={{
                    'circle-color': [
                      'step',
                      ['get', 'point_count'],
                      'rgba(96, 165, 250, 0.6)',
                      50, 'rgba(251, 191, 36, 0.7)',
                      200, 'rgba(239, 68, 68, 0.75)',
                    ],
                    'circle-radius': [
                      'step',
                      ['get', 'point_count'],
                      18,
                      50, 24,
                      200, 32,
                    ],
                    'circle-stroke-width': 2,
                    'circle-stroke-color': 'rgba(255, 255, 255, 0.4)',
                  }}
                />,
                <Layer
                  key="public-cluster-count"
                  id="public-cluster-count"
                  type="symbol"
                  source="public-pilots-source"
                  filter={['has', 'point_count']}
                  layout={{
                    'text-field': ['get', 'point_count_abbreviated'],
                    'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                    'text-size': 12,
                  }}
                  paint={{
                    'text-color': '#ffffff',
                    'text-halo-color': '#000000',
                    'text-halo-width': 1,
                  }}
                />,
                <Layer
                  key="public-pilots-unclustered"
                  {...publicSymbolLayer}
                  filter={['!', ['has', 'point_count']]}
                />,
              ] : (
                /* Clustering aus: alle Plane-Icons einzeln */
                <Layer {...publicSymbolLayer} />
              )}
            </Source>
          )}

          {/* RainViewer Worldwide Radar */}
          {/* RainViewer hat Server-side max zoom 7. Mit source maxzoom=7 werden */}
          {/* z=7 tiles für höhere Levels overzoomed (gestretcht) statt 404. */}
          {/* Layer maxzoom=11 + interpolate opacity = smoother fade-out beim */}
          {/* Reinzoomen auf Stadt-Level (Wetter wird unscharf, dann unsichtbar). */}
          {filters.weatherRadar && radarTileUrl && (
            <Source
              id="rainviewer-source"
              type="raster"
              tiles={[radarTileUrl]}
              tileSize={256}
              maxzoom={7}
              attribution='© RainViewer'
            >
              <Layer
                id="rainviewer-layer"
                type="raster"
                source="rainviewer-source"
                maxzoom={14}
                paint={{
                  'raster-opacity': [
                      'interpolate', ['linear'], ['zoom'],
                    7, 0.65,    // Bei Zoom 7: voll
                    11, 0.65,   // Bei Zoom 11 (~5km Maßstab): noch voll, weil Approach
                    12, 0.45,   // Bei Zoom 12 (~2km Maßstab): merklich blasser
                    13, 0.2,    // Bei Zoom 13 (~1km): fast weg
                    14, 0,      // Bei Zoom 14: komplett weg
                   ],
                  'raster-fade-duration': 300,
                }}
              />
            </Source>
          )}

          {/* Airport Layer */}
          {planeImagesLoaded && airportGeoJson.features.length > 0 && (
            <Source id="airports-source" type="geojson" data={airportGeoJson}>
              <Layer {...airportSymbolLayer} />
            </Source>
          )}

          {/* Route Layer (Departure→Plane, Plane→Arrival) */}
          {routeGeoJson.features.length > 0 && (
            <Source id="route-source" type="geojson" data={routeGeoJson}>
              <Layer {...routeLineLayer} />
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
            // Track 4 #44 (Section H): liveStreamOnly filtert auf
            // pilot.twitchIsLive === true. Member ohne Twitch-link oder
            // member-die-grade-nicht-streamen werden ausgeblendet — wenn
            // der user gezielt nach streamern sucht, sollen wirklich nur
            // die übrig bleiben. Pattern parallel zu memberOnly (siehe
            // publicGeoJson early-return).
            if (filters.liveStreamOnly && !s.pilot.twitchIsLive) return false;
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
                // Track 1 #2: mutual exclusion. Toggle wenn schon selected,
                // sonst select + clear other sidebar-states.
                if (selectedId === session.id) {
                  setSelectedId(null);
                } else {
                  selectMemberSession(session.id);
                }
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

        {/* Track 1 #2: Search-bar als overlay top-center auf der map.
            Suche nach callsign in member sessions + public pilots (VATSIM/IVAO).
            Click auf result fliegt zur position + öffnet die entsprechende
            sidebar. Backdrop-blur + dark-glass-look passt zum status-overlay
            und filter-toolbar. */}
        <div
          style={{
            position: 'absolute',
            top: '1rem',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '320px',
            zIndex: 5,
          }}
        >
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => {
                if (searchQuery.length >= 2) setSearchOpen(true);
              }}
              onBlur={() => {
                // Delay um click-on-result zu erlauben (mousedown auf result
                // fired bevor blur completed). Ohne delay würde der dropdown
                // sich schließen bevor onClick auf dem result feuert.
                setTimeout(() => setSearchOpen(false), 150);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchQuery('');
                  setSearchOpen(false);
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === 'Enter' && searchResults.length > 0) {
                  // Enter wählt das erste result aus
                  const first = searchResults[0];
                  if (first.kind === 'session') {
                    selectMemberSession(first.session.id);
                    flyToCoords(
                      first.session.position.longitude,
                      first.session.position.latitude,
                    );
                  } else {
                    selectPublicPilot(first.network, first.pilot.cid);
                    flyToCoords(first.pilot.longitude, first.pilot.latitude);
                  }
                  // Track 4 #34: query in history aufnehmen BEVOR wir clearen.
                  pushSearchHistory(searchQuery);
                  setSearchQuery('');
                  setSearchOpen(false);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Suche: Callsign, ICAO, Aircraft, Name…"
              style={{
                width: '100%',
                padding: '0.55rem 2rem 0.55rem 2rem',
                backgroundColor: 'rgba(17, 24, 39, 0.92)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '0.375rem',
                fontSize: '0.85rem',
                fontFamily: 'inherit',
                outline: 'none',
                backdropFilter: 'blur(8px)',
              }}
              aria-label="Pilot-Suche: Callsign, ICAO, Aircraft, Name"
            />
            {/* Search-icon links */}
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: '0.6rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'rgb(156, 163, 175)',
                fontSize: '0.85rem',
                pointerEvents: 'none',
              }}
            >
              🔍
            </span>
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSearchOpen(false);
                }}
                style={{
                  position: 'absolute',
                  right: '0.5rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: 'rgb(156, 163, 175)',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  padding: '0.15rem 0.3rem',
                  lineHeight: 1,
                }}
                aria-label="Suche löschen"
              >
                ×
              </button>
            )}

            {/* Autocomplete-dropdown mit results */}
            {searchOpen && searchResults.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  right: 0,
                  backgroundColor: 'rgba(17, 24, 39, 0.96)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '0.375rem',
                  backdropFilter: 'blur(8px)',
                  maxHeight: '320px',
                  overflowY: 'auto',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                }}
              >
                {searchResults.map((r, idx) => {
                  const isSession = r.kind === 'session';
                  const callsign = isSession ? r.session.callsign : r.pilot.callsign;
                  const network = isSession ? r.session.network : r.network;
                  const aircraft = isSession
                    ? r.session.aircraft.type
                    : r.pilot.aircraftType;
                  const dep = isSession
                    ? r.session.flightPlan.departure
                    : r.pilot.departureIcao;
                  const arr = isSession
                    ? r.session.flightPlan.arrival
                    : r.pilot.arrivalIcao;
                  return (
                    <button
                      key={`${r.kind}-${callsign}-${idx}`}
                      onMouseDown={(e) => {
                        // mousedown statt onClick damit der handler vor dem
                        // input-blur feuert (sonst race mit dem setTimeout-blur).
                        e.preventDefault();
                        if (isSession) {
                          selectMemberSession(r.session.id);
                          flyToCoords(
                            r.session.position.longitude,
                            r.session.position.latitude,
                          );
                        } else {
                          selectPublicPilot(r.network, r.pilot.cid);
                          flyToCoords(r.pilot.longitude, r.pilot.latitude);
                        }
                        // Track 4 #34: query in history aufnehmen BEVOR wir clearen.
                        pushSearchHistory(searchQuery);
                        setSearchQuery('');
                        setSearchOpen(false);
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '0.55rem 0.75rem',
                        backgroundColor: 'transparent',
                        border: 'none',
                        borderBottom:
                          idx < searchResults.length - 1
                            ? '1px solid rgba(255, 255, 255, 0.05)'
                            : 'none',
                        color: 'white',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor =
                          'rgba(255, 255, 255, 0.05)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontWeight: 600,
                            color: isSession ? '#fbbf24' : 'white',
                          }}
                        >
                          {callsign}
                        </span>
                        <span
                          style={{
                            fontSize: '0.6rem',
                            padding: '0.05rem 0.35rem',
                            borderRadius: '0.2rem',
                            backgroundColor:
                              network === 'VATSIM'
                                ? 'rgba(59, 130, 246, 0.2)'
                                : network === 'IVAO'
                                  ? 'rgba(16, 185, 129, 0.2)'
                                  : 'rgba(107, 114, 128, 0.2)',
                            color:
                              network === 'VATSIM'
                                ? '#93c5fd'
                                : network === 'IVAO'
                                  ? '#6ee7b7'
                                  : '#d1d5db',
                            border: `1px solid ${
                              network === 'VATSIM'
                                ? 'rgba(59, 130, 246, 0.4)'
                                : network === 'IVAO'
                                  ? 'rgba(16, 185, 129, 0.4)'
                                  : 'rgba(107, 114, 128, 0.4)'
                            }`,
                          }}
                        >
                          {network}
                        </span>
                        {isSession && (
                          <span
                            style={{
                              fontSize: '0.6rem',
                              padding: '0.05rem 0.35rem',
                              borderRadius: '0.2rem',
                              backgroundColor: 'rgba(249, 115, 22, 0.2)',
                              color: '#fdba74',
                              border: '1px solid rgba(249, 115, 22, 0.4)',
                            }}
                          >
                            MEMBER
                          </span>
                        )}
                        {/*
                          Track 4 #18: Match-hint badge. Wenn der match
                          NICHT auf den callsign war, zeigen wir kurz
                          warum dieses result aufgetaucht ist — sonst
                          irritiert ein search-result wo der gesuchte
                          string nicht im callsign zu sehen ist.
                          "via DEP" = match auf flightplan.departure-ICAO,
                          "via ARR" = arrival, "via TYPE" = aircraft,
                          "via NAME" = pilot.name (sessions only).
                        */}
                        {r.matchedField !== 'callsign' && (
                          <span
                            style={{
                              fontSize: '0.6rem',
                              padding: '0.05rem 0.35rem',
                              borderRadius: '0.2rem',
                              backgroundColor: 'rgba(168, 85, 247, 0.2)',
                              color: '#d8b4fe',
                              border: '1px solid rgba(168, 85, 247, 0.4)',
                            }}
                          >
                            via{' '}
                            {r.matchedField === 'departure'
                              ? 'DEP'
                              : r.matchedField === 'arrival'
                                ? 'ARR'
                                : r.matchedField === 'aircraft'
                                  ? 'TYPE'
                                  : 'NAME'}
                          </span>
                        )}
                      </div>
                      {(aircraft || dep || arr) && (
                        <div
                          style={{
                            marginTop: '0.2rem',
                            fontSize: '0.7rem',
                            color: 'rgb(156, 163, 175)',
                            fontFamily: 'monospace',
                          }}
                        >
                          {aircraft && <span>{aircraft}</span>}
                          {(dep || arr) && (
                            <span style={{ marginLeft: aircraft ? '0.5rem' : 0 }}>
                              {dep ?? '???'} → {arr ?? '???'}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {/* Track 4 #34: Search-history-chips. Sichtbar wenn:
                - die search-bar offen ist (focus oder dropdown getriggert)
                - die query (zu kurz) für einen aktiven search ist (<2 Zeichen)
                - history nicht leer (sonst nichts zu zeigen)
                Klick auf chip füllt query → dropdown rendert sofort die
                results für den vorherigen suchbegriff. "Verlauf löschen"
                rechts zum komplett-clearen. mousedown statt click damit
                der input-blur-timeout den dropdown nicht vorher schließt. */}
            {searchOpen &&
              searchQuery.trim().length < 2 &&
              searchHistory.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    left: 0,
                    right: 0,
                    padding: '0.6rem 0.75rem',
                    backgroundColor: 'rgba(17, 24, 39, 0.96)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '0.375rem',
                    backdropFilter: 'blur(8px)',
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '0.4rem',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.6rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'rgb(107, 114, 128)',
                      }}
                    >
                      🕒 Letzte Suchen
                    </span>
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        clearSearchHistory();
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'rgb(156, 163, 175)',
                        cursor: 'pointer',
                        fontSize: '0.65rem',
                        padding: '0.1rem 0.3rem',
                        borderRadius: '0.2rem',
                        transition: 'color 120ms',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#fca5a5';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'rgb(156, 163, 175)';
                      }}
                      aria-label="Suchverlauf löschen"
                    >
                      Verlauf löschen
                    </button>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.3rem',
                    }}
                  >
                    {searchHistory.map((entry) => (
                      <button
                        key={entry}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSearchQuery(entry);
                          setSearchOpen(true);
                        }}
                        style={{
                          padding: '0.2rem 0.5rem',
                          fontSize: '0.7rem',
                          fontFamily: 'monospace',
                          fontWeight: 600,
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          color: 'rgb(229, 231, 235)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '0.25rem',
                          cursor: 'pointer',
                          transition: 'background-color 120ms, border-color 120ms',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor =
                            'rgba(99, 102, 241, 0.15)';
                          e.currentTarget.style.borderColor =
                            'rgba(99, 102, 241, 0.4)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor =
                            'rgba(255, 255, 255, 0.05)';
                          e.currentTarget.style.borderColor =
                            'rgba(255, 255, 255, 0.1)';
                        }}
                        aria-label={`Suche nach ${entry} wiederholen`}
                      >
                        {entry}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            {/* "no results" feedback wenn query lang genug aber 0 hits */}
            {searchOpen &&
              searchQuery.trim().length >= 2 &&
              searchResults.length === 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    left: 0,
                    right: 0,
                    padding: '0.6rem 0.75rem',
                    backgroundColor: 'rgba(17, 24, 39, 0.96)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '0.375rem',
                    backdropFilter: 'blur(8px)',
                    fontSize: '0.75rem',
                    color: 'rgb(156, 163, 175)',
                  }}
                >
                  Keine Pilots, Routen oder Flugzeugtypen mit "{searchQuery}" gefunden.
                </div>
              )}
          </div>
        </div>

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
              color: activeFilterCount > 0 ? '#fbbf24' : 'rgb(107, 114, 128)',
              padding: '0 0.25rem',
              transition: 'color 200ms',
            }}
          >
            {activeFilterCount > 0 ? `Filter (${activeFilterCount} aktiv)` : 'Filter'}
          </div>

          <FilterToggle
            label="Member only"
            checked={filters.memberOnly}
            onChange={(v) => setFilter('memberOnly', v)}
            color="#f97316"
          />
          {/* Track 4 #44 (Section H): Live-Streamer-only toggle. Roter
              ton passt zum Twitch-LIVE-badge der inline auf den session-
              cards rendert (#dc2626). Filtert sowohl member-marker als
              auch public-pilots (siehe filter im sessions.filter() und
              publicGeoJson early-return). Quasi ein "Twitch-discovery"-
              modus — zeigt nur pilots die grade live sind, ideal für
              den moment in dem man kurz checken will "wer streamt grade
              einen flug, da kann ich rein-schauen". */}
          <FilterToggle
            label="🔴 Live-Streamer"
            checked={filters.liveStreamOnly}
            onChange={(v) => setFilter('liveStreamOnly', v)}
            color="#dc2626"
          />
          <FilterToggle
            label="VATSIM"
            checked={filters.showVatsim}
            onChange={(v) => setFilter('showVatsim', v)}
            color="#60a5fa"
          />
          <FilterToggle
            label="IVAO"
            checked={filters.showIvao}
            onChange={(v) => setFilter('showIvao', v)}
            color="#34d399"
          />
          <FilterToggle
            label="Airports"
            checked={filters.showAirports}
            onChange={(v) => setFilter('showAirports', v)}
            color="#fbbf24"
          />
          <FilterToggle
            label="Cockpit Rain"
            checked={filters.cockpitRain}
            onChange={(v) => setFilter('cockpitRain', v)}
            color="#60a5fa"
          />
          <FilterToggle
            label="Cockpit Snow"
            checked={filters.cockpitSnow}
            onChange={(v) => setFilter('cockpitSnow', v)}
            color="#e0e7ff"
          />
          <FilterToggle
            label="Wetter Radar"
            checked={filters.weatherRadar}
            onChange={(v) => setFilter('weatherRadar', v)}
            color="#22d3ee"
          />
          <FilterToggle
            label="Auto Wetter (5km)"
            checked={filters.autoWeather}
            onChange={(v) => setFilter('autoWeather', v)}
            color="#a78bfa"
          />
          <FilterToggle
            label="Clustering"
            checked={filters.clustering}
            onChange={(v) => setFilter('clustering', v)}
            color="#84cc16"
          />
          {/* Track 1 #4 (PIREP-Heatmap, 9.2.6): toggle für historische
              flight-aktivität. Loading-state als hint wenn der erste fetch
              läuft (sub-sekunde meistens, aber bei großen airlines >100MB
              sub-paths kann das spürbar werden). */}
          <FilterToggle
            label={heatmapLoading ? 'Heatmap (lädt...)' : 'PIREP-Heatmap'}
            checked={filters.heatmap}
            onChange={(v) => setFilter('heatmap', v)}
            color="#ef4444"
          />
          {/* Track 4 #19: Timeframe-selector. Nur sichtbar wenn der
              heatmap-toggle aktiv ist — sonst wäre es UI-noise (man würde
              einen filter sehen für eine layer die garnicht angezeigt
              wird). 4 segmented buttons (7T/30T/90T/Alle). Bei click
              wird heatmapTimeframe gewechselt → useEffect cleart
              heatmapData → refetch mit neuem ?timeframe-param.
              Tagesbasierte windows (sub-tag wäre zu noisy für eine
              "wo wird geflogen"-langzeit-sicht). */}
          {filters.heatmap && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '0.2rem',
                padding: '0 0.5rem 0.25rem',
              }}
            >
              {(['7d', '30d', '90d', 'all'] as const).map((tf) => {
                const label =
                  tf === '7d'
                    ? '7T'
                    : tf === '30d'
                      ? '30T'
                      : tf === '90d'
                        ? '90T'
                        : 'Alle';
                const active = heatmapTimeframe === tf;
                return (
                  <button
                    key={tf}
                    onClick={() => setHeatmapTimeframe(tf)}
                    style={{
                      padding: '0.25rem 0.1rem',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      border: `1px solid ${
                        active
                          ? 'rgba(239, 68, 68, 0.6)'
                          : 'rgba(255, 255, 255, 0.1)'
                      }`,
                      borderRadius: '0.2rem',
                      backgroundColor: active
                        ? 'rgba(239, 68, 68, 0.2)'
                        : 'transparent',
                      color: active ? '#fca5a5' : 'rgb(156, 163, 175)',
                      cursor: 'pointer',
                      transition: 'background-color 120ms, border-color 120ms',
                    }}
                    aria-pressed={active}
                    aria-label={`Heatmap-Zeitraum: ${label}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          {/* Welle E / E5 — Tracks-Heatmap toggle. Mirror of the PIREP-
              Heatmap toggle above but for full flight-track density
              (en-route corridors, SID/STAR fan-outs). Distinct indigo
              accent-color (#6366f1) to telegraph that the two heatmaps
              are different layers — same swatch as the layer-color in
              the Mapbox paint above. */}
          <FilterToggle
            label={tracksHeatmapLoading ? 'Tracks (lädt...)' : 'Tracks-Heatmap'}
            checked={filters.tracksHeatmap}
            onChange={(v) => setFilter('tracksHeatmap', v)}
            color="#6366f1"
          />
          {/* Welle E / E5 — Timeframe-selector for the tracks-heatmap.
              Same UX shape as the PIREP-heatmap timeframe-segment
              (4-segment grid, click → re-fetch with new ?timeframe).
              Different default + options: 24h instead of 90d as the
              short window (24h tracks shows "what's flying today"
              which is actually useful; 90d position-rows are a lot of
              data without proportional insight), and the indigo accent
              matches the heatmap-layer color so the segment visually
              belongs to its toggle. */}
          {filters.tracksHeatmap && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '0.2rem',
                padding: '0 0.5rem 0.25rem',
              }}
            >
              {(['24h', '7d', '30d', 'all'] as const).map((tf) => {
                const label =
                  tf === '24h'
                    ? '24h'
                    : tf === '7d'
                      ? '7T'
                      : tf === '30d'
                        ? '30T'
                        : 'Alle';
                const active = tracksHeatmapTimeframe === tf;
                return (
                  <button
                    key={tf}
                    onClick={() => setTracksHeatmapTimeframe(tf)}
                    style={{
                      padding: '0.25rem 0.1rem',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      border: `1px solid ${
                        active
                          ? 'rgba(99, 102, 241, 0.6)'
                          : 'rgba(255, 255, 255, 0.1)'
                      }`,
                      borderRadius: '0.2rem',
                      backgroundColor: active
                        ? 'rgba(99, 102, 241, 0.2)'
                        : 'transparent',
                      color: active ? '#a5b4fc' : 'rgb(156, 163, 175)',
                      cursor: 'pointer',
                      transition: 'background-color 120ms, border-color 120ms',
                    }}
                    aria-pressed={active}
                    aria-label={`Tracks-Heatmap-Zeitraum: ${label}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          {/* Track 4 #33 (Section F): Reset-Button. Conditional render —
              nur sichtbar wenn mindestens ein filter abweicht vom default.
              Klick ruft resetFilters() im store auf, der DEFAULT_FILTERS
              applied und persist-middleware den localStorage-state cleart.
              Roter tint markiert destructive action; eigener border-top
              trennt visuell vom filter-block über dem button. */}
          {activeFilterCount > 0 && (
            <div
              style={{
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                marginTop: '0.25rem',
                paddingTop: '0.5rem',
              }}
            >
              <button
                onClick={() => resetFilters()}
                style={{
                  width: '100%',
                  padding: '0.4rem 0.5rem',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  color: '#fca5a5',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '0.25rem',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  transition: 'background-color 120ms',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                }}
                aria-label={`Filter zurücksetzen (${activeFilterCount} aktiv)`}
                title="Alle Filter auf Standardwerte zurücksetzen"
              >
                ↺ Filter zurücksetzen
              </button>
            </div>
          )}
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
  network: 'VATSIM' | 'IVAO' | 'Offline';
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
  airports,
  isFollowed,
  onToggleFollow,
}: {
  session: LiveSession;
  trail: TrailPoint[];
  onClose: () => void;
  airports: AirportWithMetar[];
  isFollowed: boolean;
  onToggleFollow: () => void;
}) {
  const minutesOnline = Math.floor(
    (Date.now() - new Date(session.connectedAt).getTime()) / 60000,
  );
  const { distanceKm, etaMinutes } = computeProgress(session, airports);

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
            <NetworkBadge network={session.network} />
            <DataSourceBadge dataSource={session.dataSource} />
          </div>
          {/* Welle 14C: name-zeile mit optional twitch-live-badge. Wenn der
              fliegende pilot AUCH grade auf twitch streamt, zeigen wir hier
              einen kleinen "🔴 LIVE"-badge der zu twitch.tv/{username} verlinkt.
              Doppelte sichtbarkeit (fliegt UND streamt) ist genau der case
              den Welle 14C besonders heben will — ein streamer-pilot mit live-
              audience verdient den extra-hint. Inline-style statt tailwind weil
              die ganze live-map.tsx auf inline-styles läuft (mapbox-overlay-
              context). */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
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
            {session.pilot.twitchIsLive && session.pilot.twitchUsername && (
              <a
                href={`https://twitch.tv/${session.pilot.twitchUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  padding: '0.1rem 0.4rem',
                  borderRadius: '0.25rem',
                  backgroundColor: '#dc2626',
                  color: 'white',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  textDecoration: 'none',
                  letterSpacing: '0.03em',
                }}
                title={`${session.pilot.name ?? 'Pilot'} streamt grade live auf Twitch`}
                aria-label={`${session.pilot.name ?? 'Pilot'} streamt live auf Twitch`}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: '0.4rem',
                    height: '0.4rem',
                    borderRadius: '50%',
                    backgroundColor: 'white',
                    animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                  }}
                  aria-hidden="true"
                />
                LIVE
              </a>
            )}
          </div>
        </div>
        {/* Track 4 #31: Follow-Mode-toggle — links neben dem close-button.
            Wenn aktiv: indigo-tint zeigt visuell dass die map dem pilot
            grade folgt. Klick togglet (siehe toggleFollow oben). 📍-icon
            wenn aktiv (visuelles \"target locked\"-cue), 🎯 wenn off (zeigt
            \"hier könntest du target locken\"). Wir tooltip'en's für den
            user der keine ahnung hat was 🎯 hier soll. */}
        <button
          onClick={onToggleFollow}
          style={{
            width: '2rem',
            height: '2rem',
            borderRadius: '0.375rem',
            backgroundColor: isFollowed
              ? 'rgba(99, 102, 241, 0.3)'
              : 'rgb(31, 41, 55)',
            border: isFollowed
              ? '1px solid rgba(99, 102, 241, 0.6)'
              : '1px solid transparent',
            color: 'white',
            cursor: 'pointer',
            fontSize: '0.95rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            padding: 0,
            lineHeight: 1,
          }}
          aria-label={isFollowed ? 'Folgen beenden' : 'Diesem Pilot folgen'}
          aria-pressed={isFollowed}
          title={
            isFollowed
              ? 'Map folgt diesem Pilot — klick zum stoppen'
              : 'Map automatisch mit Pilot mitfliegen'
          }
        >
          {isFollowed ? '📍' : '🎯'}
        </button>
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

              {distanceKm !== null && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    paddingTop: '0.75rem',
                    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                    display: 'flex',
                    gap: '1.5rem',
                    fontSize: '0.875rem',
                    fontFamily: 'monospace',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'rgb(107, 114, 128)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Distance
                    </div>
                    <div style={{ color: 'white', fontWeight: 600, marginTop: '0.15rem' }}>
                      {distanceKm.toFixed(0)} km
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'rgb(107, 114, 128)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      ETA
                    </div>
                    <div style={{ color: '#34d399', fontWeight: 600, marginTop: '0.15rem' }}>
                      {etaMinutes !== null
                        ? etaMinutes < 60
                          ? `${Math.round(etaMinutes)} min`
                          : `${Math.floor(etaMinutes / 60)}h ${Math.round(etaMinutes % 60)}min`
                        : '—'}
                    </div>
                  </div>
                </div>
              )}
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

/**
 * Welle 9 commit 9E: 3-way network badge.
 *
 * VATSIM = blue, IVAO = emerald, Offline = neutral grey. Offline appears
 * for ACARS-only pilots flying solo (no network connection) — without
 * an explicit grey case the previous 2-way ternary would have rendered
 * Offline-pilots in IVAO-green, which is misleading.
 */
function NetworkBadge({
  network,
}: {
  network: 'VATSIM' | 'IVAO' | 'Offline';
}) {
  const styles: Record<typeof network, { bg: string; text: string; border: string }> = {
    VATSIM: {
      bg: 'rgba(59, 130, 246, 0.2)',
      text: '#93c5fd',
      border: '1px solid rgba(59, 130, 246, 0.4)',
    },
    IVAO: {
      bg: 'rgba(16, 185, 129, 0.2)',
      text: '#6ee7b7',
      border: '1px solid rgba(16, 185, 129, 0.4)',
    },
    Offline: {
      bg: 'rgba(107, 114, 128, 0.2)',
      text: '#d1d5db',
      border: '1px solid rgba(107, 114, 128, 0.4)',
    },
  };
  const s = styles[network];
  return (
    <span
      style={{
        fontSize: '0.7rem',
        padding: '0.15rem 0.5rem',
        borderRadius: '0.25rem',
        backgroundColor: s.bg,
        color: s.text,
        border: s.border,
      }}
    >
      {network}
    </span>
  );
}

/**
 * Welle 9 commit 9E: data-source quality-tier badge.
 *
 * 🟢 ACARS — premium tier, 1-2s simconnect telemetry from the desktop-
 *            client. Highest fidelity, full instrument data.
 * 🟡 30s   — VATSIM_API or IVAO_API polled feed. Standard fidelity,
 *            position-only, ~30s update cadence.
 * ⚪ Manual / Replay — admin/test sessions, not from a live source.
 *
 * The badge is intentionally minimal — most users don't care about the
 * underlying source, but streamers and observers benefit from knowing
 * the track quality at a glance. Shows the tier label as text (not just
 * the dot) so it's accessible without color-discrimination.
 */
function DataSourceBadge({
  dataSource,
}: {
  dataSource: 'VATSIM_API' | 'IVAO_API' | 'ACARS_CLIENT' | 'MANUAL' | 'REPLAY';
}) {
  let tier: { dot: string; label: string; color: string; bg: string; border: string };
  if (dataSource === 'ACARS_CLIENT') {
    tier = {
      dot: '#22c55e',
      label: 'ACARS',
      color: '#86efac',
      bg: 'rgba(34, 197, 94, 0.15)',
      border: '1px solid rgba(34, 197, 94, 0.35)',
    };
  } else if (dataSource === 'VATSIM_API' || dataSource === 'IVAO_API') {
    tier = {
      dot: '#fbbf24',
      label: '30s feed',
      color: '#fcd34d',
      bg: 'rgba(251, 191, 36, 0.15)',
      border: '1px solid rgba(251, 191, 36, 0.35)',
    };
  } else {
    tier = {
      dot: '#9ca3af',
      label: dataSource === 'REPLAY' ? 'Replay' : 'Manual',
      color: '#d1d5db',
      bg: 'rgba(156, 163, 175, 0.15)',
      border: '1px solid rgba(156, 163, 175, 0.35)',
    };
  }
  return (
    <span
      title={`Data source: ${dataSource}`}
      style={{
        fontSize: '0.65rem',
        padding: '0.15rem 0.45rem',
        borderRadius: '0.25rem',
        backgroundColor: tier.bg,
        color: tier.color,
        border: tier.border,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
      }}
    >
      <span
        style={{
          width: '0.4rem',
          height: '0.4rem',
          borderRadius: '50%',
          backgroundColor: tier.dot,
          flexShrink: 0,
        }}
      />
      {tier.label}
    </span>
  );
}
/**
 * Track 1 #2 (Live-Map Search-Bar + Click-Public-Pilots, 9.2.5):
 * Sidebar für non-member public pilots auf VATSIM/IVAO.
 *
 * # Reduzierter content vs. SessionSidebar
 *
 * Public pilots haben keine VAM-account-verknüpfung — wir kennen
 * nur die VATSIM/IVAO-public-data:
 *   - callsign
 *   - aircraft type
 *   - departureIcao / arrivalIcao (aus dem flight-plan, optional)
 *   - position (lat/lng/altitude/groundSpeed/heading/onGround)
 *
 * Was wir NICHT haben (im vergleich zu SessionSidebar):
 *   - real-name / avatar / rank / pilot-id (kein VAM-account)
 *   - dataSource (immer "VATSIM_API" oder "IVAO_API" — public feed)
 *   - twitch-live-status (nur für members getracked)
 *   - trail (PublicPilot ist ein point-in-time snapshot)
 *   - distance/ETA (würde airports im scope der component brauchen,
 *     plus die meisten public pilots haben keine VAT-known airports
 *     in unserer airports-list — der berechnete ETA wäre meist null)
 *
 * # Privacy / Anonymität
 *
 * VATSIM/IVAO public-data enthält cid (numeric user-id) der pilots —
 * wir zeigen das NICHT an. Anonyme darstellung ist intentional:
 * cids könnten zur user-tracking ausserhalb unserer plattform
 * missbraucht werden. Callsign reicht für identifikation auf der map.
 */
function PublicPilotSidebar({
  pilot,
  network,
  onClose,
  airports,
  isFollowed,
  onToggleFollow,
}: {
  pilot: PublicPilot;
  network: 'VATSIM' | 'IVAO';
  onClose: () => void;
  airports: AirportWithMetar[];
  isFollowed: boolean;
  onToggleFollow: () => void;
}) {
  // Track 4 #32: Distance/ETA für public pilots — analog zu computeProgress
  // für member sessions, aber via dedizierten computePublicProgress-helper.
  // Greift nur wenn arrivalIcao gesetzt ist UND wir den airport in unserer
  // METAR-liste finden (das sind ~150 große airports — bei mehrheit der
  // public-pilots ist der arrival NICHT drin, dann zeigen wir die
  // distance/ETA-section gar nicht).
  const { distanceKm, etaMinutes } = computePublicProgress(pilot, airports);

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
              flexWrap: 'wrap',
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
              {pilot.callsign}
            </h2>
            <NetworkBadge network={network} />
          </div>
          <p
            style={{
              fontSize: '0.75rem',
              color: 'rgb(156, 163, 175)',
              margin: 0,
              fontStyle: 'italic',
            }}
          >
            Non-Member · Live auf {network}
          </p>
        </div>
        {/* Track 4 #31: Follow-button (analog SessionSidebar) — siehe dort
            für rationale. Auch public-pilots können gefolgt werden. */}
        <button
          onClick={onToggleFollow}
          style={{
            width: '2rem',
            height: '2rem',
            borderRadius: '0.375rem',
            backgroundColor: isFollowed
              ? 'rgba(99, 102, 241, 0.3)'
              : 'rgb(31, 41, 55)',
            border: isFollowed
              ? '1px solid rgba(99, 102, 241, 0.6)'
              : '1px solid transparent',
            color: 'white',
            cursor: 'pointer',
            fontSize: '0.95rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            padding: 0,
            lineHeight: 1,
          }}
          aria-label={isFollowed ? 'Folgen beenden' : 'Diesem Pilot folgen'}
          aria-pressed={isFollowed}
          title={
            isFollowed
              ? 'Map folgt diesem Pilot — klick zum stoppen'
              : 'Map automatisch mit Pilot mitfliegen'
          }
        >
          {isFollowed ? '📍' : '🎯'}
        </button>
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
        {/* Flight Plan (departure/arrival) wenn bekannt */}
        {(pilot.departureIcao || pilot.arrivalIcao || pilot.aircraftType) && (
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
              {(pilot.departureIcao || pilot.arrivalIcao) && (
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
                  <span>{pilot.departureIcao ?? '???'}</span>
                  <span style={{ color: 'rgb(107, 114, 128)' }}>→</span>
                  <span>{pilot.arrivalIcao ?? '???'}</span>
                </div>
              )}
              {pilot.aircraftType && (
                <div
                  style={{
                    marginTop:
                      pilot.departureIcao || pilot.arrivalIcao ? '0.5rem' : 0,
                    fontSize: '0.75rem',
                    color: 'rgb(156, 163, 175)',
                  }}
                >
                  {pilot.aircraftType}
                </div>
              )}

              {/* Track 4 #32: Distance/ETA — wie im SessionSidebar. Nur
                  wenn computePublicProgress was zurückgibt (arrivalIcao
                  gesetzt UND airport in METAR-liste). distanceKm null →
                  ganze section weg. ETA null → "—" (taxi/ground, oder
                  groundspeed unter 30kt). */}
              {distanceKm !== null && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    paddingTop: '0.75rem',
                    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                    display: 'flex',
                    gap: '1.5rem',
                    fontSize: '0.875rem',
                    fontFamily: 'monospace',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'rgb(107, 114, 128)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Distance
                    </div>
                    <div style={{ color: 'white', fontWeight: 600, marginTop: '0.15rem' }}>
                      {distanceKm.toFixed(0)} km
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'rgb(107, 114, 128)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      ETA
                    </div>
                    <div style={{ color: '#34d399', fontWeight: 600, marginTop: '0.15rem' }}>
                      {etaMinutes !== null
                        ? etaMinutes < 60
                          ? `${Math.round(etaMinutes)} min`
                          : `${Math.floor(etaMinutes / 60)}h ${Math.round(etaMinutes % 60)}min`
                        : '—'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Live position stats (kein transponder/online-time, das ist nicht in PublicPilot) */}
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
              value={`${pilot.altitude.toLocaleString()} ft`}
            />
            <Stat label="Ground Speed" value={`${pilot.groundSpeed} kt`} />
            <Stat label="Heading" value={`${pilot.heading}°`} />
            <Stat
              label="Status"
              value={pilot.onGround ? 'On Ground' : 'Airborne'}
              valueColor={pilot.onGround ? '#fbbf24' : '#34d399'}
            />
          </div>
        </section>

        {/* Coordinates */}
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
            {pilot.latitude.toFixed(4)}°, {pilot.longitude.toFixed(4)}°
          </div>
        </section>
      </div>
    </div>
  );
}
