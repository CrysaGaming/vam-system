import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get current user's airline
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true },
  });

  if (!currentUser?.airlineId) {
    return NextResponse.json({ sessions: [] });
  }

  // Active LiveSessions for users in same airline
  const sessions = await prisma.liveSession.findMany({
    where: {
      isActive: true,
      user: { airlineId: currentUser.airlineId },
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          image: true,
          rank: { select: { name: true } },
        },
      },
    },
    orderBy: { lastUpdatedAt: 'desc' },
  });

  // Transform to API-friendly format
  const payload = sessions.map((s) => ({
    id: s.id,
    network: s.network,
    callsign: s.callsign,
    pilot: {
      id: s.user.id,
      name: s.user.name,
      avatarUrl: s.user.image,
      rank: s.user.rank?.name ?? null,
    },
    aircraft: {
      type: s.aircraftType,
      registration: s.aircraftRegistration,
    },
    flightPlan: {
      departure: s.departureIcao,
      arrival: s.arrivalIcao,
      alternate: s.alternateIcao,
      cruiseAltitude: s.cruiseAltitude,
      flightRules: s.flightRules,
      route: s.flightRoute,
      remarks: s.flightRemarks,
    },
    position: {
      latitude: s.latitude,
      longitude: s.longitude,
      altitude: s.altitude,
      groundSpeed: s.groundSpeed,
      heading: s.heading,
      transponder: s.transponder,
      onGround: s.onGround,
    },
    connectedAt: s.connectedAt.toISOString(),
    lastUpdatedAt: s.lastUpdatedAt.toISOString(),
  }));

  return NextResponse.json({ sessions: payload, count: payload.length });
}