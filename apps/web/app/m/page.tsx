import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import { MobileCompanion, type MobileState } from './mobile-client';

/**
 * /m — Welle E / E3. Mobile-companion-page (RSC entry).
 *
 * Server-side responsibilities:
 *   1. Auth-gate. Anon users → redirect('/'). The endpoint at
 *      /api/mobile/state also enforces auth, but redirecting at the
 *      page level gives a cleaner UX than letting the client mount,
 *      poll once, get 401, and only then react.
 *   2. Fetch the SAME shape that /api/mobile/state returns, so the
 *      page renders immediately with real data on the first paint.
 *      Without this, the user would see a "Lade…" flash even when
 *      already mid-flight.
 *   3. Pass the initial snapshot to the client component, which then
 *      takes over polling.
 *
 * Why duplicate the data-shape between this RSC and the API route:
 * Next.js could in theory share a server-function — but the two have
 * subtly different concerns (this one runs once, returns to the
 * tree; the API one runs every 5s, returns JSON with a serverTime
 * stamp). Keeping them as twins is clearer than abstracting prematurely.
 * If a third caller appears later, factor into a `getMobileState(userId)`
 * shared helper.
 *
 * Why no `<main>` wrapper here: the layout.tsx wraps in a styled div
 * and the client component is itself the main content surface. Single
 * mobile surface, no need for landmark nesting.
 */
export default async function MobilePage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  const userId = session.user.id;

  // Initial server-side fetch — same query as /api/mobile/state. Kept
  // in sync field-by-field with the route's selection.
  const live = await prisma.liveSession.findFirst({
    where: { userId, isActive: true },
    orderBy: { lastUpdatedAt: 'desc' },
  });

  // Compose the initial-state object in the exact shape the client
  // expects from the polling endpoint. Date → ISO strings for direct
  // hand-off (matches what JSON.stringify(date) would produce, so no
  // type-juggling on the client side).
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
          currentPhaseEnteredAt: live.currentPhaseEnteredAt?.toISOString() ?? null,
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

  return (
    <MobileCompanion
      initialState={initialState}
      pilotName={session.user.name ?? 'Pilot'}
    />
  );
}
