/**
 * Welle L / L4 — Dispatch-board data aggregation.
 *
 * Pure-function helper: gegeben eine airlineId, returnt eine snapshot
 * der operational-relevanten daten für die dispatch-page:
 *   - Live-sessions (pilots die aktuell fliegen) der airline-members
 *   - Heutige scheduled-flights (Planned/Booked)
 *   - Recent pireps (last 24h, sorted by submittedAt desc)
 *   - In-progress maintenance events (aircraft out of service)
 *   - Aktive crew-pairings (Assigned/InProgress)
 *
 * Bewusst aus pages/route-handlers extrahiert damit:
 *   1. Page bleibt schlank (rendering + nav)
 *   2. Wir das später als API endpoint für mobile-dispatch wiederverwenden
 *      können
 *   3. Easy unit-testing (auch wenn V1 hier keine tests hat)
 */

import { prisma } from '@vam/db';

export type DispatchBoardSnapshot = {
  liveSessions: Array<{
    id: string;
    callsign: string;
    flightNumber: string | null;
    aircraftTitle: string | null;
    network: string;
    departure: string | null;
    arrival: string | null;
    altitude: number;
    groundSpeed: number;
    latitude: number;
    longitude: number;
    onGround: boolean;
    lastUpdatedAt: Date;
    user: {
      id: string;
      name: string | null;
    };
  }>;
  todaysFlights: Array<{
    id: string;
    departureTime: Date;
    status: string;
    route: {
      flightNumber: string;
      departureIcao: string;
      arrivalIcao: string;
    };
    aircraft: { registration: string | null } | null;
    booked: boolean;
  }>;
  recentPireps: Array<{
    id: string;
    submittedAt: Date;
    status: string;
    flightNumber: string;
    departureIcao: string;
    arrivalIcao: string;
    pilotName: string | null;
  }>;
  outOfServiceAircraft: Array<{
    id: string;
    aircraftRegistration: string;
    aircraftType: string;
    maintenanceTitle: string;
    expectedEnd: Date;
  }>;
  activePairings: number;
  fleetStats: {
    totalAircraft: number;
    activeAircraft: number;
    inMaintenance: number;
  };
};

/**
 * Lädt den dispatch-board snapshot.
 *
 * Alle queries laufen parallel; bei großer airline (~100+ members)
 * sind das ca. 7-8 queries die zusammen <100ms brauchen.
 */
export async function loadDispatchBoard(
  airlineId: string,
): Promise<DispatchBoardSnapshot> {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    liveSessionsRaw,
    todaysFlights,
    recentPirepsRaw,
    maintenanceRaw,
    activePairingsCount,
    aircraftCount,
    activeAircraftCount,
  ] = await Promise.all([
    // Live sessions for airline members
    prisma.liveSession.findMany({
      where: {
        isActive: true,
        user: { airlineId },
        // Active in last 10 minutes (filter out stale sessions)
        lastUpdatedAt: { gte: new Date(now.getTime() - 10 * 60 * 1000) },
      },
      orderBy: { lastUpdatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        callsign: true,
        flightNumber: true,
        aircraftTitle: true,
        network: true,
        departureIcao: true,
        arrivalIcao: true,
        altitude: true,
        groundSpeed: true,
        latitude: true,
        longitude: true,
        onGround: true,
        lastUpdatedAt: true,
        user: {
          select: { id: true, name: true },
        },
      },
    }),

    // Today's scheduled flights (Planned or Booked, today UTC)
    prisma.scheduledFlight.findMany({
      where: {
        airlineId,
        status: { in: ['Planned', 'Booked'] },
        departureTime: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { departureTime: 'asc' },
      take: 100,
      select: {
        id: true,
        departureTime: true,
        status: true,
        bookingId: true,
        route: {
          select: {
            flightNumber: true,
            departure: { select: { icao: true } },
            arrival: { select: { icao: true } },
          },
        },
        preferredAircraft: { select: { registration: true } },
      },
    }),

    // Recent PIREPs (last 24h)
    prisma.pirep.findMany({
      where: {
        airlineId,
        submittedAt: { gte: yesterday },
      },
      orderBy: { submittedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        submittedAt: true,
        status: true,
        route: { select: { flightNumber: true } },
        departure: { select: { icao: true } },
        arrival: { select: { icao: true } },
        user: { select: { name: true } },
      },
    }),

    // In-progress maintenance (aircraft out of service)
    prisma.maintenanceEvent.findMany({
      where: { airlineId, status: 'InProgress' },
      orderBy: { actualStart: 'asc' },
      select: {
        id: true,
        title: true,
        scheduledEnd: true,
        aircraft: { select: { registration: true, type: true } },
      },
    }),

    // Active pairings count
    prisma.crewPairing.count({
      where: { airlineId, status: { in: ['Assigned', 'InProgress'] } },
    }),

    // Total + active aircraft counts
    prisma.aircraft.count({ where: { airlineId } }),
    prisma.aircraft.count({ where: { airlineId, status: 'ACTIVE' } }),
  ]);

  return {
    liveSessions: liveSessionsRaw.map((s) => ({
      id: s.id,
      callsign: s.callsign,
      flightNumber: s.flightNumber,
      aircraftTitle: s.aircraftTitle,
      network: s.network,
      departure: s.departureIcao,
      arrival: s.arrivalIcao,
      altitude: s.altitude,
      groundSpeed: s.groundSpeed,
      latitude: s.latitude,
      longitude: s.longitude,
      onGround: s.onGround,
      lastUpdatedAt: s.lastUpdatedAt,
      user: s.user,
    })),
    todaysFlights: todaysFlights.map((f) => ({
      id: f.id,
      departureTime: f.departureTime,
      status: f.status,
      route: {
        flightNumber: f.route.flightNumber,
        departureIcao: f.route.departure.icao,
        arrivalIcao: f.route.arrival.icao,
      },
      aircraft: f.preferredAircraft
        ? { registration: f.preferredAircraft.registration }
        : null,
      booked: f.bookingId !== null,
    })),
    recentPireps: recentPirepsRaw.map((p) => ({
      id: p.id,
      submittedAt: p.submittedAt,
      status: p.status,
      flightNumber: p.route?.flightNumber ?? '—',
      departureIcao: p.departure.icao,
      arrivalIcao: p.arrival.icao,
      pilotName: p.user?.name ?? null,
    })),
    outOfServiceAircraft: maintenanceRaw.map((m) => ({
      id: m.id,
      aircraftRegistration: m.aircraft.registration,
      aircraftType: m.aircraft.type,
      maintenanceTitle: m.title,
      expectedEnd: m.scheduledEnd,
    })),
    activePairings: activePairingsCount,
    fleetStats: {
      totalAircraft: aircraftCount,
      activeAircraft: activeAircraftCount,
      inMaintenance: maintenanceRaw.length,
    },
  };
}
