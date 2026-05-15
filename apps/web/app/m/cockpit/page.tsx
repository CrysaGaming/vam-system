import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import type { MobileState } from '../mobile-client';
import CockpitDisplay from './_cockpit-display';

/**
 * Welle N / N1 — Mobile cockpit-glance view.
 *
 * Route: /m/cockpit
 *
 * Schwesterseite zu /m. Während /m ein dichter "second-screen"-monitor
 * mit detail-cards ist, ist /m/cockpit ein cockpit-glance-optimiertes
 * heads-up-display für die montierte phone-position: monster-zahlen für
 * ALT/GS/IAS/HDG, phase-chip + route-strip oben, fuel/wind unten. Alles
 * was du in einer sekunde wissen willst beim flug.
 *
 * # Was vs /m
 *
 *   /m         dichte tabelle, telemetry-detail, status-management
 *   /m/cockpit fett-zahlen, glance-only, kein scroll
 *
 * # Reuse vom RSC-pattern
 *
 * Identisch zur /m/page.tsx — wir holen den initial-state inline um
 * den ersten paint live-data zu haben (kein "lade…"-flash). Polling
 * geht dann via /api/mobile/state weiter, dieselbe endpoint die /m
 * benutzt. So bleibt das eine schicht und keine zwei.
 */
export default async function MobileCockpitPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  const userId = session.user.id;

  const live = await prisma.liveSession.findFirst({
    where: { userId, isActive: true },
    orderBy: { lastUpdatedAt: 'desc' },
  });

  const initialState: MobileState = {
    serverTime: new Date().toISOString(),
    session: live
      ? {
          id: live.id,
          callsign: live.callsign,
          network: live.network,
          dataSource: live.dataSource,
          flightNumber: live.flightNumber,
          departureIcao: live.departureIcao,
          arrivalIcao: live.arrivalIcao,
          alternateIcao: live.alternateIcao,
          flightRules: live.flightRules,
          cruiseAltitude: live.cruiseAltitude,
          aircraftType: live.aircraftType,
          aircraftRegistration: live.aircraftRegistration,
          currentPhase: live.currentPhase,
          currentPhaseEnteredAt:
            live.currentPhaseEnteredAt?.toISOString() ?? null,
          latitude: live.latitude,
          longitude: live.longitude,
          altitude: live.altitude,
          altitudeAglFt: live.altitudeAglFt,
          groundSpeed: live.groundSpeed,
          indicatedAirspeed: live.indicatedAirspeed,
          heading: live.heading,
          onGround: live.onGround,
          verticalSpeedFpm: live.verticalSpeedFpm,
          mach: live.mach,
          engineN1Avg: live.engineN1Avg,
          fuelTotalKg: live.fuelTotalKg,
          fuelFlowPph: live.fuelFlowPph,
          flapsPercent: live.flapsPercent,
          gearDown: live.gearDown,
          spoilersDeployed: live.spoilersDeployed,
          parkingBrake: live.parkingBrake,
          autopilotMaster: live.autopilotMaster,
          windSpeedKts: live.windSpeedKts,
          windDirection: live.windDirection,
          oatCelsius: live.oatCelsius,
          connectedAt: live.connectedAt.toISOString(),
          lastUpdatedAt: live.lastUpdatedAt.toISOString(),
          lastAcarsHeartbeat: live.lastAcarsHeartbeat?.toISOString() ?? null,
        }
      : null,
  };

  return <CockpitDisplay initialState={initialState} />;
}
