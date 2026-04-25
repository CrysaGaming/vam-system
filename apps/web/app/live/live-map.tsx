'use client';

import { useEffect, useState, useMemo } from 'react';
import Map, { Marker, Popup, NavigationControl, ScaleControl } from 'react-map-gl/mapbox';
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

export function LiveMap({ mapboxToken }: { mapboxToken: string }) {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [selected, setSelected] = useState<LiveSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

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

  const initialView = useMemo(
    () => ({
      longitude: 10,
      latitude: 50,
      zoom: 4,
    }),
    [],
  );

  return (
    <div style={{ height: 'calc(100vh - 73px)', width: '100%', position: 'relative' }}>
      <Map
        mapboxAccessToken={mapboxToken}
        initialViewState={initialView}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
      >
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-right" />

        {sessions.map((session) => (
          <Marker
            key={session.id}
            longitude={session.position.longitude}
            latitude={session.position.latitude}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              setSelected(session);
            }}
          >
            <div
              style={{
                cursor: 'pointer',
                transform: `rotate(${session.position.heading}deg)`,
                transformOrigin: 'center',
                transition: 'transform 0.5s linear',
              }}
            >
              <PlaneIcon network={session.network} onGround={session.position.onGround} />
            </div>
          </Marker>
        ))}

        {selected && (
          <Popup
            longitude={selected.position.longitude}
            latitude={selected.position.latitude}
            anchor="bottom"
            onClose={() => setSelected(null)}
            closeButton={true}
            closeOnClick={false}
            offset={20}
          >
            <SessionDetail session={selected} />
          </Popup>
        )}
      </Map>

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
            {sessions.length} live ·{' '}
            {sessions.filter((s) => s.network === 'VATSIM').length} VATSIM ·{' '}
            {sessions.filter((s) => s.network === 'IVAO').length} IVAO
            {lastFetch && (
              <span style={{ marginLeft: '0.5rem', color: 'rgb(156, 163, 175)' }}>
                · {lastFetch.toLocaleTimeString('de-DE')}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function PlaneIcon({
  network,
  onGround,
}: {
  network: 'VATSIM' | 'IVAO';
  onGround: boolean;
}) {
  const color = network === 'VATSIM' ? '#3b82f6' : '#10b981';
  const opacity = onGround ? 0.5 : 1;

  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill={color}
      opacity={opacity}
      style={{
        filter: 'drop-shadow(0 0 4px rgba(0,0,0,0.6))',
      }}
    >
      <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" />
    </svg>
  );
}

function SessionDetail({ session }: { session: LiveSession }) {
  return (
    <div
      style={{
        padding: '0.5rem',
        minWidth: '240px',
        color: 'rgb(17, 24, 39)',
        fontSize: '0.875rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: '1rem' }}>{session.callsign}</strong>
        <span
          style={{
            fontSize: '0.7rem',
            padding: '0.1rem 0.4rem',
            borderRadius: '0.25rem',
            backgroundColor: session.network === 'VATSIM' ? '#dbeafe' : '#d1fae5',
            color: session.network === 'VATSIM' ? '#1e40af' : '#065f46',
          }}
        >
          {session.network}
        </span>
      </div>

      <div style={{ marginTop: '0.5rem', color: 'rgb(75, 85, 99)' }}>
        {session.pilot.name} {session.pilot.rank && `· ${session.pilot.rank}`}
      </div>

      {(session.flightPlan.departure || session.flightPlan.arrival) && (
        <div
          style={{
            marginTop: '0.5rem',
            padding: '0.5rem',
            backgroundColor: 'rgb(243, 244, 246)',
            borderRadius: '0.25rem',
          }}
        >
          <div style={{ fontWeight: 600 }}>
            {session.flightPlan.departure ?? '???'} → {session.flightPlan.arrival ?? '???'}
          </div>
          {session.aircraft.type && (
            <div style={{ fontSize: '0.75rem', color: 'rgb(75, 85, 99)', marginTop: '0.25rem' }}>
              {session.aircraft.type}
              {session.flightPlan.cruiseAltitude &&
                ` · FL${(session.flightPlan.cruiseAltitude / 100).toFixed(0)}`}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          marginTop: '0.5rem',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.5rem',
          fontSize: '0.75rem',
        }}
      >
        <div>
          <div style={{ color: 'rgb(107, 114, 128)' }}>Altitude</div>
          <div style={{ fontWeight: 600 }}>{session.position.altitude.toLocaleString()} ft</div>
        </div>
        <div>
          <div style={{ color: 'rgb(107, 114, 128)' }}>Speed</div>
          <div style={{ fontWeight: 600 }}>{session.position.groundSpeed} kt</div>
        </div>
        <div>
          <div style={{ color: 'rgb(107, 114, 128)' }}>Heading</div>
          <div style={{ fontWeight: 600 }}>{session.position.heading}°</div>
        </div>
        <div>
          <div style={{ color: 'rgb(107, 114, 128)' }}>Status</div>
          <div style={{ fontWeight: 600 }}>
            {session.position.onGround ? 'On Ground' : 'Airborne'}
          </div>
        </div>
      </div>
    </div>
  );
}